import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenText } from '../bin/lib/screen.mjs';

// S-11: each input with the line it must become; expected values are written out, never computed.
const rows = (list) => { for (const [input, max, want] of list) assert.equal(screenText(input, max), want, JSON.stringify(input)); };

test('screenText makes a value one line: each line break becomes a space', () => rows([
  ['a\nb\rc\u0085d\u2028e\u2029f', undefined, 'a b c d e f'],
  ['tab\there\vand\ffeed', undefined, 'tab here and feed'],
]));

// One row per class of invisible character; the visible text around each must survive unchanged.
test('screenText removes controls and invisible format characters', () => rows([
  ['bell\u0007 nul\u0000 esc\u001b[31m del\u007f c1\u009b.', undefined, 'bell nul esc[31m del c1.'],
  ['zero\u200bwidth\u200c\u200d join\u2060 bom\ufeff.', undefined, 'zerowidth join bom.'],
  ['bidi\u200e\u200f \u202aa\u202bb\u202cc\u202dd\u202ee \u2066f\u2067g\u2068h\u2069i \u061cj', undefined, 'bidi abcde fghi j'],
  // tag characters spelling "ignore" after a visible title, with the tag begin and cancel marks
  ['Title\u{E0001}\u{E0069}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}\u{E007F}', undefined, 'Title'],
  ['var\ufe0fiation\ufe00 sel\u{E0100}ector', undefined, 'variation selector'],
  ['inter\ufff9base\ufffaannotation\ufffblinear', undefined, 'interbaseannotationlinear'],
  ['han\u115fgul\u1160 fil\u3164ler\uffa0s', undefined, 'hangul fillers'],
  ['soft\u00adhyphen cgj\u034f mvs\u180e khmer\u17b4\u17b5 math\u2061\u2062\u2063\u2064 deprecated\u206a\u206f', undefined, 'softhyphen cgj mvs khmer math deprecated'],
  ['music\u{1D173}\u{1D17A} hiero\u{13430}\u{1343F}glyph', undefined, 'music hieroglyph'],
]));

test('screenText keeps accented letters, CJK, emoji, dashes and curly quotes', () => rows([
  ['caf\u00e9 \u4e2d\u6587 \u{1F600} a\u2013b\u2014c \u2018x\u2019 \u201cy\u201d', undefined, 'caf\u00e9 \u4e2d\u6587 \u{1F600} a\u2013b\u2014c \u2018x\u2019 \u201cy\u201d'],
]));

test('screenText collapses runs of spaces and trims the value', () => rows([
  ['  many    spaces \n\n  here  ', undefined, 'many spaces here'],
  [42, undefined, '42'],
]));

test('screenText cuts a value longer than the limit by code points and ends it with the mark', () => rows([
  ['abcdefghij', 10, 'abcdefghij'],
  ['abcdefghijk', 10, 'abcdefghi\u2026'],
  ['abcd efghijk', 6, 'abcd\u2026'],
  ['x'.repeat(301), undefined, `${'x'.repeat(299)}\u2026`],
  ['\u{1F600}\u{1F600}\u{1F600}\u{1F600}', 3, '\u{1F600}\u{1F600}\u2026'],
]));
