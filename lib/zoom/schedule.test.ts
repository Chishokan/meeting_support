// 開催日時の読み取り（lib/zoom/schedule.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSchedule, parseSchedule, splitSchedule } from './schedule.ts';

const TODAY = '2026-11-19';

test('日付・開始・終了を読む', () => {
  assert.deepEqual(parseSchedule('2026/11/25 13:00〜14:30', TODAY), {
    day: '2026-11-25', start: '13:00', end: '14:30', startTime: '2026-11-25T13:00:00', durationMin: 90,
  });
});

test('終了が無ければ60分とする', () => {
  const s = parseSchedule('2026年11月25日 18時〜', TODAY);
  assert.equal(s?.startTime, '2026-11-25T18:00:00');
  assert.equal(s?.end, '');
  assert.equal(s?.durationMin, 60);
});

test('年を省いた日付は今年とみなし、半年以上前なら翌年にする', () => {
  assert.equal(parseSchedule('12/1 9:30-10:30', TODAY)?.day, '2026-12-01');
  assert.equal(parseSchedule('1/12 13:00', TODAY)?.day, '2027-01-12');
});

test('全角のコロンや「時・分」でも読める', () => {
  assert.equal(parseSchedule('2026/11/25 13：00〜14：00', TODAY)?.durationMin, 60);
  assert.equal(parseSchedule('2026/11/25 13時30分〜15時', TODAY)?.start, '13:30');
  assert.equal(parseSchedule('2026/11/25 13時30分〜15時', TODAY)?.durationMin, 90);
});

test('日付の数字を時刻と取り違えない', () => {
  assert.equal(parseSchedule('2026-11-25 13:00', TODAY)?.start, '13:00');
});

test('終了が開始より前なら、終了は無かったものとする', () => {
  const s = parseSchedule('2026/11/25 13:00〜12:00', TODAY);
  assert.equal(s?.end, '');
  assert.equal(s?.durationMin, 60);
});

test('長さは15分〜8時間に丸める', () => {
  assert.equal(parseSchedule('2026/11/25 13:00〜13:05', TODAY)?.durationMin, 15);
  assert.equal(parseSchedule('2026/11/25 8:00〜23:00', TODAY)?.durationMin, 480);
});

test('日付か開始時刻が読めなければ null', () => {
  assert.equal(parseSchedule('日時未定', TODAY), null);
  assert.equal(parseSchedule('2026/11/25', TODAY), null);
  assert.equal(parseSchedule('13:00〜', TODAY), null);
  assert.equal(parseSchedule('2026/2/30 13:00', TODAY), null);
});

test('画面の入力から文字列を作り、また戻せる', () => {
  const text = formatSchedule('2026-11-25', '13:00', '14:00');
  assert.equal(text, '2026/11/25 13:00〜14:00');
  assert.deepEqual(splitSchedule(text, TODAY), { day: '2026-11-25', start: '13:00', end: '14:00' });
  assert.equal(formatSchedule('2026-11-25', '13:00', ''), '2026/11/25 13:00〜');
  assert.equal(formatSchedule('2026-11-25', '', ''), '2026/11/25');
  assert.equal(formatSchedule('', '13:00', '14:00'), '');
});

test('時刻が読めない文字列は、日付だけ戻す', () => {
  assert.deepEqual(splitSchedule('2026/11/25 午後', TODAY), { day: '2026-11-25', start: '', end: '' });
  assert.deepEqual(splitSchedule('', TODAY), { day: '', start: '', end: '' });
});
