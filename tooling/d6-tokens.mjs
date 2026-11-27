// Supply source tokens for d6-compare's .mjs-to-.ts conversion check. It allows changes
// in whitespace that preserve line breaks between neighbours, .mjs-to-.ts module
// specifiers, parentheses around newly typed arrow parameters, and the opt-in launcher omission.
// Tokens come from a full Acorn parse because both rejected rounds mistook regex literals for
// division in contexts where the grammar determines the meaning of a slash.
// Compare Acorn labels and original source slices, including template text and the #! line
// (an Acorn line comment). The comparison also reports // or /* in erased TypeScript.
// This can flag string-literal types and costs a manual look.
// Erased assertions (as, !, satisfies) leave equal tokens and are the linter's to forbid.
// Strip output can vary by Node version. Run on the Node used for the conversion.
// Pinned Acorn accepts the syntax of its ecmaVersion 'latest' and refuses newer syntax.
// This check has not been run on macOS or Windows.
import { parse } from 'acorn';

export const lineEnd = /[\r\n\u2028\u2029]/;

export function location(source, offset) {
  const lines = source.slice(0, offset).split(/\r\n|[\r\n\u2028\u2029]/);
  return `${lines.length}:${lines.at(-1).length + 1}`;
}

export function tokenize(source, name = '<source>') {
  const records = [];
  try {
    parse(source, {
      ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, locations: true,
      onToken: records, onComment: records,
    });
  } catch (error) {
    if (!error.loc) throw error;
    const { line, column } = error.loc;
    const message = error.message.replace(/ \(\d+:\d+\)$/, '');
    throw new Error(`${name}:${line}:${column + 1} ${message}`, { cause: error });
  }
  return records.filter(({ type }) => type.label !== 'eof')
    .sort((a, b) => a.start - b.start)
    .map(({ type, start, end, loc }) => ({
      kind: type.label ?? type, value: source.slice(start, end), start, end,
      line: loc.start.line, column: loc.start.column + 1,
    }));
}
