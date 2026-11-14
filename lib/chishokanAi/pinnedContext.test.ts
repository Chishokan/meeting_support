import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPinnedBlock,
  checkPinLog,
  checkProposal,
  guessPinName,
  newPinned,
  nextPinId,
  normalizePinnedForApi,
  normalizePinnedList,
  pinLogEntry,
  PIN_MAX_HISTORY,
  PIN_MAX_ITEMS,
  PIN_MAX_TEXT,
  PIN_TOTAL_CHARS,
  replacePinned,
  restorePinned,
} from './pinnedContext.ts';

test('API に届いた項目：形の違うもの・同じ番号・空の文は落とす', () => {
  const got = normalizePinnedForApi([
    { id: 'c1', name: '担当', text: ' 中3を担当 ' },
    { id: 'c1', name: '重複', text: 'x' },
    { id: 'x9', name: '番号がおかしい', text: 'x' },
    { id: 'c2', name: '', text: '' },
    { id: 'c3', name: '', text: '名前なし' },
    'ちがう形',
  ]);
  assert.deepEqual(got, [
    { id: 'c1', name: '担当', text: '中3を担当' },
    { id: 'c3', name: 'c3', text: '名前なし' },
  ]);
  assert.deepEqual(normalizePinnedForApi(null), []);
});

test('API に届いた項目：数・長さ・合計の上限', () => {
  const many = Array.from({ length: PIN_MAX_ITEMS + 3 }, (_, i) => ({ id: `c${i + 1}`, name: 'n', text: 'あ' }));
  assert.equal(normalizePinnedForApi(many).length, PIN_MAX_ITEMS);
  const long = normalizePinnedForApi([{ id: 'c1', name: 'n', text: 'あ'.repeat(PIN_MAX_TEXT + 50) }]);
  assert.equal(long[0].text.length, PIN_MAX_TEXT);
  const big = Array.from({ length: 4 }, (_, i) => ({ id: `c${i + 1}`, name: 'n', text: 'あ'.repeat(PIN_MAX_TEXT) }));
  const kept = normalizePinnedForApi(big);
  assert.equal(kept.length, Math.floor(PIN_TOTAL_CHARS / PIN_MAX_TEXT));
});

test('AI に渡す文：番号と名前と本文', () => {
  assert.equal(buildPinnedBlock([]), '');
  const b = buildPinnedBlock([{ id: 'c1', name: '担当', text: '中3' }, { id: 'c2', name: '決まり', text: '敬体で' }]);
  assert.match(b, /^【コンテキスト/);
  assert.match(b, /■ c1「担当」\n中3/);
  assert.match(b, /■ c2「決まり」\n敬体で/);
  assert.match(b, /propose_context_edit/);
});

test('直し案の確かめ', () => {
  const items = [{ id: 'c1', name: '担当', text: '中3' }];
  assert.deepEqual(checkProposal({ id: 'c1', name: '', text: '中2・中3', summary: '中2を足した' }, items), {
    ok: true,
    proposal: { id: 'c1', name: '担当', text: '中2・中3', summary: '中2を足した' },
  });
  const missing = checkProposal({ id: 'c7', name: 'x', text: 'y', summary: '' }, items);
  assert.equal(missing.ok, false);
  assert.match(!missing.ok ? missing.message : '', /c1「担当」/);
  assert.equal(checkProposal({ id: 'c1', name: '担当', text: '中3', summary: '' }, items).ok, false);
  assert.equal(checkProposal({ id: 'c1', name: '担当', text: '', summary: '' }, items).ok, false);
  assert.equal(checkProposal({ id: 'c1', name: '担当', text: 'あ'.repeat(PIN_MAX_TEXT + 1), summary: '' }, items).ok, false);
  // 新しい項目
  assert.deepEqual(checkProposal({ id: '', name: '日程', text: '12/25〜', summary: '日程を足す' }, items), {
    ok: true,
    proposal: { id: '', name: '日程', text: '12/25〜', summary: '日程を足す' },
  });
  assert.equal(checkProposal({ id: '', name: '', text: 'x', summary: '' }, items).ok, false);
  const full = Array.from({ length: PIN_MAX_ITEMS }, (_, i) => ({ id: `c${i + 1}`, name: 'n', text: 't' }));
  assert.equal(checkProposal({ id: '', name: '日程', text: 'x', summary: '' }, full).ok, false);
});

test('書き換えると前の版が残り、上限を超えたら古い版から消える', () => {
  let p = newPinned('c1', '担当', '版0', 'added', 't0');
  for (let i = 1; i <= PIN_MAX_HISTORY + 2; i++) p = replacePinned(p, '担当', `版${i}`, i % 2 ? 'ai' : 'self', `t${i}`);
  assert.equal(p.text, `版${PIN_MAX_HISTORY + 2}`);
  assert.equal(p.history.length, PIN_MAX_HISTORY);
  assert.equal(p.history[p.history.length - 1].text, `版${PIN_MAX_HISTORY + 1}`);
  assert.equal(p.history[0].text, '版2');
  // 同じ文なら版を増やさない（名前だけ変わる）
  const same = replacePinned(p, '担当（中3）', p.text, 'self', 'tx');
  assert.equal(same.history.length, p.history.length);
  assert.equal(same.name, '担当（中3）');
});

test('前の版に戻しても、戻す前の文は版に残る', () => {
  let p = newPinned('c1', '担当', 'A', 'added', 't0');
  p = replacePinned(p, '担当', 'B', 'ai', 't1');
  p = replacePinned(p, '担当', 'C', 'self', 't2');
  const r = restorePinned(p, 0, 't3');
  assert.equal(r.text, 'A');
  assert.equal(r.by, 'restore');
  assert.deepEqual(r.history.map((v) => v.text), ['B', 'C']);
  assert.equal(restorePinned(p, 9, 't3'), p);
});

test('番号は使い回さない', () => {
  assert.deepEqual(nextPinId([]), { id: 'c1', used: 1 });
  assert.deepEqual(nextPinId([{ id: 'c1' }, { id: 'c4' }]), { id: 'c5', used: 5 });
  assert.deepEqual(nextPinId([{ id: 'c1' }], 6), { id: 'c7', used: 7 });
});

test('名前の候補', () => {
  assert.equal(guessPinName('## 冬期講習の計画\n本文'), '冬期講習の計画');
  assert.equal(guessPinName('**大事**なこと\n本文'), '大事なこと');
  assert.equal(guessPinName('1. まず確認\n2. 次'), 'まず確認');
  assert.equal(guessPinName(''), 'メモ');
});

test('会話ログの1行', () => {
  const e = pinLogEntry({ conversationId: '20261114-1200-abcd', action: '追加', id: 'c1', name: '担当', text: 'あ'.repeat(250) });
  assert.equal(e.input, '[智翔館AI・コンテキスト]（会話: 20261114-1200-abcd） 追加：c1「担当」（250字）');
  assert.equal(e.output, `${'あ'.repeat(200)}…`);
  assert.equal(pinLogEntry({ conversationId: '', action: '削除', id: 'c1', name: '担当', text: 'x' }).output, '');
  assert.equal(checkPinLog({ action: '追加', id: 'c1', name: 'n', text: 't' })?.action, '追加');
  assert.equal(checkPinLog({ action: '勝手な操作', id: 'c1' }), null);
  assert.equal(checkPinLog({ action: '追加', id: '../x' }), null);
  assert.equal(checkPinLog({ action: '追加', id: 'c1', conversationId: 'bad id!' })?.conversationId, '');
});

test('ファイルから読んだ項目：版の履歴も確かめる', () => {
  const got = normalizePinnedList([
    {
      id: 'c2', name: '担当', text: '中3', by: 'ai', at: '2026-11-14T03:00:00.000Z',
      history: [{ text: '中2', name: '担当', at: 't0', by: 'added' }, { text: '', by: 'self' }, 'x', { text: '中1', by: '不明' }],
    },
    { id: 'c2', name: '重複', text: 'x' },
    { id: 'bad', text: 'x' },
    { id: 'c5', text: '名前なし', by: 'hack' },
  ]);
  assert.deepEqual(got, [
    {
      id: 'c2', name: '担当', text: '中3', by: 'ai', at: '2026-11-14T03:00:00.000Z',
      history: [{ text: '中2', name: '担当', at: 't0', by: 'added' }, { text: '中1', name: 'c2', at: '', by: 'added' }],
    },
    { id: 'c5', name: 'c5', text: '名前なし', by: 'added', at: '', history: [] },
  ]);
  assert.deepEqual(normalizePinnedList('x'), []);
});
