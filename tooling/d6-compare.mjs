// Verify a research-vault .mjs-to-.ts conversion on the Node version that will run it.
// Compare Acorn type labels and source spelling after Node strips types in strip mode.
// This includes strings, template text, regexes and comments (including the #! line).
// A full Acorn parse supplies tokens because both rejected rounds mistook regex literals
// for division where the surrounding grammar determines the meaning of a slash. Allow only:
// - A change in the amount of inter-token whitespace. Each pair of neighbours must still
//   have a line break between them, or still share a line. LF, CR, CRLF, LS and PS count.
//   Multiline annotations or type arguments inserted into a same-line gap are reported.
//   Write them on one line or name the type above. Erased interface, type, import type and
//   declare blocks fit between statements already separated by a line break.
// - An otherwise identical module specifier changing from .mjs to .ts in import/export syntax.
// - Parentheses around a lone arrow parameter that gained a type. The incoming gap ends at
//   the opening parenthesis and the outgoing gap starts at the closing one. The gaps just
//   inside the added parentheses cannot introduce line breaks. Comments remain neighbours.
// - With --launcher, omit a final standalone line of the form `if (<condition>) main();`
//   with no comments. Its tokens have no partners or gaps to compare.
//
// Report // or /* in erased TypeScript as a possible comment. This can flag a string-literal
// type such as 'http://x', which costs a manual look. Compare retained comments byte for byte.
// Erased assertions (as, !, satisfies) leave equal tokens and are the linter's to forbid.
// Strip output can vary by Node version. Run on the Node used for the conversion.
// Pinned Acorn accepts the syntax of its ecmaVersion 'latest' and refuses newer syntax.
// This check has not been run on macOS or Windows.
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const installHint = 'Run npm ci --ignore-scripts in tooling/ to install Acorn.';
const { lineEnd, location, tokenize } = await import('./d6-tokens.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.startsWith("Cannot find package 'acorn' imported from ")) throw error;
  return {};
});

const lineBreakChanged = 'line break changed between tokens';
const isComment = token => token?.kind === 'Line' || token?.kind === 'Block';

function moduleSpecifiers(tokens) {
  const code = tokens.filter(token => !isComment(token));
  const value = index => {
    const token = code[index];
    return token?.kind === 'template' || token?.kind === 'invalidTemplate' ? undefined : token?.value;
  };
  const identifier = index => code[index]?.kind === 'name';
  const keyword = index => ['import', 'export'].includes(value(index)) && !['.', '?.'].includes(value(index - 1));

  return new Set(code.filter((token, index) => {
    if (token.kind !== 'string') return false;
    const previous = value(index - 1);
    if (previous === 'import') return keyword(index - 1);
    if (previous === '(') return value(index - 2) === 'import' && keyword(index - 2) &&
      [')', ','].includes(value(index + 1));
    if (previous !== 'from') return false;

    let i = index - 2;
    if (value(i) === '}') {
      while (i >= 0 && value(i) !== '{') i--;
      if (i < 0) return false;
      i--;
    } else if (identifier(i) && value(i - 1) === 'as' && value(i - 2) === '*') i -= 3;
    else if (value(i) === '*') i--;
    else return identifier(i) && value(i - 1) === 'import' && keyword(i - 1);
    if (value(i) === ',' && identifier(i - 1)) return value(i - 2) === 'import' && keyword(i - 2);
    return keyword(i);
  }));
}

function finalGuard(source, tokens) {
  const end = tokens.length;
  if (tokens.slice(-5).map(token => token.value).join(' ') !== ') main ( ) ;') return -1;
  let depth = 1, i = end - 6;
  for (; i >= 0; i--) {
    if (isComment(tokens[i])) return -1;
    if (tokens[i].kind === ')') depth++;
    if (tokens[i].kind === '(' && --depth === 0) break;
  }
  if (i < 1 || i === end - 6 || tokens[i - 1].value !== 'if') return -1;
  const start = tokens[i - 1].start;
  if (lineEnd.test(source.slice(start, tokens[end - 1].end))) return -1;
  const prevEnd = tokens[i - 2]?.end ?? 0;
  if (i > 1 && !lineEnd.test(source.slice(prevEnd, start))) return -1;
  return i - 1;
}

function arrowParens(left, i, right, j, rawAfter, after) {
  while (isComment(left[i])) i++;
  const param = left[i++];
  if (param?.kind !== 'name') return;
  while (isComment(left[i])) i++;
  if (left[i]?.value !== '=>') return;
  const inner = [];
  let k = j + 1;
  while (isComment(right[k])) inner.push(right[k++]);
  const typed = right[k++];
  if (typed?.kind !== 'name' || typed.value !== param.value) return;
  inner.push(typed);
  while (isComment(right[k])) inner.push(right[k++]);
  const close = right[k];
  if (close?.value !== ')') return;
  let next = k + 1;
  while (isComment(right[next])) next++;
  if (right[next]?.value !== '=>') return;

  // Comments may precede the annotation or follow it. Find the erased syntax in the gaps.
  const suffix = inner.slice(inner.indexOf(typed)).concat(close);
  const gainedType = suffix.slice(1).some((token, index) =>
    /^\s*(?::|\?(?!\.))/.test(rawAfter.slice(suffix[index].end, token.start)));
  if (!gainedType) return;
  const extraBreaks = [];
  if (lineEnd.test(after.slice(right[j].end, inner[0].start))) extraBreaks.push(inner[0]);
  if (lineEnd.test(after.slice(inner.at(-1).end, close.start))) extraBreaks.push(close);
  inner[0] = { ...inner[0], gapStart: right[j].start };
  inner[inner.length - 1] = { ...inner.at(-1), gapEnd: close.end };
  right.splice(j, k - j + 1, ...inner);
  return extraBreaks;
}

function compareTokens(before, after, rawAfter, left, right, { launcher, beforeName, afterName }) {
  if (launcher && finalGuard(after, right) < 0) {
    const guard = finalGuard(before, left);
    if (guard >= 0) left.length = guard;
  }
  const leftImports = moduleSpecifiers(left), rightImports = moduleSpecifiers(right);
  function same(a, b) {
    return a && b && a.kind === b.kind &&
      (a.value === b.value || (leftImports.has(a) && rightImports.has(b) &&
        /\.mjs['"]$/.test(a.value) && a.value.replace(/\.mjs(?=['"]$)/, '.ts') === b.value));
  }

  const differences = [];
  let i = 0, j = 0, prevLeft, prevRight;
  function difference(a, b, message, leftAt = i, rightAt = j) {
    let offset = 0;
    if (!message && a && b && a.kind === b.kind) {
      while (offset < a.value.length && a.value[offset] === b.value[offset]) offset++;
    }
    const place = (file, source, token, next) => {
      const start = message === lineBreakChanged ? token?.gapStart ?? token?.start : token?.start;
      return `${file}:${location(source, start === undefined ? next?.start ?? source.length : start + offset)}`;
    };
    const show = token => token ? JSON.stringify(token.value) : '<no token>';
    differences.push({
      before: place(beforeName, before, a, left[leftAt]),
      after: place(afterName, after, b, right[rightAt]),
      message: message ?? `${show(a)} -> ${show(b)}`,
    });
  }

  function anchor() {
    // Look for a short matching run after a mismatch to locate later independent edits.
    const extraLeft = same(left[i + 1], right[j]);
    const extraRight = same(left[i], right[j + 1]);
    if (extraLeft && !extraRight) return [1, 0];
    if (extraRight && !extraLeft) return [0, 1];
    for (let distance = 1; distance <= 48; distance++) {
      for (let di = 0; di <= distance; di++) {
        const dj = distance - di;
        let n = 0;
        while (n < 4 && same(left[i + di + n], right[j + dj + n])) n++;
        if (n === 4 || (n && i + di + n === left.length && j + dj + n === right.length)) return [di, dj];
      }
    }
    return [Number(i < left.length), Number(j < right.length)];
  }

  while (i < left.length || j < right.length) {
    if (right[j]?.kind === '(') {
      for (const token of arrowParens(left, i, right, j, rawAfter, after) ?? []) {
        difference(left[i], token, lineBreakChanged);
      }
    }
    const a = left[i], b = right[j];
    if (same(a, b)) {
      if (prevLeft && lineEnd.test(before.slice(prevLeft.end, a.start)) !==
          lineEnd.test(after.slice(prevRight.gapEnd ?? prevRight.end, b.gapStart ?? b.start))) {
        difference(a, b, lineBreakChanged);
      }
      prevLeft = a;
      prevRight = b;
      i++;
      j++;
    } else {
      const [di, dj] = anchor();
      for (let k = 0; k < Math.max(di, dj); k++) {
        const aAt = i + Math.min(k, di), bAt = j + Math.min(k, dj);
        difference(k < di ? left[aAt] : undefined, k < dj ? right[bAt] : undefined, undefined, aAt, bAt);
      }
      i += di;
      j += dj;
      prevLeft = prevRight = undefined;
    }
  }
  return differences;
}

export function compare(beforeText, afterText, { launcher = false, beforeName = '<before>', afterName = '<after>' } = {}) {
  if (!tokenize) throw new Error(installHint);
  const left = tokenize(beforeText, beforeName);
  let stripped;
  try {
    stripped = nodeModule.stripTypeScriptTypes(afterText, { mode: 'strip' });
  } catch (error) {
    throw new Error(`${afterName}: ${error.message}`);
  }

  if (stripped.length !== afterText.length) {
    const reason = afterText.startsWith('\ufeff') && stripped.length === afterText.length - 1 &&
      !stripped.startsWith('\ufeff') ? 'type stripping removed a leading byte-order mark' : 'type stripping changed source offsets';
    throw new Error(`${afterName}:1:1 ${reason}`);
  }
  const right = tokenize(stripped, afterName);
  const differences = [];
  if (stripped !== afterText) {
    for (const { index } of afterText.matchAll(/\/(?=[/*])/g)) {
      // Both characters must be part of the erased region.
      if (stripped[index] === '/' || stripped[index + 1] === afterText[index + 1]) continue;
      const after = `${afterName}:${location(afterText, index)}`;
      differences.push({ after, message: `possible comment inside erased TypeScript at ${after}` });
    }
  }
  return differences.concat(compareTokens(beforeText, stripped, afterText, left, right, { launcher, beforeName, afterName }));
}

function main() {
  if (!tokenize) {
    console.error(installHint);
    return 2;
  }
  console.log(process.version);
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 12) || typeof nodeModule.stripTypeScriptTypes !== 'function') {
    console.error('D6 requires Node.js 24.12.0 or newer.');
    return 2;
  }

  const [beforeName, afterName, flag, ...extra] = process.argv.slice(2);
  if (!beforeName || !afterName || (flag !== undefined && flag !== '--launcher') || extra.length) {
    console.error('Usage: node tooling/d6-compare.mjs <before.mjs> <after.ts> [--launcher]');
    return 2;
  }
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const read = name => utf8.decode(readFileSync(name));
    const differences = compare(read(beforeName), read(afterName), { launcher: flag === '--launcher', beforeName, afterName });
    for (const { before, after, message } of differences) {
      console.log(before ? `${before} -> ${after}: ${message}` : message);
    }
    return differences.length ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    return 2;
  }
}

if (import.meta.main || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
