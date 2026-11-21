// 英語の単語テストの選び方（wordQuiz.ts）と元データ（data/chu1.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWordQuiz, findSection, kwtParts, rangeList } from './wordQuiz.ts';
import { CHU1 } from './data/chu1.ts';

const BOOKS = [CHU1];
let seed = 1;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('元データ：中1 Unit4 の区分と、語・KWT の数', () => {
  const u = CHU1.units.find((x) => x.unit === '4')!;
  assert.deepEqual(u.sections.map((s) => s.id), ['Part1', 'Part2', 'Part3, T&S', '教科書本文', '4-1〜3', "Let's Talk1", "Project1, Let's Listen1", '人称代名詞']);
  assert.deepEqual(u.sections.map((s) => s.words.length), [28, 12, 27, 13, 6, 12, 26, 7]);
  assert.deepEqual(u.sections.map((s) => s.words.filter((w) => w.star).length), [7, 8, 7, 0, 6, 3, 8, 7]);
  assert.deepEqual(u.sections.map((s) => s.kwt.length), [3, 4, 5, 0, 3, 3, 9, 0]);
  // KWT の番号は重ならず、どの問題にも答えの [[ ]] がある
  const kwt = u.sections.flatMap((s) => s.kwt);
  assert.equal(new Set(kwt.map((k) => k.no)).size, kwt.length);
  for (const k of kwt) assert.match(k.en, /\[\[.+?\]\]/, `KWT(${k.no})`);
  // 空の英語・日本語が無い
  for (const s of u.sections) for (const w of s.words) assert.ok(w.en && w.ja && w.pron, `${s.id}:${w.en}`);
});

test('buildWordQuiz：区分を選び、☆だけ・日→英', () => {
  const r = buildWordQuiz(BOOKS, { grade: '中1', unit: '4', sections: ['part1', 'Part 2'], starOnly: true });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.range, '中1 Unit4（Part1・Part2）');
  assert.equal(r.value.available, 15);
  const qs = r.value.versions[0].questions;
  assert.equal(qs.length, 15);
  assert.deepEqual(qs[0], { kind: 'word', prompt: '国', answer: 'country', toEn: true, star: true });
  assert.equal(r.value.title, '英語 中1 Unit4（Part1・Part2） 単語テスト');
});

test('buildWordQuiz：同じ語は1問にする（also・kind など）', () => {
  const r = buildWordQuiz(BOOKS, { grade: '1', unit: 'Unit4' });
  assert.ok(r.ok);
  if (!r.ok) return;
  const en = r.value.versions[0].questions.map((q) => (q.kind === 'word' ? q.answer : ''));
  assert.equal(en.filter((x) => x === 'also').length, 1);
  assert.equal(new Set(en).size, en.length);
});

test('buildWordQuiz：数を減らす・A版とB版は同じ問題で並びが違う・mix は語ごとに問い方が決まる', () => {
  const r = buildWordQuiz(BOOKS, { grade: '中1', unit: '4', sections: ['Part3'], count: 20, versions: 2, direction: 'mix', random });
  assert.ok(r.ok);
  if (!r.ok) return;
  const [a, b] = r.value.versions;
  assert.equal(a.label, 'A');
  assert.equal(b.label, 'B');
  assert.equal(a.questions.length, 20);
  const key = (q: (typeof a.questions)[number]) => JSON.stringify(q);
  assert.deepEqual([...a.questions].map(key).sort(), [...b.questions].map(key).sort());
  assert.notDeepEqual(a.questions.map(key), b.questions.map(key));
  assert.ok(a.questions.some((q) => q.kind === 'word' && q.toEn) && a.questions.some((q) => q.kind === 'word' && !q.toEn));
});

test('buildWordQuiz：KWT', () => {
  const r = buildWordQuiz(BOOKS, { grade: '中1', unit: '4', sections: ["Let's Talk 1"], source: 'kwt' });
  assert.ok(r.ok);
  if (!r.ok) return;
  const q = r.value.versions[0].questions[0];
  assert.deepEqual(q, { kind: 'kwt', ja: '私はシャツを買いたいです。', en: 'I want to buy [[shirts]].', note: 'shirt は複数形にする。' });
  const none = buildWordQuiz(BOOKS, { grade: '中1', unit: '4', sections: ['教科書本文'], source: 'kwt' });
  assert.ok(!none.ok);
  if (!none.ok) assert.match(none.message, /KWT がある区分：Part1/);
});

test('buildWordQuiz：無い範囲は、入っている範囲を返す', () => {
  const r = buildWordQuiz(BOOKS, { grade: '中2', unit: '1' });
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.message, /中1 Unit4/);
  const s = buildWordQuiz(BOOKS, { grade: '中1', unit: '4', sections: ['Part9'] });
  assert.ok(!s.ok);
  if (!s.ok) assert.match(s.message, /区分：Part1／Part2/);
  assert.match(rangeList(BOOKS), /Part1（28語・☆7・KWT3問）/);
});

test('findSection・kwtParts', () => {
  const u = CHU1.units.find((x) => x.unit === '4')!;
  assert.equal(findSection(u, 'Project1')?.id, "Project1, Let's Listen1");
  assert.equal(findSection(u, '4-1~3')?.id, '4-1〜3');
  assert.deepEqual(kwtParts("[[It]] is a [[large]] [[country]]."), [
    { text: 'It', blank: true }, { text: ' is a ', blank: false }, { text: 'large', blank: true }, { text: ' ', blank: false }, { text: 'country', blank: true }, { text: '.', blank: false },
  ]);
});
