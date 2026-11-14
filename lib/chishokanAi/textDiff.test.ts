import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedChars, diffText, type DiffPart } from './textDiff.ts';

const join = (ps: DiffPart[], side: 'before' | 'after') =>
  ps.filter((p) => p.kind === 'same' || p.kind === (side === 'before' ? 'del' : 'add')).map((p) => p.text).join('');

test('同じ文は same だけ', () => {
  assert.deepEqual(diffText('冬期講習', '冬期講習'), [{ kind: 'same', text: '冬期講習' }]);
  assert.deepEqual(diffText('', ''), []);
});

test('一部を変えると、変えた所だけが del と add になる', () => {
  const d = diffText('定員は20名です。締切は12月1日。', '定員は25名です。締切は12月1日。');
  assert.deepEqual(d, [
    { kind: 'same', text: '定員は2' },
    { kind: 'del', text: '0' },
    { kind: 'add', text: '5' },
    { kind: 'same', text: '名です。締切は12月1日。' },
  ]);
  assert.equal(changedChars(d), 2);
});

test('どちらの側も、元の文に戻せる', () => {
  const a = '対象：中学3年生\n日程：12月25日〜28日\n持ち物：筆記用具';
  const b = '対象：中学2・3年生\n日程：12月26日〜29日\n持ち物：筆記用具・問題集\n申込：窓口';
  const d = diffText(a, b);
  assert.equal(join(d, 'before'), a);
  assert.equal(join(d, 'after'), b);
});

test('足しただけ・消しただけ', () => {
  assert.deepEqual(diffText('ABC', 'ABXC'), [{ kind: 'same', text: 'AB' }, { kind: 'add', text: 'X' }, { kind: 'same', text: 'C' }]);
  assert.deepEqual(diffText('ABXC', 'ABC'), [{ kind: 'same', text: 'AB' }, { kind: 'del', text: 'X' }, { kind: 'same', text: 'C' }]);
  assert.deepEqual(diffText('', '新しい'), [{ kind: 'add', text: '新しい' }]);
});

test('短い偶然の一致で細切れにしない', () => {
  const d = diffText('保護者の方へのお知らせ', '生徒向けの案内');
  // 「の」だけが一致して、消した・足した・一致が何度も入れ替わらない
  assert.ok(d.filter((p) => p.kind === 'same').length <= 1, JSON.stringify(d));
  assert.equal(join(d, 'before'), '保護者の方へのお知らせ');
  assert.equal(join(d, 'after'), '生徒向けの案内');
});

test('長い文は文の単位で比べる', () => {
  const a = Array.from({ length: 400 }, (_, i) => `これは${i}番目の文です。`).join('');
  const b = a.replace('これは150番目の文です。', 'これは百五十番目の文に直しました。').replace('これは300番目の文です。', '');
  const d = diffText(a, b);
  assert.equal(join(d, 'before'), a);
  assert.equal(join(d, 'after'), b);
  assert.ok(changedChars(d) < 100, String(changedChars(d)));
});

test('絵文字の途中で切らない', () => {
  const d = diffText('📌メモ', '📎メモ');
  assert.equal(join(d, 'before'), '📌メモ');
  assert.equal(join(d, 'after'), '📎メモ');
  for (const p of d) assert.ok(!/[\ud800-\udbff]$/.test(p.text), JSON.stringify(d));
});
