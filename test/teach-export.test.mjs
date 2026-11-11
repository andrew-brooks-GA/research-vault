// Spec 48 Tests items 1, 3, 4, 5 and 6: `teach export`, on workspaces built here (nothing under test/fixtures/teach/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, symlinkSync, rmSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { fixtureVault, put } from './helpers.mjs';
import { recordVerdict } from '../bin/lib/gate.mjs';
import { lessonIndex, serveFile, navHtml, extractCites, MENTION_RE } from '../bin/lib/teach.mjs';
import { CONNECT_LEAD } from '../bin/lib/lesson.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'research-vault.mjs');
const ASSETS = join(ROOT, 'skills', 'research-teach', 'assets');

const quiz = (correct) => `<section data-block="quiz" aria-label="check yourself"><script type="application/json" data-quiz>${
  JSON.stringify({ items: correct.map((c, i) => ({ q: `q${i}`, options: ['a', 'b', 'c'], correct: c, why: ['1', '2', '3'] })) })}</script></section>`;
const lessonHtml = (id, title, middle) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="../assets/lesson.css"></head>
<body${id === '0002-two' ? '' : ` data-lesson="${id}"`}>
<h1>${title}</h1>
<section data-block="prereq"><p>See <a href="../GLOSSARY.md#term">Term</a> and <a href="../reference/note.html">the note</a>.</p></section>
${middle}
<section data-block="sources"><ul><li><a data-cite="2026-01-01-fx-doc" href="https://example.org/fx">fx doc</a> (recommended read)</li><li><a data-cite="2026-01-01-fx-snippet">snippet</a></li></ul></section>
<section data-block="followup"><p>You hold it now. You can ask follow-up questions in the terminal.</p></section>
<script type="module" src="../assets/quiz.js"></script>
</body></html>
`;
const README = ['# Learn fx', '', '## What this is for', 'Predicting fx.', '', '## How to take it',
  'Run `teach serve` and open the address in Claude Code.', '', '## Lesson map', 'Two lessons, see [the first](/lessons/0001-one.html).', ''].join('\n');

// A bound repo holding a workspace named learn-ws, every gated page passed by the gate unless `ungated` names it.
function exportRepo({ ungated = [], step = 'Run <code>fx(3)</code> and look for 18.', cite = '2026-01-01-fx-experiment', edit = () => {} } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'rv-teach-export-'));
  const vault = fixtureVault(join(repo, 'research'));
  put(vault, 'source', '2026-02-02-tricky', { source_type: 'article', source_url: 'javascript:alert(1)', summary: 'A <b>bold</b> & "quoted" summary', title: 'Tricky <script>alert(1)</script>' });
  writeFileSync(join(repo, '.research-vault.json'), JSON.stringify({ vault: 'research' }) + '\n');
  const ws = join(repo, 'learn-ws');
  for (const d of ['lessons/files/0002-lab', 'reference', 'assets', 'attempts', 'evidence/0001', 'learning-records']) mkdirSync(join(ws, d), { recursive: true });
  writeFileSync(join(ws, 'MISSION.md'), '# Mission\n\n## Success looks like\n\n- One\n');
  writeFileSync(join(ws, 'PATH.md'), '# Path\n\n1. One | after: floor | lesson: 0001-one\n2. Two | after: 1 | lesson: 0002-two\n');
  writeFileSync(join(ws, 'NOTES.md'), 'private notes\n');
  writeFileSync(join(ws, 'GLOSSARY.md'), '# Glossary\n\n## Term\n\nA word.\n');
  writeFileSync(join(ws, 'README.md'), README);
  writeFileSync(join(ws, 'attempts', 'a-20260101-120000-0001.md'), '---\ntype: attempt\n---\n');
  writeFileSync(join(ws, 'evidence', '0001', 'run.sh'), 'echo hi\n');
  writeFileSync(join(ws, 'learning-records', '0001-x.md'), '# x\n');
  writeFileSync(join(ws, 'lessons', '0001-one.html'), lessonHtml('0001-one', 'One &amp; only',
    `<section data-block="model"><p>The error is terminal for the run. <a data-cite="2026-01-01-fx-doc">[1]</a> <a data-cite="${cite}">[3]</a></p></section>\n${quiz([0, 1])}\n<section data-block="connect"><p>${CONNECT_LEAD}</p><p>How does fx relate to n?</p></section>`));
  writeFileSync(join(ws, 'lessons', '0002-two.html'), lessonHtml('0002-two', 'Two', `${quiz([2])}\n<section data-block="step"><p>${step}</p><pre><code>$ echo in the terminal</code></pre>` +
    '<pre>open it in the terminal</pre><p>Then <code>Claude Code</code> runs.</p></section>'));
  writeFileSync(join(ws, 'lessons', 'files', '0002-lab', 'check.sh'), 'exit 0\n');
  writeFileSync(join(ws, 'lessons', 'files', '0002-lab', 'page.html'), '<html><body>lab page</body></html>\n');
  writeFileSync(join(ws, 'reference', 'note.html'), '<!doctype html><html><head><title>The note</title><link rel="stylesheet" href="../assets/lesson.css"></head><body><h1>The note</h1>\n' +
    '<div data-block="note" data-cite="2026-02-02-tricky"><p>A note. <img src="../assets/fig.svg" alt="fig"></p></div></body></html>\n');
  writeFileSync(join(ws, 'assets', 'fig.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  writeFileSync(join(ws, 'assets', 'quiz.js'), 'old workspace copy\n');
  edit(ws, vault);
  for (const f of ['lessons/0001-one.html', 'lessons/0002-two.html', 'reference/note.html', 'README.md']) {
    if (!ungated.includes(f)) recordVerdict(repo, join(ws, f), 'PASS');
  }
  return { repo, vault, ws };
}
const cli = (...a) => spawnSync(process.execPath, [BIN, 'teach', 'export', ...a], { encoding: 'utf8' });
const outDir = () => join(mkdtempSync(join(tmpdir(), 'rv-teach-export-out-')), 'site');
const tree = (dir, rel = '') => readdirSync(join(dir, rel), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? tree(dir, posix.join(rel, d.name)) : [posix.join(rel, d.name)])).sort();
const read = (out, p) => readFileSync(join(out, p), 'utf8');
const lines = (r, prefix) => r.stdout.split('\n').filter((l) => l.startsWith(prefix));

test('teach export writes a copy that opens from file://: the served file set, deferred classic quiz tags, built-in navs, relative links only (spec 48 test 1)', () => {
  const { ws } = exportRepo();
  const out = outDir();
  const r = cli(ws, '--out', out);
  assert.equal(r.stderr, '');
  assert.equal(r.status, 0, r.stdout);
  // The expected set, from lessonIndex and serveFile: every page and other file teach serve returns, less HTML under
  // lessons/files/ and the workspace's own quiz.js, plus the pages the export builds.
  const idx = lessonIndex(ws);
  const served = ['assets/fig.svg', 'assets/quiz.js', 'lessons/files/0002-lab/check.sh', 'lessons/files/0002-lab/page.html', 'NOTES.md', 'attempts/a-20260101-120000-0001.md']
    .filter((p) => serveFile(ws, `/${p}`, { bytes: false }).status === 200);
  assert.deepEqual(served, ['assets/fig.svg', 'assets/quiz.js', 'lessons/files/0002-lab/check.sh', 'lessons/files/0002-lab/page.html']);
  const expected = [...[...idx.lessons, ...idx.reference].map((e) => e.path.slice(1)), 'assets/fig.svg', 'lessons/files/0002-lab/check.sh',
    'index.html', 'progress.html', 'sources.html', 'GLOSSARY.md', 'assets/quiz.js', 'assets/reading.html', 'assets/lesson.css'].sort();
  assert.deepEqual(tree(out), expected);
  assert.deepEqual(lines(r, 'not gated'), ['not gated lessons/files/0002-lab/page.html']);
  assert.equal(lines(r, 'wrote').join(), `wrote ${expected.length} files to ${out}`);
  assert.equal(read(out, 'assets/lesson.css'), readFileSync(join(ASSETS, 'lesson.css'), 'utf8'), 'no workspace lesson.css: the plugin\'s');
  const quizJs = read(out, 'assets/quiz.js');
  assert.ok(!/^export /m.test(quizJs) && quizJs.includes('function resultsFile('), 'the plugin\'s quiz.js, not the workspace\'s');
  new vm.Script(quizJs); // a classic script compiles
  const pages = expected.filter((p) => p.endsWith('.html'));
  for (const p of pages) {
    const h = read(out, p);
    assert.ok(!h.includes('type="module"'), p);
    assert.match(h, /<body data-export="learn-ws"/, p);
    for (const m of h.matchAll(/<(script|link|img|iframe|source|video|audio)\b[^>]*\s(?:src|href)\s*=\s*(["'])(.*?)\2/gi)) {
      assert.ok(!/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(m[3]), `${p}: ${m[0]}`);
    }
    for (const m of h.matchAll(/\s(?:href|src)\s*=\s*(["'])(.*?)\1/gi)) {
      const target = m[2].split(/[?#]/)[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(m[2])) continue;
      assert.ok(!m[2].startsWith('/'), `${p}: root-absolute ${m[2]}`);
      assert.ok(expected.includes(posix.normalize(posix.join(posix.dirname(p), decodeURIComponent(target)))), `${p}: ${m[2]} resolves`);
    }
  }
  assert.doesNotMatch(read(out, 'assets/lesson.css'), /url\(\s*["']?([a-z][a-z0-9+.-]*:|\/\/)|@import/i);
  const one = read(out, 'lessons/0001-one.html');
  const two = read(out, 'lessons/0002-two.html');
  for (const h of [one, two]) assert.equal((h.match(/<script defer src="\.\.\/assets\/quiz\.js"><\/script>/g) ?? []).length, 1);
  assert.match(two, /<body data-export="learn-ws" data-lesson="0002-two">/, 'data-lesson added from the file name');
  assert.match(one, /<body data-export="learn-ws" data-lesson="0001-one">/, 'kept, not doubled');
  const nav = (h) => /<nav class="lesson-nav">.*?<\/nav>/.exec(h)[0];
  const base = '<nav class="lesson-nav"><a class="lesson-nav-index" href="../index.html">All lessons</a><a class="lesson-nav-progress" href="../progress.html">Progress</a><a class="lesson-nav-reading" href="../assets/reading.html">How to read</a>';
  assert.equal(nav(one), `${base}<span class="lesson-nav-line">line 1 of 2</span><a class="lesson-nav-next" href="../lessons/0002-two.html">Two &#8594;</a></nav>`);
  assert.equal(nav(two), `${base}<a class="lesson-nav-prev" href="../lessons/0001-one.html">&#8592; One &amp;amp; only</a><span class="lesson-nav-line">line 2 of 2</span></nav>`);
  assert.equal((read(out, 'progress.html').match(/class="lesson-nav"/g) ?? []).length, 1);
  assert.match(read(out, 'progress.html'), /<script defer src="assets\/quiz\.js"><\/script>[\s\S]*<section data-block="progress"><\/section>/);
  assert.match(read(out, 'index.html'), /<a class="lesson-nav-index" href="index.html">/);
  assert.match(read(out, 'assets/reading.html'), /<a href="\.\.\/index.html">Back to the lessons<\/a>/);
  assert.match(one, /<a data-cite="2026-01-01-fx-snippet" href="\.\.\/sources.html#2026-01-01-fx-snippet" id="src-2026-01-01-fx-snippet">/);
});

test('no exported page sends the learner to the terminal, teach serve or Claude Code; a mention refuses the export (spec 48 test 3)', () => {
  const { ws } = exportRepo();
  const out = outDir();
  assert.equal(cli(ws, '--out', out).status, 0);
  for (const p of tree(out).filter((f) => f.endsWith('.html') && f !== 'sources.html')) {
    const text = read(out, p).replace(/<pre\b[\s\S]*?<\/pre>/gi, ' ').replace(/<code\b[\s\S]*?<\/code>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    assert.doesNotMatch(text, MENTION_RE, p);
  }
  const one = read(out, 'lessons/0001-one.html');
  assert.ok(one.includes('<p>Write your answer down, or send it to your instructor, in a few sentences:</p>'));
  assert.ok(one.includes('You can ask your instructor follow-up questions.'));
  assert.ok(one.includes('The error is terminal for the run.'), '"terminal" on its own passes');
  const index = read(out, 'index.html');
  assert.ok(index.includes('<h2>How to take it</h2>\n<p>Open the lessons below in order. Your quiz answers are kept in this browser; use Export my results on the Progress page and send the file to your instructor.</p>\n<h2>Lesson map</h2>'));
  assert.ok(!index.includes('teach serve'));
  // A step that sends the learner to the terminal: exit 1, a mention line, nothing written.
  const bad = exportRepo({ step: 'Type <b>fx(3)</b> in the terminal and read the answer.' });
  const out2 = outDir();
  const r = cli(bad.ws, '--out', out2);
  assert.equal(r.status, 1);
  assert.deepEqual(lines(r, 'mention'), ['mention lessons/0002-two.html: Type fx(3) in the terminal and read the answer.']);
  assert.ok(!existsSync(out2));
});

test('every cited vault entry is on sources.html with a source line; an unknown cited id refuses the export (spec 48 test 4)', () => {
  const { ws } = exportRepo();
  const out = outDir();
  const r = cli(ws, '--out', out);
  assert.equal(r.status, 0);
  const ids = [...new Set(tree(out).filter((f) => f.endsWith('.html') && f !== 'sources.html').flatMap((p) => extractCites(read(out, p))))].sort();
  assert.deepEqual(ids, ['2026-01-01-fx-doc', '2026-01-01-fx-experiment', '2026-01-01-fx-snippet', '2026-02-02-tricky']);
  assert.deepEqual(lines(r, 'source '), ['source 2026-01-01-fx-doc https://example.org/fx', 'source 2026-01-01-fx-experiment -',
    'source 2026-01-01-fx-snippet -', 'source 2026-02-02-tricky javascript:alert(1)']);
  const src = read(out, 'sources.html');
  assert.ok(src.includes('<li id="2026-01-01-fx-doc"><a href="https://example.org/fx">2026-01-01-fx-doc</a> <small>2026-01-01</small></li>'));
  assert.ok(src.includes('<li id="2026-01-01-fx-experiment">2026-01-01-fx-experiment <small>2026-01-01</small></li>'));
  assert.ok(src.includes('<li id="2026-02-02-tricky">Tricky &lt;script&gt;alert(1)&lt;/script&gt; <small>2026-02-02</small>: A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; summary</li>'), 'escaped, a javascript: URL not linked');
  assert.ok(!src.includes('javascript:'));
  const bad = exportRepo({ cite: '2026-09-09-nowhere' });
  const out2 = outDir();
  const r2 = cli(bad.ws, '--out', out2);
  assert.equal(r2.status, 1);
  assert.deepEqual(lines(r2, 'unknown-source'), ['unknown-source lessons/0001-one.html: 2026-09-09-nowhere']);
  assert.ok(!existsSync(out2));
});

test('a page with no verdict refuses the export; --skip-ungated leaves it out of the files, the index and every nav (spec 48 test 5)', () => {
  const { ws } = exportRepo({ ungated: ['lessons/0002-two.html', 'README.md'] });
  const out = outDir();
  const r = cli(ws, '--out', out);
  assert.equal(r.status, 1);
  assert.deepEqual(lines(r, 'ungated'), ['ungated lessons/0002-two.html', 'ungated README.md']);
  assert.equal(r.stderr, 'teach export: 2 page(s) have no PASS or MERIT for their current content; nothing written (--skip-ungated leaves them out)\n');
  assert.ok(!existsSync(out));
  const s = cli('--skip-ungated', ws, '--out', out);
  assert.equal(s.stderr, '');
  assert.equal(s.status, 0);
  assert.deepEqual(lines(s, 'skipped'), ['skipped lessons/0002-two.html', 'skipped README.md']);
  assert.deepEqual(lines(s, 'not gated'), ['not gated lessons/files/0002-lab/page.html']);
  assert.ok(!existsSync(join(out, 'lessons', '0002-two.html')) && !existsSync(join(out, 'lessons', 'files', '0002-lab', 'page.html')));
  for (const p of tree(out).filter((f) => f.endsWith('.html'))) assert.ok(!read(out, p).includes('0002-two'), p);
  assert.ok(!read(out, 'index.html').includes('data-block="readme"'), 'a skipped README leaves the index with none');
});

test('teach export refuses a bad --out with exit 2 and writes nothing', () => {
  const { repo, vault, ws } = exportRepo();
  const before = tree(repo);
  const usage = cli(ws);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /^usage: research-vault teach /);
  const cases = [
    [join(vault, 'site'), 'is inside the vault'],
    [join(ws, 'lessons', 'site'), "is inside the workspace's lessons/"],
    [join(ws, 'reference'), "is inside the workspace's reference/"],
    [join(ws, 'assets', 'x', 'y'), "is inside the workspace's assets/"],
    [ws, 'exists and is not an empty directory'],
    [join(ws, 'NOTES.md'), 'exists and is not an empty directory'],
  ];
  for (const [dir, why] of cases) {
    const r = cli(ws, '--out', dir);
    assert.equal(r.status, 2, dir);
    assert.equal(r.stderr, `teach export: --out ${dir} ${why}\n`);
    assert.equal(r.stdout, '');
  }
  assert.deepEqual(tree(repo), before);
  const empty = mkdtempSync(join(tmpdir(), 'rv-teach-export-empty-'));
  assert.equal(cli(ws, '--out', empty).status, 0, 'an empty directory is taken');
  assert.ok(statSync(join(empty, 'index.html')).isFile());
});

test('navHtml() is the e80b914 string byte for byte (spec 48 test 6)', () => {
  assert.equal(navHtml(), '<nav class="lesson-nav"><a class="lesson-nav-index" href="/">All lessons</a><a class="lesson-nav-progress" href="/progress">Progress</a><a class="lesson-nav-reading" href="/assets/reading.html">How to read</a></nav>');
});

test('a file name and a title from the workspace are escaped in the exported index and nav bar', () => {
  const { repo, ws } = exportRepo();
  const odd = join(ws, 'reference', 'a"b<i>.html');
  writeFileSync(odd, '<!doctype html><html><head><title>T "<b>x</b>"</title></head><body><h1>T</h1><div data-block="note" data-cite="2026-01-01-fx-doc"><p>n</p></div></body></html>\n');
  recordVerdict(repo, odd, 'PASS');
  const out = outDir();
  assert.equal(cli(ws, '--out', out).status, 0);
  const index = read(out, 'index.html');
  assert.ok(index.includes('<li><a href="reference/a&quot;b&lt;i&gt;.html">T &quot;x&quot;</a> <small>a&quot;b&lt;i&gt;</small></li>'), index);
  assert.ok(!index.includes('<i>') && !index.includes('<b>'));
  assert.ok(existsSync(join(out, 'reference', 'a"b<i>.html')));
});

test('teach lint warns WARN_CONNECT_LEAD for a connect block that does not open with CONNECT_LEAD (spec 48 D7)', () => {
  const { ws } = exportRepo();
  const lint = () => spawnSync(process.execPath, [BIN, 'teach', 'lint', ws], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l.includes('WARN_CONNECT_LEAD'));
  assert.deepEqual(lint(), []);
  const f = join(ws, 'lessons', '0001-one.html');
  writeFileSync(f, readFileSync(f, 'utf8').replace(CONNECT_LEAD, 'Answer in the Claude Code terminal:'));
  assert.deepEqual(lint(), [`warning WARN_CONNECT_LEAD  lessons/0001-one.html: connect block does not open with: ${CONNECT_LEAD}`]);
});

// Review round: wrapped and entity-spaced phrases, the fixed sentences wrapped, GLOSSARY.md, the sources block and sources.html.
test('a phrase wrapped across a source line or joined by &nbsp; is refused; a wrapped fixed sentence is replaced (spec 48 D7)', () => {
  for (const [step, line] of [['Type it in the\n  terminal and read it.', 'Type it in the terminal and read it.'], ['Type it in the&nbsp;terminal now.', 'Type it in the terminal now.'], ['Ask Claude\nCode about it.', 'Ask Claude Code about it.']]) {
    const { ws } = exportRepo({ step });
    const out = outDir();
    const r = cli(ws, '--out', out);
    assert.equal(r.status, 1, step);
    assert.deepEqual(lines(r, 'mention'), [`mention lessons/0002-two.html: ${line}`]);
    assert.ok(!existsSync(out));
  }
  const { ws } = exportRepo({ edit: (w) => {
    const f = join(w, 'lessons', '0001-one.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('follow-up questions in the terminal.', 'follow-up questions in the\n  terminal.').replace('in the terminal, in a few', 'in the\nterminal, in a  few'));
  } });
  const out = outDir();
  assert.equal(cli(ws, '--out', out).status, 0);
  const one = read(out, 'lessons/0001-one.html');
  assert.ok(one.includes('You can ask your instructor follow-up questions.') && one.includes('Write your answer down, or send it to your instructor, in a few sentences:'));
});

test('GLOSSARY.md is checked as Markdown text; a symlinked GLOSSARY.md is neither served nor exported', () => {
  const { ws } = exportRepo({ edit: (w) => writeFileSync(join(w, 'GLOSSARY.md'), '# Glossary\n\n## Term\n\nType it in the\nterminal.\n') });
  const r = cli(ws, '--out', outDir());
  assert.equal(r.status, 1);
  assert.deepEqual(lines(r, 'mention'), ['mention GLOSSARY.md: Type it in the terminal.']);
  const secret = join(mkdtempSync(join(tmpdir(), 'rv-teach-export-secret-')), 'notes.md');
  writeFileSync(secret, 'outside the workspace\n');
  const s = exportRepo({ edit: (w) => { rmSync(join(w, 'GLOSSARY.md')); symlinkSync(secret, join(w, 'GLOSSARY.md')); } });
  assert.equal(serveFile(s.ws, '/GLOSSARY.md').status, 404);
  const out = outDir();
  assert.equal(cli(s.ws, '--out', out).status, 0);
  assert.ok(!existsSync(join(out, 'GLOSSARY.md')));
});

test('vault titles in a lesson\'s sources block are not checked, and sources.html keeps a title as written', () => {
  const { ws } = exportRepo({ edit: (w, vault) => {
    put(vault, 'source', '2026-04-04-cc-hooks', { source_type: 'article', source_url: 'https://example.org/hooks', title: 'Claude Code hooks reference' });
    put(vault, 'source', '2026-04-05-followup', { source_type: 'article', source_url: 'file:///etc/passwd', title: 'You can ask follow-up questions in the terminal.' });
    const f = join(w, 'lessons', '0001-one.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('<li><a data-cite="2026-01-01-fx-snippet">snippet</a></li>',
      '<li><a data-cite="2026-01-01-fx-snippet">snippet</a></li><li><a data-cite="2026-04-04-cc-hooks">h</a></li><li><a data-cite="2026-04-05-followup">f</a></li>'));
  } });
  const out = outDir();
  const r = cli(ws, '--out', out);
  assert.equal(r.status, 0, r.stdout);
  const src = read(out, 'sources.html');
  assert.ok(src.includes('<li id="2026-04-04-cc-hooks"><a href="https://example.org/hooks">Claude Code hooks reference</a>'));
  assert.ok(src.includes('<li id="2026-04-05-followup">You can ask follow-up questions in the terminal. <small>2026-04-05</small></li>'), 'unreplaced, a file: URL not linked');
  assert.ok(lines(r, 'source 2026-04-05').join().endsWith('file:///etc/passwd'));
});

test('a root-absolute link holding the other quote character is made relative', () => {
  const { repo, ws } = exportRepo({ edit: (w) => {
    writeFileSync(join(w, 'reference', "x'y z.html"), '<html><head><title>Q</title></head><body><h1>Q</h1><div data-block="note" data-cite="2026-01-01-fx-doc"><p>n</p></div></body></html>\n');
    const f = join(w, 'lessons', '0001-one.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('<h1>', `<p><a href="/reference/x'y z.html">q</a> <a href='/reference/note.html?a="1"#n'>n</a></p><h1>`));
  } });
  recordVerdict(repo, join(ws, 'reference', "x'y z.html"), 'PASS');
  const out = outDir();
  assert.equal(cli(ws, '--out', out).status, 0);
  const one = read(out, 'lessons/0001-one.html');
  assert.ok(one.includes(`<a href="../reference/x'y z.html">q</a> <a href='../reference/note.html?a="1"#n'>n</a>`), one);
});

test('a case variant of quiz.js, reading.html or lesson.css in assets/ is decided case-insensitively; two paths differing by case refuse', () => {
  const { ws } = exportRepo({ edit: (w) => {
    rmSync(join(w, 'assets', 'quiz.js'));
    for (const [f, t] of [['Quiz.js', 'old\n'], ['Reading.HTML', 'old\n'], ['LESSON.CSS', 'body {}\n']]) writeFileSync(join(w, 'assets', f), t);
  } });
  const out = outDir();
  const r = cli(ws, '--out', out);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const assets = readdirSync(join(out, 'assets')).sort();
  assert.deepEqual(assets, ['LESSON.CSS', 'fig.svg', 'quiz.js', 'reading.html']);
  assert.ok(read(out, 'assets/reading.html').includes('How to read a lesson') && read(out, 'assets/quiz.js').includes('function resultsFile('));
  // Only a case-sensitive disk can hold both names; there the export refuses before writing.
  const c = exportRepo({ edit: (w) => { writeFileSync(join(w, 'lessons', 'files', '0002-lab', 'a.txt'), '1\n'); writeFileSync(join(w, 'lessons', 'files', '0002-lab', 'A.txt'), '2\n'); } });
  if (readdirSync(join(c.ws, 'lessons', 'files', '0002-lab')).length === 4) {
    const out2 = outDir();
    const r2 = cli(c.ws, '--out', out2);
    assert.equal(r2.status, 1);
    assert.deepEqual(lines(r2, 'case-collision'), ['case-collision lessons/files/0002-lab/A.txt: lessons/files/0002-lab/a.txt']);
    assert.ok(!existsSync(out2));
  }
});

test('a write that fails part way removes what the run wrote and exits 2', () => {
  // A path one file of the export cannot take: --out near the platform's path length limit, a long file name under lessons/files/.
  const limit = process.platform === 'darwin' ? 1024 : 4096;
  const long = 'f'.repeat(200);
  const { ws } = exportRepo({ edit: (w) => writeFileSync(join(w, 'lessons', 'files', '0002-lab', `${long}.txt`), 'x\n') });
  let dir = mkdtempSync(join(tmpdir(), 'rv-teach-export-long-'));
  while (dir.length < limit - 120) dir = join(dir, 'd'.repeat(Math.min(200, limit - 120 - dir.length)));
  for (const pre of [false, true]) {
    const out = join(dir, pre ? 'pre' : 'new');
    if (pre) mkdirSync(out, { recursive: true });
    const r = cli(ws, '--out', out);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal(r.stderr, `teach export: cannot write under ${out} (ENAMETOOLONG); removed what this run wrote\n`);
    assert.equal(existsSync(out), pre);
    if (pre) assert.deepEqual(readdirSync(out), []);
  }
});

test('an --out that is a symlink, even a dangling one, is refused with exit 2 and left in place', () => {
  const { ws } = exportRepo();
  const link = join(mkdtempSync(join(tmpdir(), 'rv-teach-export-link-')), 'site');
  symlinkSync(join(tmpdir(), 'rv-teach-export-no-such-target'), link);
  const r = cli(ws, '--out', link);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, `teach export: --out ${link} is a symlink\n`);
  assert.ok(lstatSync(link).isSymbolicLink(), 'the dangling link is still there');
});

test('only the last element whose data-block is sources, and only a closed one, is left out of the mention check', () => {
  const step = (html) => (w) => { const f = join(w, 'lessons', '0002-two.html'); writeFileSync(f, readFileSync(f, 'utf8').replace('<section data-block="sources">', `${html}<section data-block="sources">`)); };
  const early = exportRepo({ edit: step('<p><span data-block="sources">Type it in the terminal.</span></p>') });
  const r = cli(early.ws, '--out', outDir());
  assert.equal(r.status, 1);
  assert.deepEqual(lines(r, 'mention'), ['mention lessons/0002-two.html: Type it in the terminal.']);
  const open = exportRepo({ edit: (w) => { const f = join(w, 'lessons', '0002-two.html'); writeFileSync(f, readFileSync(f, 'utf8').replace('</body>', '<aside data-block="sources"><p>Ask Claude Code.</p></body>')); } });
  const r2 = cli(open.ws, '--out', outDir());
  assert.equal(r2.status, 1);
  assert.deepEqual(lines(r2, 'mention'), ['mention lessons/0002-two.html: Ask Claude Code.']);
});
