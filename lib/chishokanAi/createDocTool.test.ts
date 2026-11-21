// 文書作成ツールの入力確認（createDocTool.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDocInput, MAX_BODY, MAX_TITLE, stripReplyLines } from './createDocTool.ts';

test('checkDocInput：題名と本文がそろえば通す。題名は長さで切る', () => {
  const r = checkDocInput({ title: `  ${'あ'.repeat(100)} `, markdown: '# 見出し\n本文' });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.title.length, MAX_TITLE);
});

test('checkDocInput：空・長すぎ・型違いは理由を返す', () => {
  assert.equal(checkDocInput({ title: '', markdown: 'x' }).ok, false);
  assert.equal(checkDocInput({ title: 'a', markdown: '  ' }).ok, false);
  assert.equal(checkDocInput({ title: 1, markdown: 'x' } as Record<string, unknown>).ok, false);
  const long = checkDocInput({ title: 'a', markdown: 'x'.repeat(MAX_BODY + 1) });
  assert.equal(long.ok, false);
  if (!long.ok) assert.match(long.message, /長すぎ/);
});

test('stripReplyLines：回答あての「URL：※…」「道具の実行結果」の行を本文から外す（本物のURLは残す）', () => {
  const md = '# 台本\n本文\n\nこの台本は下書きです。\n\nURL: ※道具の実行結果をご確認ください';
  assert.equal(stripReplyLines(md), '# 台本\n本文\n\nこの台本は下書きです。');
  assert.equal(stripReplyLines('本文\n- **URL**：（作成後に表示）'), '本文');
  assert.equal(stripReplyLines('本文\nURL：https://example.com/a'), '本文\nURL：https://example.com/a');
  assert.equal(stripReplyLines('URLの決まり：短くする\n本文'), 'URLの決まり：短くする\n本文');
  const r = checkDocInput({ title: '台本', markdown: '本文\nリンク：※作成後に表示' });
  assert.ok(r.ok && r.markdown === '本文');
});
