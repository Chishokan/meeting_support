// 部門会議の事前共有（deptMinutesPreshare.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  meetingDay,
  metaKey,
  missingForPreshare,
  shortDate,
  upcomingPreshares,
  whenLabel,
  type PreshareRow,
} from './deptMinutesPreshare.ts';

let seq = 0;
function row(p: Partial<PreshareRow>): PreshareRow {
  return {
    id: String(++seq), ts: '2026/10/14 09:00', campus: '小中等部', user: '直江',
    title: '定例会議', date: '', place: '', attendees: '', agenda: '1. 9月度 実績報告',
    editedAt: '', editedBy: '', minutesId: '', ...p,
  };
}

test('meetingDay: 年のある書き方はそのまま読む', () => {
  assert.equal(meetingDay('2026/9/10 18:00〜19:00', ''), '2026-09-10');
  assert.equal(meetingDay('2026-10-01', ''), '2026-10-01');
  assert.equal(meetingDay('2026年10月14日（水）18時', ''), '2026-10-14');
});

test('meetingDay: 年を省いたら事前共有した日の年。半年以上前になるなら翌年', () => {
  assert.equal(meetingDay('10/20 18:00', '2026/10/14 09:00'), '2026-10-20');
  assert.equal(meetingDay('10月20日', '2026-10-14T09:00:00'), '2026-10-20');
  // 年末に翌年1月の会議を共有した
  assert.equal(meetingDay('1/8 10:00', '2026/12/25 15:00'), '2027-01-08');
  // 共有が会議の少しあと（日付を後から入れ直した）なら同じ年のまま
  assert.equal(meetingDay('10/10', '2026/10/14 09:00'), '2026-10-10');
});

test('meetingDay: 読めない・あり得ない日付は空', () => {
  assert.equal(meetingDay('来週火曜 18:00', '2026/10/14 09:00'), '');
  assert.equal(meetingDay('2026/2/30', ''), '');
  assert.equal(meetingDay('10/20', ''), '');
});

test('missingForPreshare: 会議名・開催日時・議題が無ければ名前を返す', () => {
  const meta = { title: ' ', date: '2026/10/14', place: '', attendees: '', agenda: '' };
  assert.deepEqual(missingForPreshare(meta), ['会議名', '予定していた議題・レジュメ']);
  assert.deepEqual(missingForPreshare({ ...meta, title: '定例', agenda: '議題' }), []);
});

test('metaKey: 前後の空白だけの違いは同じとみなす', () => {
  const a = { title: '定例', date: '2026/10/14', place: '', attendees: '', agenda: '議題' };
  assert.equal(metaKey(a), metaKey({ ...a, title: ' 定例 ', agenda: '議題\n' }));
  assert.notEqual(metaKey(a), metaKey({ ...a, place: '本部' }));
});

test('upcomingPreshares: 議事録を保存した会議と、日の過ぎた会議は外す', () => {
  const today = '2026-10-14';
  const views = upcomingPreshares(
    [
      row({ title: '保存済み', date: '2026/10/14', minutesId: 'm1' }),
      row({ title: '3日前', date: '2026/10/11' }),
      row({ title: '4日前', date: '2026/10/10' }),
      row({ title: '今日', date: '2026/10/14' }),
    ],
    today,
  );
  assert.deepEqual(views.map((v) => v.row.title), ['今日', '3日前']);
});

test('upcomingPreshares: 今日 → 明日以降（近い順）→ 過ぎたもの（新しい順）。同じ日は開始時刻の順', () => {
  const views = upcomingPreshares(
    [
      row({ title: '昨日', date: '2026/10/13' }),
      row({ title: '来週', date: '2026/10/21' }),
      row({ title: '今日18時', date: '2026/10/14 18:00〜19:00' }),
      row({ title: '一昨日', date: '2026/10/12' }),
      row({ title: '明日', date: '10/15' }),
      row({ title: '今日10時', date: '2026/10/14 10:00〜' }),
    ],
    '2026-10-14',
  );
  assert.deepEqual(views.map((v) => v.row.title), ['今日10時', '今日18時', '明日', '来週', '昨日', '一昨日']);
  assert.deepEqual(views.map((v) => whenLabel(v)), ['今日', '今日', '明日', '7日後', '昨日', '2日前']);
});

test('upcomingPreshares: 開催日を読めないときは事前共有した日で並べ、「今日」などの印は付けない', () => {
  const [v] = upcomingPreshares([row({ date: '来週火曜', ts: '2026/10/14 09:00' })], '2026-10-14');
  assert.equal(v.day, '2026-10-14');
  assert.equal(v.dated, false);
  assert.equal(whenLabel(v), '');
});

test('shortDate: 先頭の年だけを落とす', () => {
  assert.equal(shortDate('2026/9/10 18:00〜19:00'), '9/10 18:00〜19:00');
  assert.equal(shortDate('2026年10月14日'), '10月14日');
  assert.equal(shortDate('10/14 18:00'), '10/14 18:00');
});
