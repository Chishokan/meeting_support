// Zoom アカウントの設定の読み取り（lib/zoom/accounts.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultZoomAccount, zoomAccount, zoomAccountOptions } from './accounts.ts';

const one = { ZOOM_1_ACCOUNT_ID: 'a1', ZOOM_1_CLIENT_ID: 'c1', ZOOM_1_CLIENT_SECRET: 's1', ZOOM_1_HOST: 'one@example.com' };
const two = { ZOOM_2_ACCOUNT_ID: 'a2', ZOOM_2_CLIENT_ID: 'c2', ZOOM_2_CLIENT_SECRET: 's2', ZOOM_2_HOST: 'host@example.com', ZOOM_2_LABEL: '駅前' };

test('接続情報がそろったアカウントだけ選択肢に出す', () => {
  assert.deepEqual(zoomAccountOptions({}), []);
  assert.deepEqual(zoomAccountOptions(one), [{ id: '1', label: '公式1' }]);
  assert.deepEqual(zoomAccountOptions({ ...one, ...two }), [{ id: '1', label: '公式1' }, { id: '2', label: '駅前' }]);
  assert.equal(zoomAccount('1', { ZOOM_1_ACCOUNT_ID: 'a1', ZOOM_1_CLIENT_ID: 'c1' }), null);
});

test('ホストのメールアドレスが無いアカウントは使えない', () => {
  assert.equal(zoomAccount('1', { ...one, ZOOM_1_HOST: '' }), null);
  assert.equal(zoomAccount('1', one)?.host, 'one@example.com');
  assert.equal(zoomAccount('2', two)?.host, 'host@example.com');
});

test('中等部は公式2、その他の部門は公式1が既定', () => {
  const env = { ...one, ...two };
  assert.equal(defaultZoomAccount('小中等部', env), '2');
  assert.equal(defaultZoomAccount('RED個別', env), '1');
  assert.equal(defaultZoomAccount('高等部', env), '1');
  assert.equal(defaultZoomAccount('総務・人事・支援・管理', env), '1');
});

test('既定のアカウントが未設定なら、設定済みのもう一方にする', () => {
  assert.equal(defaultZoomAccount('小中等部', one), '1');
  assert.equal(defaultZoomAccount('RED個別', two), '2');
  assert.equal(defaultZoomAccount('小中等部', {}), null);
});
