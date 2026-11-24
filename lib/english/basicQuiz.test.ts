// 基本単語・不規則動詞の小テストの選び方（wordQuiz.ts の後半）と元データ（data/basic.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basicCategoryList, buildBasicQuiz, BASIC_GROUPS } from './wordQuiz.ts';
import { BASIC_WORDS, IRREGULAR_VERBS } from './data/basic.ts';

const DATA = { words: BASIC_WORDS, verbs: IRREGULAR_VERBS };
let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const group = (name: string) => BASIC_GROUPS.find((g) => g.name === name)!;

test('元データ：語の数と、空の欄が無い', () => {
  assert.equal(BASIC_WORDS.length, 1842);
  assert.equal(IRREGULAR_VERBS.length, 85);
  for (const w of BASIC_WORDS) assert.ok(w.en && w.ja && w.pos && w.category, `${w.no}:${w.en}`);
  for (const v of IRREGULAR_VERBS) assert.ok(v.base && v.past && v.pp && v.ja, `${v.no}:${v.base}`);
  assert.equal(new Set(BASIC_WORDS.map((w) => w.no)).size, BASIC_WORDS.length);
});

test('まとまり：曜日7・月12・数字31・序数', () => {
  assert.equal(BASIC_WORDS.filter(group('曜日').test).length, 7);
  assert.equal(BASIC_WORDS.filter(group('月').test).length, 12);
  assert.equal(BASIC_WORDS.filter(group('数字').test).length, 31);
  assert.ok(BASIC_WORDS.filter(group('序数').test).every((w) => /番目$/.test(w.ja)));
});

test('曜日と月：日→英、一覧の順', () => {
  const r = buildBasicQuiz(DATA, { kind: 'words', categories: ['曜日', '月'] });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.range, '基本単語（曜日・月）');
  assert.equal(r.value.title, '英語 基本単語（曜日・月） 単語テスト');
  const qs = r.value.versions[0].questions;
  assert.equal(qs.length, 19);
  assert.deepEqual(qs[0], { kind: 'word', prompt: '日曜日', answer: 'Sunday', toEn: true, star: false });
  assert.equal(r.value.source, 'words');
});

test('分類・品詞・学年の目安で絞る。同じつづりは1問', () => {
  const r = buildBasicQuiz(DATA, { kind: 'words', categories: ['重要熟語'], levels: ['中2'], count: 20, order: 'random', random });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.versions[0].questions.length, 20);
  assert.equal(r.value.range, '基本単語（重要熟語・中2）');
  const all = buildBasicQuiz(DATA, { kind: 'words', levels: ['中1'], pos: ['動詞'] });
  assert.ok(all.ok);
  if (all.ok) {
    const en = all.value.versions[0].questions.map((q) => (q.kind === 'word' ? q.answer : ''));
    assert.equal(new Set(en).size, en.length);
  }
});

test('不規則動詞：原形を見て過去形・過去分詞、A版・B版', () => {
  const r = buildBasicQuiz(DATA, { kind: 'verbs', levels: ['中1'], count: 20, versions: 2, random });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.source, 'verbs');
  assert.equal(r.value.range, '不規則動詞（中1）');
  const [a, b] = r.value.versions;
  assert.equal(a.questions.length, 20);
  assert.deepEqual([...a.questions].map((q) => JSON.stringify(q)).sort(), [...b.questions].map((q) => JSON.stringify(q)).sort());
  const be = buildBasicQuiz(DATA, { kind: 'verbs', verbAsk: 'all' });
  assert.ok(be.ok);
  if (be.ok) assert.deepEqual(be.value.versions[0].questions[0], { kind: 'verb', ja: '～である、いる', base: 'be', past: 'was / were', pp: 'been', ask: 'all' });
});

test('無い分類・学年は、選べるものを返す', () => {
  const r = buildBasicQuiz(DATA, { kind: 'words', categories: ['宇宙'] });
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.message, /曜日（7語/);
  const l = buildBasicQuiz(DATA, { kind: 'verbs', levels: ['中3'] });
  assert.ok(!l.ok);
  assert.match(basicCategoryList(DATA), /不規則動詞の変化のテスト：85語/);
});
