// 自動で下書きを作る会議の選び方（lib/zoom/due.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jstNow, meetingIsOver } from './due.ts';

test('日本時間に直す（UTC 16:00 は翌日の 01:00）', () => {
  assert.deepEqual(jstNow(Date.parse('2026-11-20T16:00:00Z')), { today: '2026-11-21', time: '01:00' });
  assert.deepEqual(jstNow(Date.parse('2026-11-20T07:23:00Z')), { today: '2026-11-20', time: '16:23' });
});

test('きのうの会議は対象。3日前まではやり直すが、それより前は見ない', () => {
  const now = { today: '2026-11-21', time: '01:00' };
  assert.equal(meetingIsOver({ day: '2026-11-20', start: '14:00', durationMin: 50 }, now), true);
  assert.equal(meetingIsOver({ day: '2026-11-18', start: '14:00', durationMin: 50 }, now), true);
  assert.equal(meetingIsOver({ day: '2026-11-17', start: '14:00', durationMin: 50 }, now), false);
});

test('きょうの会議は、終わって20分たってから。これからの会議は対象外', () => {
  const s = { day: '2026-11-20', start: '14:00', durationMin: 60 };
  assert.equal(meetingIsOver(s, { today: '2026-11-20', time: '15:10' }), false);
  assert.equal(meetingIsOver(s, { today: '2026-11-20', time: '15:20' }), true);
  assert.equal(meetingIsOver({ day: '2026-11-24', start: '13:00', durationMin: 60 }, { today: '2026-11-21', time: '01:00' }), false);
});

test('開催日時が読めない会議は対象外', () => {
  assert.equal(meetingIsOver(null, { today: '2026-11-21', time: '01:00' }), false);
});
