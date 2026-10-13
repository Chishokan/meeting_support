// つきいち改善の受付状態・投票の確かめ・集計（model.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  buildView,
  canEdit,
  checkVote,
  driveFileId,
  kaizenLabel,
  missingSubmitters,
  normalizeInput,
  normalizeMonth,
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

test('表示：旧スプレッドシートと同じ書き方のラベル・Drive の写真の縮小 URL', () => {
  assert.equal(kaizenLabel({ campus: '日野', members: ['安東瑞輝'], title: '自学自習AAR' }), '日野校：安東瑞輝「自学自習AAR」');
  assert.equal(kaizenLabel({ campus: '大野', members: ['宮川祥真', '高松佑匡'], title: 'X' }), '大野校：宮川祥真・高松佑匡「X」');
  assert.equal(driveFileId('https://drive.google.com/open?id=19s0soPEiDfWYNNwgh11f-hNQydhI58kG'), '19s0soPEiDfWYNNwgh11f-hNQydhI58kG');
  assert.equal(driveFileId('https://drive.google.com/file/d/1EiqOIctIy4mjxsrRDnMWWjxL505I1rp6/view'), '1EiqOIctIy4mjxsrRDnMWWjxL505I1rp6');
  assert.equal(photoThumbUrl('https://drive.google.com/open?id=19s0soPEiDfWYNNwgh11f-hNQydhI58kG', 600), 'https://drive.google.com/thumbnail?id=19s0soPEiDfWYNNwgh11f-hNQydhI58kG&sz=w600');
  assert.equal(photoThumbUrl('data:image/jpeg;base64,AAAA'), 'data:image/jpeg;base64,AAAA');
});
