// 文書作成ツールの入力確認（createDocTool.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDocInput, MAX_BODY, MAX_TITLE } from './createDocTool.ts';

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
