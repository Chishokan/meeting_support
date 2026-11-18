// 会議の記録を読む道具・議題の追加の案（meetingRecords.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addedAgendaLines,
  agendaLine,
  checkAgendaInput,
  checkRecordsInput,
  deptMatch,
  formatMeetingRecords,
  meetingDayOf,
  mergeAddedAgenda,
  minutesSection,
  parseTodos,
  pickAgendaTarget,
  type PreshareRec,
  type RecordsData,
} from './meetingRecords.ts';

// 「部門会議議事録」の議事録の形（2026-09-14 の中等部会議を短くしたもの）
const MINUTES = `■ 会議名 / 日時 / 場所
中等部会議 / 2026/11/16 / オンライン

■ 決定事項
1. 件名：門配の分担

■ 継続審議・保留
- 門配業務の人手不足について、協力体制は未決定（要調整）。

■ ToDo（アクション項目）
- [ ] 紹介打診済み生徒への聞き取り ／ 担当：安東 ／ 期限：今週中
- [〇] 日野・相浦エリアの門配を再度実施 ／ 担当：日野担当 ／ 期限：11/20
- [✕] 出欠名簿の分別作業 ／ 担当：太田 ／ 期限：【要確認】
- [〇 労働組合チラシの内容チェック ／ 担当：冨松・安藤 ／ 期限：10/20（火）

■ 他部門への依頼・共有事項
高等部へ：門配資材のセッティングの協力

■ 次回会議
11/24（月）18:00 オンライン`;

test('minutesSection・parseTodos：議事録の ToDo を1件ずつ（済・未完了・] の抜けも）', () => {
  const todos = parseTodos(minutesSection(MINUTES, 'ToDo'));
  assert.deepEqual(todos, [
    { text: '紹介打診済み生徒への聞き取り', owner: '安東', due: '今週中', status: '未' },
    { text: '日野・相浦エリアの門配を再度実施', owner: '日野担当', due: '11/20', status: '済' },
    { text: '出欠名簿の分別作業', owner: '太田', due: '【要確認】', status: '未完了' },
    { text: '労働組合チラシの内容チェック', owner: '冨松・安藤', due: '10/20（火）', status: '済' },
  ]);
  assert.equal(minutesSection(MINUTES, '次回会議'), '11/24（月）18:00 オンライン');
  assert.equal(minutesSection(MINUTES, '無い見出し'), '');
});

test('deptMatch・meetingDayOf', () => {
  assert.ok(deptMatch('小中等部', '中等部'));
  assert.ok(deptMatch('RED個別', 'RED'));
  assert.ok(deptMatch('総務・人事・支援・管理', '総務'));
  assert.ok(deptMatch('小中等部', ''));
  assert.ok(!deptMatch('高等部', 'RED個別'));
  assert.equal(meetingDayOf('2026年11月11日（水）11：00', ''), '2026-11-11');
  assert.equal(meetingDayOf('10/20(火)　毎週火曜日15時～', '2026/10/20 14:29'), '2026-10-20');
  assert.equal(meetingDayOf('1/8', '2026/12/20 10:00'), '2027-01-08');
});

const data: RecordsData = {
  minutes: [{ id: 'm1', ts: '2026-11-16T09:00:00Z', campus: '小中等部', user: '太田暁', title: '中等部会議', date: '2026/11/16', attendees: '', agenda: '', minutes: MINUTES }],
  decisions: [
    { ts: '2026-11-16T09:00:00Z', campus: '小中等部', meeting: '中等部会議', date: '2026/11/16', title: '門配の分担', detail: '月曜は小中等部、木曜はネクスタ・RED', owner: '太田', due: '11/30', related: 'RED個別' },
    { ts: '2026-09-01T09:00:00Z', campus: '小中等部', meeting: '中等部会議', date: '2026/9/1', title: '古い決定', detail: '昔の話', owner: '', due: '', related: '' },
    { ts: '2026-11-17T09:00:00Z', campus: 'RED個別', meeting: '週礼', date: '2026/11/17', title: 'ティッシュBOX設置', detail: '造船所前の食堂に設置', owner: '冨田', due: '', related: '自部門のみ' },
  ],
  preshare: [
    { id: 'p1', ts: '2026/11/18 10:00', campus: '小中等部', user: '太田暁', title: '中等部会議', date: '2026/11/24 18:00', place: 'オンライン', agenda: '・行動計画\n・冬期講習の外部募集', minutesId: '' },
    { id: 'p0', ts: '2026/11/10 10:00', campus: '小中等部', user: '太田暁', title: '中等部会議', date: '2026/11/16', place: '', agenda: '・前回', minutesId: 'm1' },
    { id: 'p2', ts: '2026/11/18 10:00', campus: 'RED個別', user: '冨田翔太', title: 'RED西海大島小学生募集', date: '2026年11月25日（水）11：00', place: '', agenda: '・イベント', minutesId: '' },
  ],
  share: [{ ts: '2026-11-16T07:58:47Z', campus: '英検', user: '中山信哉', kind: '協議', title: '代役体制について', background: '', point: '代役候補で進めてよいか', opinion: '賛成' }],
};

test('formatMeetingRecords：部門・期間で絞り、これからの会議・決定事項・ToDo・議事録・全体会議の事前共有事項を書く', () => {
  const all = formatMeetingRecords(data, checkRecordsInput({ dept: '中等部' }), '2026-11-18');
  assert.match(all, /■ これからの部門会議（事前共有）\n- 小中等部｜中等部会議｜開催 2026\/11\/24 18:00｜事前共有ID p1/);
  assert.doesNotMatch(all, /事前共有ID p0/); // 議事録を保存した会議は出さない
  assert.doesNotMatch(all, /RED西海大島/);
  assert.match(all, /門配の分担：月曜は小中等部、木曜はネクスタ・RED（担当：太田／期限：11\/30／関係：RED個別）/);
  assert.doesNotMatch(all, /古い決定/); // 45日より前
  assert.match(all, /［ ］紹介打診済み生徒への聞き取り（担当：安東／期限：今週中）/);
  assert.match(all, /［済］日野・相浦エリアの門配/);
  assert.match(all, /［継続審議］\n {6}- 門配業務の人手不足/);
  assert.match(all, /［次回会議］\n {6}11\/24（月）18:00/);
  assert.match(all, /生徒・保護者の名前はイニシャルにする/);

  const mine = formatMeetingRecords(data, checkRecordsInput({ what: 'todos', person: '太田' }), '2026-11-18');
  assert.match(mine, /出欠名簿の分別作業/);
  assert.doesNotMatch(mine, /紹介打診済み/);
  assert.doesNotMatch(mine, /■ 決定事項/);

  const share = formatMeetingRecords(data, checkRecordsInput({ what: 'share' }), '2026-11-18');
  assert.match(share, /英検｜2026-11-16｜【協議】代役体制について／論点：代役候補で進めてよいか／意見：賛成（中山信哉）/);

  const cut = formatMeetingRecords(data, checkRecordsInput({}), '2026-11-18', 300);
  assert.match(cut, /長いので途中まで/);
});

test('checkRecordsInput：既定と上限', () => {
  assert.deepEqual(checkRecordsInput({}), { dept: '', what: 'all', person: '', query: '', days: 45 });
  assert.equal(checkRecordsInput({ days: 999 }).days, 180);
  assert.equal(checkRecordsInput({ what: 'x' }).what, 'all');
});

test('議題の追加：入力・足す会議の選び方・足す行・上書きで消さない', () => {
  assert.equal(checkAgendaInput({ item: 'x' }).ok, false);
  const c = checkAgendaInput({ dept: ' 小中等部 ', item: '【協議】冬期講習の外部生募集の分担', detail: '各校の担当を決めたい' });
  assert.ok(c.ok && c.value.dept === '小中等部' && c.value.meetingId === '');
  const rows = data.preshare as PreshareRec[];
  assert.equal(pickAgendaTarget(rows, '中等部', '', '2026-11-18')?.id, 'p1');
  assert.equal(pickAgendaTarget(rows, 'RED', '', '2026-11-18')?.id, 'p2');
  assert.equal(pickAgendaTarget(rows, '高等部', '', '2026-11-18'), null);
  assert.equal(pickAgendaTarget(rows, '中等部', 'p2', '2026-11-18')?.id, 'p2'); // ID を指定したらそれ
  assert.equal(pickAgendaTarget(rows, '中等部', '', '2026-11-25'), null); // 過ぎた会議には足さない
  const line = agendaLine('冬期講習の分担', '各校の担当', '安藤純平', '11/18');
  assert.equal(line, '・【追加】冬期講習の分担（各校の担当）〔安藤純平 11/18〕');
  const server = `・行動計画\n${line}`;
  assert.deepEqual(addedAgendaLines(server), [line]);
  assert.equal(mergeAddedAgenda('・行動計画\n・冬期講習の外部募集', server), `・行動計画\n・冬期講習の外部募集\n${line}`);
  assert.equal(mergeAddedAgenda(`・行動計画\n${line}`, server), `・行動計画\n${line}`);
});
