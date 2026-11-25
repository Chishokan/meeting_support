// 助動詞の確認テストの選び方（wordQuiz.ts の buildModalQuiz）と元データ（data/modals.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModalQuiz, kwtParts } from './wordQuiz.ts';
import { MODAL_ITEMS } from './data/modals.ts';

const modal = (r: ReturnType<typeof buildModalQuiz>) => {
  assert.ok(r.ok, r.ok ? '' : r.message);
  return r.value.versions[0].questions.map((q) => (q.kind === 'modal' ? q : assert.fail('modal でない')));
};

test('元データ：25問、番号が1から順、どの問題にも空欄がある', () => {
  assert.equal(MODAL_ITEMS.length, 25);
  MODAL_ITEMS.forEach((x, i) => {
    assert.equal(x.no, i + 1);
    assert.ok(kwtParts(x.body).some((p) => p.blank), `${x.no} に空欄が無い`);
    assert.ok(!/\[\[|\]\]/.test(kwtParts(x.body).map((p) => p.text).join('')), `${x.no} の [[ ]] が閉じていない`);
    assert.equal(x.prompt.includes('{ref}'), x.ref !== undefined, `${x.no} の ref`);
    if (x.ref !== undefined) assert.equal(MODAL_ITEMS.find((y) => y.no === x.ref)?.group, x.group, `${x.no} の指す問題は同じまとまり`);
  });
});

test('元の解答のとおり（いくつか）', () => {
  const ans = (no: number) => kwtParts(MODAL_ITEMS[no - 1].body).filter((p) => p.blank).map((p) => p.text);
  assert.deepEqual(ans(2), ['could', 'was', 'were', 'able', 'to']);
  assert.deepEqual(ans(9), ["don't", "doesn't", 'have', 'to', 'する必要はない', 'しなくてもよい']);
  assert.deepEqual(ans(23), ['All', 'right', 'Sure', 'sorry', "can't"]);
});

test('省くと全25問を元の順で、1枚に入る', () => {
  const r = buildModalQuiz(MODAL_ITEMS);
  const qs = modal(r);
  assert.equal(qs.length, 25);
  assert.ok(r.ok && r.value.range === '助動詞' && r.value.source === 'modals');
  assert.equal(qs[8].prompt, '（8）の答えの否定形と意味');
  assert.equal(qs[16].prompt, '（16）の答え');
});

test('まとまりで絞ると、前の問題を指す番号も出す番号にそろう', () => {
  const r = buildModalQuiz(MODAL_ITEMS, { groups: ['会話'] });
  const qs = modal(r);
  assert.equal(qs.length, 10);
  assert.equal(qs[0].prompt, 'May I ～? の意味');
  assert.equal(qs[1].prompt, '（1）の答え');
  assert.equal(qs[9].prompt, '（9）の答え');
  const m = modal(buildModalQuiz(MODAL_ITEMS, { groups: ['must', 'had better'] }));
  assert.equal(m.length, 8);
  assert.equal(m[4].prompt, '（4）の答えの否定形と意味');
  assert.ok(r.ok && r.value.range === '助動詞（会話の表現）');
});

test('無いまとまりは作らずに一覧を返す', () => {
  const r = buildModalQuiz(MODAL_ITEMS, { groups: ['would'] });
  assert.ok(!r.ok && /can・must・may・will/.test(r.message));
  assert.equal(modal(buildModalQuiz(MODAL_ITEMS, { groups: ['すべて'] })).length, 25);
});
