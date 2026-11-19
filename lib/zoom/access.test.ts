// ［ホストとして開始］できる人の判定（lib/zoom/access.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canHostMeeting } from './access.ts';

const ADMIN = '総務・人事・支援・管理';

test('管理部門は全部門の会議を開始できる', () => {
  assert.equal(canHostMeeting({ uid: 1, campus: ADMIN }, '小中等部', ADMIN), true);
  assert.equal(canHostMeeting({ uid: 1, campus: ADMIN }, 'RED個別', ADMIN), true);
});

test('部門長権限者は自分の部門の会議だけ開始できる', () => {
  assert.equal(canHostMeeting({ uid: 2, campus: '小中等部', deptAdmin: true }, '小中等部', ADMIN), true);
  assert.equal(canHostMeeting({ uid: 2, campus: '小中等部', deptAdmin: true }, 'RED個別', ADMIN), false);
});

test('部門長権限が無い人は開始できない', () => {
  assert.equal(canHostMeeting({ uid: 3, campus: '小中等部' }, '小中等部', ADMIN), false);
  assert.equal(canHostMeeting({ uid: 3, campus: '小中等部', deptAdmin: false }, '小中等部', ADMIN), false);
});

test('従来のログイン（uid が無い）では、管理部門でも開始できない', () => {
  assert.equal(canHostMeeting({ campus: ADMIN }, '小中等部', ADMIN), false);
  assert.equal(canHostMeeting({ campus: '小中等部', deptAdmin: true }, '小中等部', ADMIN), false);
  assert.equal(canHostMeeting(null, '小中等部', ADMIN), false);
});
