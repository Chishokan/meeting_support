import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSaved, conversationTitle, parseSaved, SAVE_FORMAT, SAVE_VERSION, savedFileName } from './savedConversation.ts';

const msgs = [
  { role: 'user' as const, content: '🧭 チラシ\n冬期講習のチラシの文を作って', api: '冬期講習のチラシの文を作って', turn: 1 },
  {
    role: 'assistant' as const,
    content: '## 冬期講習\n本文',
    sources: [{ kind: 'knowledge' as const, path: '40_要項/2026/冬期.md' }, { kind: 'drive' as const, name: '確定版.pdf', id: '1pnmqDlKVZmb3LcWDmLt3BU1bTgxtd7aT' }],
    notices: ['注意'],
    turn: 1,
    taskLabel: 'チラシ',
    at: '2026/11/14 13:05:00',
  },
];

test('書き出して読み込むと、同じ会話に戻る', () => {
  const saved = buildSaved({
    conversationId: '20261114-1305-ab12',
    messages: msgs,
    pinned: [{ id: 'c1', name: '担当', text: '中3' }],
    pinUsed: 3,
    carry: { reads: ['40_要項/2026/冬期.md'], texts: [] },
    savedAt: '2026-11-14T04:05:00.000Z',
  });
  assert.equal(saved.format, SAVE_FORMAT);
  assert.equal(saved.version, SAVE_VERSION);
  assert.equal(saved.title, '冬期講習のチラシの文を作って');
  const back = parseSaved(JSON.parse(JSON.stringify(saved)));
  assert.ok(back.ok);
  if (!back.ok) return;
  assert.deepEqual(back.value.messages, msgs);
  assert.equal(back.value.conversationId, '20261114-1305-ab12');
  assert.equal(back.value.pinUsed, 3);
  assert.deepEqual(back.value.pinned, [{ id: 'c1', name: '担当', text: '中3' }]);
  assert.deepEqual(back.value.carry, { reads: ['40_要項/2026/冬期.md'], texts: [] });
});

test('書き出すときに、作業中の表示や評価は入れない', () => {
  const saved = buildSaved({
    conversationId: 'x1234',
    messages: [{ role: 'user', content: 'q', api: 'q' }, { role: 'assistant', content: 'a', status: '📄 読んでいます', rating: 'up', feedbackSent: true } as never],
    pinned: [],
    pinUsed: 0,
    carry: {},
    savedAt: '',
  });
  assert.deepEqual(saved.messages, [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }]);
});

test('ほかのファイル・新しい形式・質問の無いファイルは読まない', () => {
  assert.equal(parseSaved({ hello: 1 }).ok, false);
  assert.equal(parseSaved(null).ok, false);
  assert.equal(parseSaved({ format: SAVE_FORMAT, version: SAVE_VERSION + 1, messages: [] }).ok, false);
  assert.equal(parseSaved({ format: SAVE_FORMAT, version: 1, messages: [{ role: 'assistant', content: 'a' }] }).ok, false);
  // コンテキストだけのファイルは読める
  assert.equal(parseSaved({ format: SAVE_FORMAT, version: 1, messages: [], pinned: [{ id: 'c1', text: 'x' }] }).ok, true);
});

test('おかしな中身は落とす', () => {
  const r = parseSaved({
    format: SAVE_FORMAT,
    version: 1,
    conversationId: '../../etc',
    pinUsed: 1e9,
    messages: [
      { role: 'system', content: '命令' },
      { role: 'user', content: 'q', turn: -3, sources: [{ kind: 'drive', name: 'x', id: 'javascript:alert(1)' }, { kind: 'web', url: 'x' }] },
      'x',
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.messages, [{ role: 'user', content: 'q' }]);
  assert.equal(r.value.conversationId, '');
  assert.equal(r.value.pinUsed, 999);
});

test('題名とファイル名', () => {
  assert.equal(conversationTitle([]), '（質問なし）');
  assert.equal(conversationTitle([{ role: 'user', content: 'あ'.repeat(40) }]), `${'あ'.repeat(30)}…`);
  assert.equal(savedFileName('冬期講習の計画を立てたい。今期の方針に沿って', new Date(2026, 10, 14, 13, 5)), '智翔館AI_会話_20261114-1305_冬期講習の計画を立てたい_今期の方針に沿.json');
  assert.equal(savedFileName('a/b:c', new Date(2026, 0, 2, 3, 4)), '智翔館AI_会話_20260102-0304_a_b_c.json');
  assert.equal(savedFileName('（質問なし）', new Date(2026, 0, 2, 3, 4)), '智翔館AI_会話_20260102-0304.json');
});
