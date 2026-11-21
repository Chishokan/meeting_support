// 出席者の扱い（lib/attendees.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmSummary, isAttendee, joinAttendees, splitAttendees, toggleAttendee } from './attendees.ts';

test('区切りごとに分け、空と重複を落とす', () => {
  assert.deepEqual(splitAttendees('安東瑞輝、太田暁, 池田貴光／安東瑞輝\n'), ['安東瑞輝', '太田暁', '池田貴光']);
  assert.deepEqual(splitAttendees(''), []);
  assert.deepEqual(splitAttendees(null), []);
  assert.equal(joinAttendees(['太田暁', '', '太田暁', '安東瑞輝']), '太田暁、安東瑞輝');
});

test('チェックを入れる・外す。ほかの並びは変えない', () => {
  assert.equal(toggleAttendee('安東瑞輝、太田暁', '池田貴光', true), '安東瑞輝、太田暁、池田貴光');
  assert.equal(toggleAttendee('安東瑞輝、太田暁', '安東瑞輝', false), '太田暁');
  assert.equal(toggleAttendee('安東瑞輝', '安東瑞輝', true), '安東瑞輝');
  assert.equal(toggleAttendee('', '太田暁', true), '太田暁');
});

test('出席者かどうか：フルネームと、手入力の名字のどちらでも分かる', () => {
  assert.equal(isAttendee('太田暁', '安東瑞輝、太田暁'), true);
  assert.equal(isAttendee('太田暁', '安東、太田'), true);
  assert.equal(isAttendee('直江弘明', '直江'), true);
  assert.equal(isAttendee('福元崇恭', '安東、太田'), false);
  assert.equal(isAttendee('太田暁', '太'), false);
  assert.equal(isAttendee('太田暁', ''), false);
  assert.equal(isAttendee('', '太田暁'), false);
});

test('出席者ごとの確認の状況', () => {
  const s = confirmSummary('安東瑞輝、太田、池田貴光', ['太田暁', '池田貴光', '福元崇恭']);
  assert.equal(s.total, 3);
  assert.equal(s.done, 2);
  assert.deepEqual(s.items, [
    { name: '安東瑞輝', ok: false },
    { name: '太田', ok: true },
    { name: '池田貴光', ok: true },
  ]);
  assert.deepEqual(confirmSummary('', ['太田暁']), { total: 0, done: 0, items: [] });
  assert.equal(confirmSummary('太田暁', null).done, 0);
});
