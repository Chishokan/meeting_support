import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canUseColor, colorMembers } from './colorAccess.ts';

test('管理者は誰でも使える', () => {
  assert.equal(canUseColor('智翔 太郎', 'admin', ''), true);
});

test('未設定なら既定のメンバーだけ', () => {
  assert.equal(canUseColor('亀谷新', 'staff', ''), true);
  assert.equal(canUseColor('福元 崇恭', 'staff', ''), true);
  assert.equal(canUseColor('智翔 太郎', 'staff', ''), false);
  assert.equal(canUseColor('智翔 太郎', undefined, ''), false);
});

test('環境変数で足せる・空白は無視する', () => {
  assert.deepEqual(colorMembers('安藤 純平, 冨松太一'), ['安藤純平', '冨松太一']);
  assert.equal(canUseColor('安藤純平', 'staff', '安藤 純平,冨松太一'), true);
  assert.equal(canUseColor('亀谷新', 'staff', '安藤純平'), false);
});

test('「*」で全員', () => {
  assert.equal(canUseColor('誰か', 'employee', '*'), true);
});
