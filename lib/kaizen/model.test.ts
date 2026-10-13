// つきいち改善の受付状態・投票の確かめ・集計（model.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  buildView,
  canEdit,
  checkVote,
  driveFileId,
  legacyItems,
  legacyTs,
  legacyVotes,
  missingSubmitters,
  normalizeInput,
  normalizeMonth,
  parseCsv,
  photoThumbUrl,
  submittableMonths,
  tallyMonth,
  validateInput,
  voteDeadlineLabel,
  votingState,
  type Kaizen,
  type KaizenClose,
  type KaizenVote,
} from './model.ts';

let seq = 0;
function k(p: Partial<Kaizen>): Kaizen {
  seq++;
  return {
    id: `k${seq}`, month: '2026-09', submittedAt: `2026/09/${String(10 + seq).padStart(2, '0')} 10:00`,
    members: ['安東瑞輝'], campus: '日野', title: `改善${seq}`, before: '前', after: '後',
    beforePhotos: [], afterPhotos: [], enteredBy: '安東瑞輝', enteredDept: '小中等部',
    updatedAt: '', updatedBy: '', source: '', ...p,
  };
}
function v(voter: string, ids: string[], p: Partial<KaizenVote> = {}): KaizenVote {
  return { month: '2026-09', voter, dept: '', ids, votedAt: '2026/10/08 10:00', ...p };
}

const TODAY = '2026-10-13';

test('月の計算：年をまたぐ・表記ゆれをそろえる・締め切り日', () => {
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(normalizeMonth('2026/9/30 12:00'), '2026-09');
  assert.equal(normalizeMonth('2026年10月'), '2026-10');
  assert.equal(normalizeMonth('2026-13'), '');
  assert.equal(voteDeadlineLabel('2026-09'), '10月31日');
  assert.equal(voteDeadlineLabel('2027-01'), '2月28日');
});

test('受付状態：今月は提出、先月は投票（管理部門が締め切るまで）、それより前は締め切り', () => {
  const none: KaizenClose[] = [];
  assert.equal(votingState('2026-10', TODAY, none), 'collecting');
  assert.equal(votingState('2026-09', TODAY, none), 'open');
  assert.equal(votingState('2026-08', TODAY, none), 'closed');
  const closed = [{ month: '2026-09', closed: true, by: '冨松太一', at: '' }];
  assert.equal(votingState('2026-09', TODAY, closed), 'closed');
  const reopened = [{ month: '2026-09', closed: false, by: '冨松太一', at: '' }];
  assert.equal(votingState('2026-09', TODAY, reopened), 'open');
  // 出し忘れは投票中の先月にも出せる。締め切ったら今月だけ
  assert.deepEqual(submittableMonths(TODAY, none), ['2026-10', '2026-09']);
  assert.deepEqual(submittableMonths(TODAY, closed), ['2026-10']);
});

test('直せる人：本人は締め切りまで、管理部門はいつでも、他人は不可', () => {
  const item = k({ members: ['山田佑咲', '瀬戸山理恵'], enteredBy: '山田佑咲' });
  const closed = [{ month: '2026-09', closed: true, by: 'x', at: '' }];
  assert.equal(canEdit(item, '瀬戸山理恵', false, TODAY, []), true); // 一緒に取り組んだ人も直せる
  assert.equal(canEdit(item, '亀谷新', false, TODAY, []), false);
  assert.equal(canEdit(item, '山田佑咲', false, TODAY, closed), false);
  assert.equal(canEdit(item, '冨松太一', true, TODAY, closed), true);
});

test('入力：名前の重複と空白を落とし、足りない項目を知らせる', () => {
  const input = normalizeInput({ month: '2026-10', members: [' 亀谷新 ', '亀谷新', ''], campus: '日野', title: 'a\nb', before: ' x ', after: 'y' });
  assert.deepEqual(input.members, ['亀谷新']);
  assert.equal(input.title, 'a b');
  assert.equal(input.before, 'x');
  assert.equal(validateInput(input, ['2026-10']), null);
  assert.match(validateInput({ ...input, campus: '東京' }, ['2026-10'])!, /校舎/);
  assert.match(validateInput({ ...input, after: '' }, ['2026-10'])!, /After/);
  assert.match(validateInput(input, ['2026-11'])!, /締め切/);
});

test('投票：3票まで・自分の改善は不可・ほかの月の改善は不可・締め切り後は不可・重複は1票', () => {
  const a = k({ members: ['冨田翔太'] });
  const b = k({ members: ['亀谷新'] });
  const c = k({ members: ['池田貴光'] });
  const d = k({ members: ['冨松太一', '安藤純平'] });
  const old = k({ month: '2026-08', members: ['越智秀也'] });
  const items = [a, b, c, d, old];
  const base = { month: '2026-09', voter: '安藤純平', items, today: TODAY, closes: [] as KaizenClose[] };

  const ok = checkVote({ ...base, ids: [a.id, b.id, a.id] });
  assert.deepEqual(ok, { ok: true, ids: [a.id, b.id] });
  assert.equal(checkVote({ ...base, ids: [] }).ok, true); // 取り消し

  const many = checkVote({ ...base, ids: [a.id, b.id, c.id, k({}).id] });
  assert.equal(many.ok ? '' : many.reason, 'too_many');
  const own = checkVote({ ...base, ids: [d.id] });
  assert.equal(own.ok ? '' : own.reason, 'own');
  const other = checkVote({ ...base, ids: [old.id] });
  assert.equal(other.ok ? '' : other.reason, 'bad_choice');
  const late = checkVote({ ...base, ids: [a.id], closes: [{ month: '2026-09', closed: true, by: '', at: '' }] });
  assert.equal(late.ok ? '' : late.reason, 'closed');
  const wrongMonth = checkVote({ ...base, month: '2026-08', ids: [old.id] });
  assert.equal(wrongMonth.ok ? '' : wrongMonth.reason, 'closed');
});

test('集計：得票順・同票は同じ順位・優秀賞は同票なら全員・消えた改善とほかの月の票は数えない', () => {
  const a = k({ submittedAt: '2026/09/01 09:00' });
  const b = k({ submittedAt: '2026/09/02 09:00' });
  const c = k({ submittedAt: '2026/09/03 09:00' });
  const other = k({ month: '2026-08' });
  const votes = [
    v('A', [a.id, b.id, 'deleted']),
    v('B', [b.id, a.id]),
    v('C', [c.id]),
    v('D', [other.id]), // 8月の改善への票は 9月には数えない
    v('A', [a.id], { votedAt: '2026/10/01 09:00' }), // A の古い票（新しいほうが残る）
    v('E', ['deleted']), // 消された改善だけに入れた人は投票者に数えない
  ];
  const t = tallyMonth('2026-09', [a, b, c, other], votes);
  assert.deepEqual(t.rows.map((r) => [r.id, r.votes, r.rank]), [[a.id, 2, 1], [b.id, 2, 1], [c.id, 1, 3]]);
  assert.deepEqual(t.awards, [a.id, b.id]);
  assert.deepEqual(t.voters, [{ name: 'A', count: 2 }, { name: 'B', count: 2 }, { name: 'C', count: 1 }]);

  assert.deepEqual(tallyMonth('2026-09', [a], []).awards, []); // 0票なら優秀賞なし
});

test('未提出者：一緒に取り組んだ人も提出済みに数える', () => {
  const items = [k({ members: ['宮川祥真', '高松佑匡'] }), k({ month: '2026-08', members: ['大隈朋美'] })];
  assert.deepEqual(missingSubmitters('2026-09', items, ['宮川祥真', '高松佑匡', '大隈朋美']), ['大隈朋美']);
});

test('画面に渡す形：受付中の得票は管理部門だけ、締め切った月は全員に見せる', () => {
  const a = k({ members: ['冨田翔太'] });
  const aug = k({ month: '2026-08', members: ['越智秀也'] });
  const votes = [v('安藤純平', [a.id]), v('安藤純平', [aug.id], { month: '2026-08' })];
  const args = { items: [a, aug], votes, closes: [] as KaizenClose[], today: TODAY, roster: ['安藤純平', '冨田翔太'] };

  const staff = buildView({ ...args, user: '冨田翔太', isAdmin: false });
  const sep = staff.months.find((m) => m.month === '2026-09')!;
  assert.equal(sep.state, 'open');
  assert.equal(sep.tally, null);
  assert.equal(sep.voterCount, 1);
  assert.equal(sep.admin, null);
  assert.ok(staff.months.find((m) => m.month === '2026-08')!.tally); // 締め切った月は見える
  assert.deepEqual(staff.months.map((m) => m.month), ['2026-10', '2026-09', '2026-08']);
  assert.equal(staff.items.find((x) => x.id === a.id)!.mine, true);

  const admin = buildView({ ...args, user: '安藤純平', isAdmin: true });
  const sepA = admin.months.find((m) => m.month === '2026-09')!;
  assert.equal(sepA.tally!.rows[0].votes, 1);
  assert.deepEqual(sepA.myVote, [a.id]);
  assert.deepEqual(sepA.admin!.nonVoters, ['冨田翔太']);
  assert.deepEqual(sepA.admin!.missing, ['安藤純平']);
});

test('表示：旧スプレッドシートの Drive の写真の縮小 URL', () => {
  assert.equal(driveFileId('https://drive.google.com/open?id=19s0soPEiDfWYNNwgh11f-hNQydhI58kG'), '19s0soPEiDfWYNNwgh11f-hNQydhI58kG');
  assert.equal(driveFileId('https://drive.google.com/file/d/1EiqOIctIy4mjxsrRDnMWWjxL505I1rp6/view'), '1EiqOIctIy4mjxsrRDnMWWjxL505I1rp6');
  assert.equal(photoThumbUrl('https://drive.google.com/open?id=19s0soPEiDfWYNNwgh11f-hNQydhI58kG', 600), 'https://drive.google.com/thumbnail?id=19s0soPEiDfWYNNwgh11f-hNQydhI58kG&sz=w600');
  assert.equal(photoThumbUrl('data:image/jpeg;base64,AAAA'), 'data:image/jpeg;base64,AAAA');
});

// 旧スプレッドシートの「ダウンロード → CSV」と同じ形：行の区切りは CRLF、セルの中の改行は LF、名前の並びは「"…, …"」
const ANSWERS_CSV = [
  'タイムスタンプ,提出者氏名,所属校舎,改善タイトル,Before（改善前）の説明,After（改善後）の説明,Beforeの写真,Afterの写真',
  '2026/06/16 6:25:11,安東瑞輝,日野,おはよう勉強会リフレクション集,おは勉のリフレクションを見るのは職員のみ,保護者に…,https://drive.google.com/open?id=19s0soPEiDfWYNNwgh11f-hNQydhI58kG,https://drive.google.com/open?id=1EiqOIctIy4mjxsrRDnMWWjxL505I1rp6',
  '2026/06/17 12:08:35,瀬戸山理恵,京町,RED中3面談資料スライド作成＆ネクスタオンライン入試セミナーにも活用,福元先生が以前作成したもの,AIを活用しスライド作成。,,https://drive.google.com/open?id=1h8jFJXNJHLtWPwWUGcbehXNkZaVxCZqU',
  '2026/06/23 13:54:04,中山信哉,大野,ミニコマの活用,"・面談シートにて生徒一人一人を写真にとってLINEで共有していた。\n・指示内容を別の用紙にメモし、消し込んでいた。","・打合せ内容の入力\n・生徒情報の共有も「スプレッド」入力で行っている。",,',
  '2026/09/24 21:35:27,冨田翔太,大島,ガチャリニューアル！,ガチャがあるだけの空間,"生徒の""ほしい""ガチャ景品の写真を掲示。",,',
  '2026/09/30,"宮川祥真, 高松佑匡, 大隈朋美, 安田浩晃",大野,大野校　高1・2サマーポイントバトル,昨年の夏は…,今年の夏は…,"https://drive.google.com/open?id=1dnq5q-6Bhx1WI6TkIqJAcRoOydv9P7ar, https://drive.google.com/open?id=1IQomj8cf9pTN30ZaayzUam1XpXClMI2a",',
  '2026/09/30,"冨松太一, 安藤純平",駅前,智翔館 会議DX,部門議事録の改善。,議事録作成のフォーマットを統一,,https://drive.google.com/open?id=19cn5jqsaUtDaCYJD9tLizghwy_LB2GE_',
  ',,,,,,,',
].join('\r\n');

const VOTES_CSV = [
  'タイムスタンプ,投票者の校舎・氏名,良いと思った改善を選択してください（一人3票まで）',
  '2026/07/06 22:23:26,越智秀也,"日野校：安東瑞輝「おはよう勉強会リフレクション集」, 駅前校：池田貴光「九文実施模試の案内改善」"',
  '2026/10/07 17:15:40,冨松太一,"大島校：冨田翔太「ガチャリニューアル！」, 大野校：宮川祥真・高松佑匡・大隈朋美・安田浩晃「大野校　高1・2サマーポイントバトル」"',
  '2026/10/08 11:43:59,日野・宮ケ中葉子,"駅前校：冨松太一・安藤純平「智翔館 会議DX」, 大島校：冨田翔太「ガチャリニューアル！」, 大島校：冨田翔太「ガチャリニューアル！」"',
  '2026/10/09 11:50:09,瀬戸山理恵,日野校：存在しない「消えた改善」',
].join('\r\n');

test('CSV：セル内の改行・「""」・「,」を読み、空の行は捨てる', () => {
  const rows = parseCsv('﻿a,b,c\r\n"1\n2","x""y",",z"\r\n,,\r\nlast,,');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1\n2', 'x"y', ',z'], ['last', '', '']]);
  assert.deepEqual(parseCsv('a,b\nc,d'), [['a', 'b'], ['c', 'd']]); // LF だけの CSV も読める
});

test('旧スプレッドシートの日時：秒を落とし、時刻の無い行は 00:00 にする', () => {
  assert.deepEqual(legacyTs('2026/06/16 6:25:11'), { text: '2026/06/16 06:25', month: '2026-06' });
  assert.deepEqual(legacyTs('2026/09/30'), { text: '2026/09/30 00:00', month: '2026-09' });
  assert.equal(legacyTs('タイムスタンプ'), null);
});

test('旧スプレッドシートの「回答」→ 改善', () => {
  let n = 0;
  const items = legacyItems(parseCsv(ANSWERS_CSV), () => `L${++n}`, '2026/10/13 15:00');
  assert.equal(items.length, 6);
  const [first, seto, naka, gacha, summer, dx] = items;
  assert.equal(first.month, '2026-06');
  assert.equal(first.source, '旧:2026/06/16 06:25|おはよう勉強会リフレクション集');
  assert.deepEqual(first.beforePhotos, ['https://drive.google.com/open?id=19s0soPEiDfWYNNwgh11f-hNQydhI58kG']);
  assert.deepEqual(seto.beforePhotos, []); // Before の写真が空で After だけある行
  assert.equal(seto.afterPhotos.length, 1);
  assert.equal(naka.before, '・面談シートにて生徒一人一人を写真にとってLINEで共有していた。\n・指示内容を別の用紙にメモし、消し込んでいた。');
  assert.equal(gacha.after, '生徒の"ほしい"ガチャ景品の写真を掲示。');
  assert.deepEqual(summer.members, ['宮川祥真', '高松佑匡', '大隈朋美', '安田浩晃']);
  assert.equal(summer.month, '2026-09');
  assert.equal(summer.beforePhotos.length, 2); // 1つのセルに写真が2枚
  assert.deepEqual(dx.members, ['冨松太一', '安藤純平']);
  assert.equal(dx.enteredBy, ''); // 取り込んだ改善は提出者に名前がある人が直せる
  assert.equal(canEdit(dx, '安藤純平', false, '2026-10-13', []), true);
});

test('旧スプレッドシートの「投票回答」→ 票：前の月の改善と突き合わせ、6月分は取り込まない', () => {
  let n = 0;
  const items = legacyItems(parseCsv(ANSWERS_CSV), () => `L${++n}`, '');
  const id = (title: string) => items.find((k) => k.title === title)!.id;
  const r = legacyVotes(parseCsv(VOTES_CSV), items);
  assert.equal(r.old, 1); // 7月の投票（6月分）
  assert.deepEqual(r.unmatched, ['瀬戸山理恵']);
  assert.deepEqual(r.votes.map((v) => [v.month, v.voter, v.ids, v.votedAt]), [
    ['2026-09', '冨松太一', [id('ガチャリニューアル！'), id('大野校　高1・2サマーポイントバトル')], '2026/10/07 17:15'],
    ['2026-09', '宮ケ中葉子', [id('智翔館 会議DX'), id('ガチャリニューアル！')], '2026/10/08 11:43'], // 校舎付きの名前・重複した選択
  ]);
});
