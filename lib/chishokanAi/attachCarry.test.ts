// 添付した PDF・画像の持ち越し（attachCarry.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachOnlyQuestion, carriedNote, carryForSend, CARRY_MAX_CHARS, CARRY_MAX_FILES, nextCarry, type HeavyAttach } from './attachCarry.ts';

const pdf = (name: string, size = 10): HeavyAttach => ({ name, mime: 'application/pdf', kind: 'pdf', data: 'x'.repeat(size) });

test('nextCarry：新しく送ったものを先に、同じ名前は新しい方、件数の上限まで', () => {
  const prev = [pdf('模試.pdf'), pdf('図.png')];
  const r = nextCarry(prev, [pdf('大問４・５.pdf'), pdf('模試.pdf', 20)]);
  assert.deepEqual(r.keep.map((a) => a.name), ['大問４・５.pdf', '模試.pdf', '図.png']);
  assert.equal(r.keep[1].data.length, 20);
  const more = nextCarry(r.keep, [pdf('追加.pdf')]);
  assert.equal(more.keep.length, CARRY_MAX_FILES);
  assert.deepEqual(more.dropped, ['図.png']);
});

test('nextCarry：大きさの上限を超えるものは外す。文字の添付は持ち越さない', () => {
  const big = pdf('大きい.pdf', CARRY_MAX_CHARS - 5);
  const r = nextCarry([pdf('前の.pdf', 10)], [big]);
  assert.deepEqual(r.keep.map((a) => a.name), ['大きい.pdf']);
  assert.deepEqual(r.dropped, ['前の.pdf']);
  const t = nextCarry([], [{ name: 'メモ.txt', mime: 'text/plain', kind: 'text', data: 'abc' } as unknown as HeavyAttach]);
  assert.deepEqual(t.keep, []);
});

test('carryForSend：新しい添付と合わせて上限を超えないよう、古いものから外す', () => {
  const carried = [pdf('新しい.pdf', 40), pdf('古い.pdf', 40)];
  assert.deepEqual(carryForSend(carried, [], 100).send.map((a) => a.name), ['新しい.pdf', '古い.pdf']);
  const r = carryForSend(carried, [{ name: '今回.pdf', data: 'x'.repeat(30) }], 100);
  assert.deepEqual(r.send.map((a) => a.name), ['新しい.pdf']);
  assert.deepEqual(r.dropped, ['古い.pdf']);
  // 同じ名前を付け直したら、新しい方だけを送る
  assert.deepEqual(carryForSend(carried, [{ name: '古い.pdf', data: 'y' }], 100).send.map((a) => a.name), ['新しい.pdf']);
});

test('carriedNote・attachOnlyQuestion', () => {
  assert.match(carriedNote(['模試.pdf', '大問４・５.pdf']), /模試\.pdf、大問４・５\.pdf/);
  assert.match(carriedNote(['a.pdf']), /渡されていない」と言わない/);
  // 2026-11-16：会話の途中で PDF だけを送ったら、方針チェックになった
  assert.equal(attachOnlyQuestion({ ongoing: true }), '資料を添付しました。この資料も使って、前の続きを進めてください。');
  assert.equal(attachOnlyQuestion({ ongoing: false, task: '方針チェック' }), '添付した資料で「方針チェック」を進めてください。');
  assert.doesNotMatch(attachOnlyQuestion({ ongoing: false }), /方針/);
});
