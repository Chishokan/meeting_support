// 部門会議の事前共有（deptMinutesPreshare.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agendaPreview,
  buildNextAgenda,
  meetingDay,
  nextMeetingDate,
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

test('nextMeetingDate: 「■ 次回会議」から日時を読む。要確認・日付なしは空', () => {
  assert.equal(nextMeetingDate('・日時：10/21（火）18:00〜\n・持ち越す議題：料金改定'), '10/21（火）18:00〜');
  assert.equal(nextMeetingDate('次回日時：2026/11/4 18:00'), '2026/11/4 18:00');
  assert.equal(nextMeetingDate('・日時：【要確認】 10/21 か 10/28'), '');
  assert.equal(nextMeetingDate('・日時：【要確認】\n・準備事項：見積もり'), '');
});

test('buildNextAgenda: 未実施の議題・決定事項・継続審議・ToDo・持ち越しを引き継ぐ', () => {
  const agenda = buildNextAgenda({
    title: '小中等部 定例会議',
    date: '2026/10/14 18:00〜19:00',
    agenda: '1. 9月度 実績報告（予定どおり）\n2. 中間テスト対策について（予定どおり）\n3. 冬期講習の募集（未実施）',
    decisions: [
      { title: '冬期講習の募集開始', owner: '池田', due: '10/31' },
      { title: 'バスの時刻変更', owner: '', due: '' },
    ],
    pending: '・料金改定：情報不足のため次回へ。経理に試算を依頼\n該当なし',
    todos: '- [ ] 試算の依頼 ／ 担当：安東 ／ 期限：\n- [x] チラシの発注 ／ 担当：山中 ／ 期限：10/10\n- [ ] （内容） ／ 担当： ／ 期限：',
    next: '・日時：10/21 18:00〜\n・持ち越す議題：料金改定\n・準備事項：【要確認】',
  });
  assert.equal(
    agenda,
    [
      '【前回（10/14 18:00〜19:00 小中等部 定例会議）からの引き継ぎ】',
      '1. 前回話し合えなかった議題',
      '   ・冬期講習の募集',
      '2. 前回の決定事項の進捗確認',
      '   ・冬期講習の募集開始（担当：池田／期限：10/31）',
      '   ・バスの時刻変更',
      '3. 継続審議・保留',
      '   ・料金改定：情報不足のため次回へ。経理に試算を依頼',
      '4. ToDo の進捗確認',
      '   ・試算の依頼（担当：安東）',
      '5. 前回決めた持ち越し・準備事項',
      '   ・持ち越す議題：料金改定',
      '',
      '【今回の議題】',
      '',
    ].join('\n'),
  );
});

test('buildNextAgenda: 引き継ぐものが無ければそう書く', () => {
  const agenda = buildNextAgenda({
    title: '定例', date: '', agenda: '1. 報告（予定どおり）', decisions: [], pending: '該当なし', todos: '- [ ] （内容） ／ 担当： ／ 期限：', next: '【要確認】',
  });
  assert.equal(agenda, '【前回（定例）からの引き継ぎ】\n引き継ぐ項目はありませんでした。\n\n【今回の議題】\n');
});

test('agendaPreview: 次回の下書きは今回の議題を先に出し、引き継ぎは件数の1行にまとめる', () => {
  const agenda = buildNextAgenda({
    title: '定例', date: '2026/10/14', agenda: '1. 冬期講習（未実施）',
    decisions: [{ title: '担当割り振り', owner: '池田', due: '' }], pending: '', todos: '', next: '',
  }) + '・冬期講習の時間割\n・教室の割り当て\n・年末の予定';
  assert.deepEqual(agendaPreview(agenda), ['冬期講習の時間割', '教室の割り当て', '前回からの引き継ぎ 2件']);
  // 今回の議題をまだ書いていないとき
  assert.deepEqual(agendaPreview(agenda.split('【今回の議題】')[0] + '【今回の議題】\n'), ['前回からの引き継ぎ 2件']);
});

test('agendaPreview: ふつうの議題・レジュメは先頭から（記号・番号を落とす）', () => {
  assert.deepEqual(
    agendaPreview('1. 9月度 実績報告\n   (1) 生徒数・前年比\n2. 中間テスト対策\n3. 冬期講習'),
    ['9月度 実績報告', '(1) 生徒数・前年比', '中間テスト対策'],
  );
});

test('buildNextAgenda: ToDo は終わるまで残す（担当・期限・前回の進捗つき。済みと空欄は落とす）', () => {
  const agenda = buildNextAgenda({
    title: '定例', date: '', agenda: '', decisions: [], pending: '', next: '',
    todos: [
      // 前回から引き継いで、まだ途中のもの
      '- [ ] 経理に料金改定の試算を依頼 ／ 担当：安東 ／ 期限：10/17 ／ 進捗：依頼済み、回答待ち',
      // 前回から引き継いで、会議で話題に出なかったもの
      '- [ ] 保護者会の日程調整 ／ 担当：山中 ／ 期限： ／ 進捗：会議で確認なし',
      // 項目が短く担当が空（以前はここで落ちていた）
      '- [ ] 資料共有 ／ 担当：',
      // 済み（[x]）と、[ ] のまま「進捗：完了」と書かれたもの
      '- [x] チラシの発注 ／ 担当：池田 ／ 進捗：完了',
      '- [ ] 教室の掲示 ／ 担当：池田 ／ 進捗：完了（10/15 掲示済み）',
      '- [ ] （内容） ／ 担当： ／ 期限：',
    ].join('\n'),
  });
  assert.equal(
    agenda,
    [
      '【前回（定例）からの引き継ぎ】',
      '1. ToDo の進捗確認',
      '   ・経理に料金改定の試算を依頼（担当：安東／期限：10/17／進捗：依頼済み、回答待ち）',
      '   ・保護者会の日程調整（担当：山中／進捗：会議で確認なし）',
      '   ・資料共有',
      '',
      '【今回の議題】',
      '',
    ].join('\n'),
  );
});
