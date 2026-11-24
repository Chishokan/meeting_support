// ［ホストとして開始］できる人の判定（lib/zoom/access.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canHostMeeting, canSetHost, canUseRecording, hostOf } from './access.ts';

const ADMIN = '総務・人事・支援・管理';

test('ホスト担当は、決めてあればその人。無ければ事前共有した本人', () => {
  assert.equal(hostOf({ user: '瀬戸山理恵' }, '福元崇恭'), '福元崇恭');
  assert.equal(hostOf({ user: '瀬戸山理恵' }, ''), '瀬戸山理恵');
  assert.equal(hostOf({ user: '瀬戸山理恵' }, undefined), '瀬戸山理恵');
});

test('ホストとして開始できるのは、ホスト担当の本人だけ', () => {
  assert.equal(canHostMeeting({ uid: 1, name: '福元崇恭' }, '福元崇恭'), true);
  assert.equal(canHostMeeting({ uid: 2, name: '安藤純平' }, '福元崇恭'), false);
  assert.equal(canHostMeeting({ uid: 1, name: '福元崇恭' }, ''), false);
  assert.equal(canHostMeeting(null, '福元崇恭'), false);
});

test('共通ログインで入っていない人（uid が無い）は、ホスト担当でも開始できない', () => {
  assert.equal(canHostMeeting({ name: '福元崇恭' }, '福元崇恭'), false);
});

test('ホスト担当を替えられるのは、その部門・事前共有した本人・管理部門', () => {
  const row = { campus: 'RED個別', user: '瀬戸山理恵' };
  assert.equal(canSetHost({ name: '福元崇恭', campus: 'RED個別' }, row, ADMIN), true);
  assert.equal(canSetHost({ name: '瀬戸山理恵', campus: '小中等部' }, row, ADMIN), true);
  assert.equal(canSetHost({ name: '安藤純平', campus: ADMIN }, row, ADMIN), true);
  assert.equal(canSetHost({ name: '太田暁', campus: '小中等部' }, row, ADMIN), false);
});

test('録画からの議事録は、その部門・事前共有した本人・管理部門だけが扱える', () => {
  const row = { campus: '小中等部', user: '直江' };
  assert.equal(canUseRecording({ name: '太田', campus: '小中等部' }, row, ADMIN), true);
  assert.equal(canUseRecording({ name: '直江', campus: 'RED個別' }, row, ADMIN), true);
  assert.equal(canUseRecording({ name: '安藤', campus: ADMIN }, row, ADMIN), true);
  assert.equal(canUseRecording({ name: '福元', campus: 'RED個別' }, row, ADMIN), false);
  assert.equal(canUseRecording(null, row, ADMIN), false);
});
