import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, serializeFrontmatter } from '../bin/lib/frontmatter.mjs';

const sample = `---
title: "Effective Go"
type: source
created: 2026-05-06
topics: [go, errors]
related: []
verifications:
  - date: 2026-05-06
    by_type: agent
    by_id: claude-opus-4-7
    method: refetched-source
    result: confirmed
    notes: "hash unchanged"
subject:
  name: vcluster
  version: "0.19"
---
# Body
text here
`;

test('CRLF frontmatter has the same declared data as LF, including nested and block values', () => {
  const lf = '---\ntitle: Example\ntopics: [one, two]\nsubject:\n  name: Tool\n  version: "1"\nverifications:\n  - date: 2026-01-01\n    notes: checked\nsummary: |\n  first\n  second\n---\nBody\n';
  const expected = { title: 'Example', topics: ['one', 'two'], subject: { name: 'Tool', version: '1' }, verifications: [{ date: '2026-01-01', notes: 'checked' }], summary: 'first\nsecond\n' };
  assert.deepEqual(parseFrontmatter(lf).data, expected);
  assert.deepEqual(parseFrontmatter(lf.replace(/\n/g, '\r\n')).data, expected);
});

test('a CR inside a scalar line remains content at every nesting level', () => {
  const text = '---\ntitle: a\rb\nsubject:\n  name: c\rd\nverifications:\n  - notes: e\rf\n    by_id: g\rh\n---\n';
  assert.deepEqual(parseFrontmatter(text).data, { title: 'a\rb', subject: { name: 'c\rd' }, verifications: [{ notes: 'e\rf', by_id: 'g\rh' }] });
});

test('parses scalars, flow lists, block-map sequences, nested map', () => {
  const { data, body } = parseFrontmatter(sample);
  assert.equal(data.title, 'Effective Go');
  assert.equal(data.type, 'source');
  assert.deepEqual(data.topics, ['go', 'errors']);
  assert.deepEqual(data.related, []);
  assert.equal(data.verifications.length, 1);
  assert.equal(data.verifications[0].method, 'refetched-source');
  assert.equal(data.subject.version, '0.19');
  assert.match(body, /# Body/);
});

test('round-trip is stable', () => {
  const { data, body } = parseFrontmatter(sample);
  const out = serializeFrontmatter(data, body);
  const reparsed = parseFrontmatter(out);
  assert.deepEqual(reparsed.data, data);
});

test('rejects entry with no frontmatter', () => {
  assert.throws(() => parseFrontmatter('no frontmatter here'), /frontmatter/);
});

test('serializer emits no BOM, LF endings, no trailing whitespace', () => {
  const out = serializeFrontmatter({ title: 'x', type: 'note' }, '# b\n');
  assert.equal(out.charCodeAt(0), 0x2d); // '-' not BOM
  assert.ok(!/\r/.test(out));
  assert.ok(!/ \n/.test(out));
});

test('scalar round-trip is idempotent for quotes, brackets, commas, type-looking strings', () => {
  const tricky = [
    'say "hi" now',
    'he said "\\" backslash',
    'a\\b',
    '[2026 roadmap]',
    '[]',
    'one, two, three',
    'true',
    'false',
    '42',
    '-7',
    'plain value',
  ];
  for (const title of tricky) {
    const data = { title, type: 'note' };
    const once = serializeFrontmatter(data, '# b\n');
    const first = parseFrontmatter(once);
    assert.equal(first.data.title, title, `parse(serialize(x)) === x for ${JSON.stringify(title)}`);
    const twice = serializeFrontmatter(first.data, first.body);
    assert.equal(twice, once, `serialize is idempotent for ${JSON.stringify(title)}`);
  }
});

test('body trailing whitespace survives serialization byte-for-byte (minus CR)', () => {
  const body = [
    '# Notes',
    'line with hard break  ',
    'next line',
    '',
    '```',
    'code with trailing spaces   ',
    '\tindented\t',
    '```',
    '',
  ].join('\n');
  const out = serializeFrontmatter({ title: 'x', type: 'snippet' }, '\n' + body);
  const emittedBody = out.slice(out.indexOf('\n---\n') + '\n---\n'.length);
  assert.equal(emittedBody, body);
  assert.ok(/  \n/.test(out), 'markdown hard break preserved');
  assert.ok(/spaces   \n/.test(out), 'code-block trailing spaces preserved');
});

test('two serialize/parse cycles are byte-identical to one', () => {
  const data = {
    title: 'has "quotes" and [brackets]',
    type: 'source',
    topics: ['go', 'errors'],
    count: 3,
  };
  const body = '# Body\nhard break  \nmore\n';
  const once = serializeFrontmatter(data, body);
  const reparsed = parseFrontmatter(once);
  const twice = serializeFrontmatter(reparsed.data, reparsed.body);
  assert.equal(twice, once);
});

test('flow-list commas stay inside their item', () => {
  assert.deepEqual(parseFrontmatter(serializeFrontmatter({ topics: ['a, b', 'c'] }, '')).data.topics, ['a, b', 'c']);
});

test('empty flow-list items survive alongside an empty scalar', () => {
  assert.deepEqual(parseFrontmatter(serializeFrontmatter({ title: '', topics: ['', 'c'] }, '')).data, { title: '', topics: ['', 'c'] });
});

for (const notes of ['first\nsecond', 'first\r\nsecond']) {
  test(`verification notes keep ${JSON.stringify(notes)} on one serialized line`, () => {
    const text = serializeFrontmatter({ verifications: [{ notes }] }, '');
    assert.equal(text.split('\n').length, 5);
    assert.deepEqual(parseFrontmatter(text).data, { verifications: [{ notes }] });
  });
}

for (const value of ['a\rb', 'a\n \nb', 'a\n  ']) {
  test(`top-level control/whitespace content survives: ${JSON.stringify(value)}`, () => {
    assert.equal(parseFrontmatter(serializeFrontmatter({ value }, '')).data.value, value);
  });
}

test('awkward strings round-trip at every supported value position', () => {
  const values = ['', 'a, b', ' lead', 'trail ', '42', '-7', '1.2', 'true', 'false', 'null', '~', '2026-01-01', '#', 'a # b', 'a: b', '- x', '[x]', '{x}', '&x', '*x', '!x', '|', '>', '"', "'", 'a\\b', '\\n', '"\\r"', 'a\tb', 'a\nb', 'a\r\nb', 'a\rb', 'a\n \nb', '\n', '\n\n', 'a\n  ', 'a\n\tb'];
  for (const value of values) for (const position of ['top', 'flow', 'block', 'map', 'row']) {
    const expected = position === 'top' ? { value } : position === 'map' ? { subject: { name: value } } : position === 'row' ? { verifications: [{ notes: value }] } : { values: [value, 'c'] };
    let data = expected;
    if (position === 'block') {
      // Changed block lists use the serializer's flow-list path; unchanged ones retain RAW.
      data = parseFrontmatter('---\nvalues:\n  - seed\n  - c\n---\n').data;
      data.values[0] = value;
    }
    assert.deepEqual(parseFrontmatter(serializeFrontmatter(data, '')).data, expected, `${position}: ${JSON.stringify(value)}`);
  }
});

test('older writer doubled backslashes remain literal before n and r', () => {
  assert.deepEqual(parseFrontmatter('---\nvalue: "a\\\\nb"\nother: "a\\\\rb"\n---\n').data,
    { value: 'a\\nb', other: 'a\\rb' });
});

test('literal carriage returns in preserved block values are escaped before normalization', () => {
  const { data, body } = parseFrontmatter('---\ntitle: |-\n  a\rb\ntopics:\n  - c\rd\n---\n');
  assert.deepEqual(parseFrontmatter(serializeFrontmatter(data, body)).data, { title: 'a\rb', topics: ['c\rd'] });
});


for (const separator of ['\u2028', '\u2029']) {
  for (const position of ['top', 'flow', 'map', 'row-first', 'row-later']) {
    test('line separator ' + JSON.stringify(separator) + ' round-trips in ' + position, () => {
      const value = 'a' + separator + 'b';
      const expected = position === 'top' ? { value }
        : position === 'flow' ? { values: [value] }
        : position === 'map' ? { subject: { value } }
        : position === 'row-first' ? { rows: [{ value }] }
        : { rows: [{ first: 'seed', value }] };
      assert.deepEqual(parseFrontmatter(serializeFrontmatter(expected, '')).data, expected);
    });
  }
}

for (const position of ['top', 'row']) {
  test('flow apostrophes cannot swallow a later item hash in ' + position, () => {
    for (const first of ["x 'y", "x['y"]) {
      const values = [first, "c ' # d"];
      const expected = position === 'top' ? { values } : { rows: [{ values }] };
      assert.deepEqual(parseFrontmatter(serializeFrontmatter(expected, '')).data, expected);
    }
  });
}

test('CRLF block lines normalize to the block bytes written by 5b9ddbd', () => {
  const { data, body } = parseFrontmatter('---\nsummary: |\n  one\r\n  two\r\nvalues:\n  - three\r\n---\n');
  assert.deepEqual(data, { summary: 'one\ntwo\n', values: ['three'] });
  assert.equal(serializeFrontmatter(data, body), '---\nsummary: |\n  one\n  two\nvalues:\n  - three\n---\n');
  assert.equal(serializeFrontmatter(data, body, null, { preserve: false }),
    '---\nsummary: |\n  one\n  two\nvalues: [three]\n---\n');
});
