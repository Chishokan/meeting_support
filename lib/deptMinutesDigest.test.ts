// 議事録の社長送付用まとめ（deptMinutesDigest.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessage,
  formatMeetingDate,
  MESSAGE_MAX,
  normalizeDigest,
  parseInput,
  pdfFileName,
  recorderLabel,
  toDigest,
  type DigestInput,
} from './deptMinutesDigest.ts';
import { digestsHtml } from './deptMinutesDigestHtml.ts';

const input = (over: Partial<DigestInput> = {}): DigestInput => ({
  id: '427f9cf1-9a07-46e1-8fb1-e9f9553d2c3c',
  ts: '2026-11-02T06:05:00.199Z',
  campus: 'RED個別',
  user: '瀬戸山理恵',
  title: '中高連携会議',
  date: '2026/10/28',
  place: '佐世保駅前校',
  attendees: '瀬戸山、太田、田崎、小山',
  agenda: '',
  minutes: '■ 会議名 / 日時 / 場所\n中高連携会議',
  quality: '',
  editedAt: '',
  editedBy: '',
  revised: false,
  ...over,
});

test('normalizeDigest: 前後の空白・改行を詰め、空の項目を落とし、ToDo の状況を読み替える', () => {
  const body = normalizeDigest({
    purpose: '  高校継続の仕組みづくり ',
    summary: '模試返却面談は\n冬季前に完了。',
    decisions: [
      { title: '面談は冬季前に完了', detail: '対象約60人', owner: '太田', due: '冬季前' },
      { title: '', detail: '', owner: '太田', due: '' }, // 中身が無いので落とす
    ],
    todos: [
      { task: 'スケジュール表の統合', owner: '瀬戸山', due: '【要確認】', status: '〇' },
      { task: '資料の修正依頼', owner: '太田', due: '', status: '✕' },
      { task: '日程の仮組み', owner: '太田', due: '次回まで', status: 'unknown' },
      { task: '', owner: '太田', due: '' },
    ],
    pending: ['料金体系は本部に相談', '', 3],
    reports: 'not an array',
    next: '水曜 13:30〜',
    checks: ['担当未定が多い'],
  });
  assert.ok(body);
  assert.equal(body.purpose, '高校継続の仕組みづくり');
  assert.equal(body.summary, '模試返却面談は 冬季前に完了。');
  assert.equal(body.decisions.length, 1);
  assert.deepEqual(body.todos.map((t) => t.status), ['done', 'not_done', '']);
  assert.deepEqual(body.pending, ['料金体系は本部に相談']); // 文字列でないものは捨てる
  assert.deepEqual(body.reports, []);
});

test('normalizeDigest: 要約も決定事項も ToDo も無ければ失敗（null）。壊れた入力でも落ちない', () => {
  assert.equal(normalizeDigest({ summary: ' ', decisions: [], todos: [] }), null);
  assert.equal(normalizeDigest(null), null);
  assert.equal(normalizeDigest('text'), null);
  assert.ok(normalizeDigest({ decisions: [{ title: 'A' }] }));
});

test('normalizeDigest: 長すぎる文は切って … を付ける。項目数にも上限がある', () => {
  const body = normalizeDigest({
    summary: 'あ'.repeat(1000),
    decisions: Array.from({ length: 40 }, (_, i) => ({ title: `決定${i}`, detail: '', owner: '', due: '' })),
  });
  assert.ok(body);
  assert.ok(body.summary.length <= 260 && body.summary.endsWith('…'));
  assert.equal(body.decisions.length, 15);
});

test('formatMeetingDate: 年月日が読めれば曜日を付ける。0:00 は時刻なしとして落とす', () => {
  assert.equal(formatMeetingDate('2026/10/28'), '2026/10/28（水）');
  assert.equal(formatMeetingDate('2026/10/21 0:00'), '2026/10/21（水）');
  assert.equal(formatMeetingDate('2026/10/05 11:00'), '2026/10/05（月）11:00');
  assert.equal(formatMeetingDate('2026-9-14'), '2026/09/14（月）');
  // 読めないもの・ありえない日付は入力のまま
  assert.equal(formatMeetingDate('10/20(火)　毎週火曜日15時～'), '10/20(火)　毎週火曜日15時～');
  assert.equal(formatMeetingDate('2026/02/30'), '2026/02/30');
  assert.equal(formatMeetingDate(''), '');
});

test('recorderLabel: 直した人がいれば日付と名前を添える', () => {
  assert.equal(recorderLabel({ user: '冨田翔太', editedAt: '', editedBy: '' }), '冨田翔太');
  assert.equal(recorderLabel({ user: '冨田翔太', editedAt: '2026-10-28T01:46:02.273Z', editedBy: '冨田翔太' }), '冨田翔太（10/28 修正）');
  assert.equal(recorderLabel({ user: '冨田翔太', editedAt: '2026-11-01T20:00:00Z', editedBy: '安藤純平' }), '冨田翔太（11/2 安藤純平 修正）');
});

test('pdfFileName: 開催日と会議名から付ける。読めない日付は登録日（日本時間）、修正版は印を付ける', () => {
  assert.equal(pdfFileName(input()), '議事録_20261028_中高連携会議.pdf');
  assert.equal(pdfFileName(input({ date: '10/20(火) 15時～', ts: '2026-10-19T20:41:18Z' })), '議事録_20261020_中高連携会議.pdf');
  assert.equal(pdfFileName(input({ title: '大野校 改善/打合せ?', revised: true })), '議事録_20261028_大野校改善打合せ_修正版.pdf');
  assert.equal(pdfFileName(input({ title: '' })), '議事録_20261028_部門会議.pdf');
});

test('toDigest / buildMessage: 会議情報はシートの値、トークは要点だけ', () => {
  const body = normalizeDigest({
    summary: '模試返却面談は冬季前に完了。',
    decisions: [{ title: '面談は冬季前に完了', detail: '対象約60人', owner: '太田', due: '冬季前' }],
    todos: [],
    checks: ['担当・期限の未定が多い'],
    next: '',
  })!;
  const d = toDigest(input(), body, new Date('2026-11-02T06:20:00Z'));
  assert.equal(d.date, '2026/10/28（水）');
  assert.equal(d.createdAt, '2026/11/02 15:20');
  const msg = buildMessage(d);
  assert.match(msg, /^【議事録】中高連携会議\n2026\/10\/28（水）／佐世保駅前校／RED個別（記録：瀬戸山理恵）/);
  assert.match(msg, /■決定事項（1件）\n1\. 面談は冬季前に完了/);
  assert.match(msg, /■要確認\n・担当・期限の未定が多い/);
  assert.match(msg, /PDFをご覧ください。$/);

  const revised = buildMessage(toDigest(input({ revised: true }), body, new Date()));
  assert.match(revised, /^【議事録・修正版】/);
});

test('buildMessage: 長すぎるときは決定事項を件数だけにして、上限の文字数に収める', () => {
  const body = normalizeDigest({
    summary: 'あ'.repeat(250),
    decisions: Array.from({ length: 15 }, (_, i) => ({ title: `決定事項${i}`.padEnd(58, 'い'), detail: 'x', owner: '', due: '' })),
    checks: Array.from({ length: 4 }, () => 'う'.repeat(190)),
  })!;
  const msg = buildMessage(toDigest(input(), body, new Date()));
  assert.ok(msg.length <= MESSAGE_MAX, `length ${msg.length}`);
  assert.match(msg, /■決定事項 15件（PDF参照）/);
});

test('parseInput: 議事録本文が無ければ null。revised は true のときだけ', () => {
  assert.equal(parseInput({ title: 'x', minutes: '  ' }), null);
  assert.equal(parseInput(null), null);
  const p = parseInput({ minutes: '本文', revised: 'true', title: 12 });
  assert.ok(p);
  assert.equal(p.revised, false);
  assert.equal(p.title, '12');
  assert.equal(parseInput({ minutes: '本文', revised: true })!.revised, true);
});

test('digestsHtml: 会議ごとに改ページし、文字をエスケープし、【要確認】に印を付ける', () => {
  const body = normalizeDigest({
    summary: '<script>概要</script>',
    decisions: [{ title: '件名', detail: '内容', owner: '太田', due: '【要確認】' }],
    todos: [{ task: 'やること', owner: '', due: '', status: 'done' }],
  })!;
  const d1 = toDigest(input(), body, new Date('2026-11-09T00:00:00Z'));
  const d2 = toDigest(input({ title: '週礼' }), body, new Date('2026-11-09T00:00:00Z'));
  const html = digestsHtml([d1, d2], 'まとめ & 題');
  assert.equal((html.match(/page-break-before:always/g) || []).length, 1);
  assert.match(html, /<title>まとめ &amp; 題<\/title>/);
  assert.match(html, /&lt;script&gt;概要&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /期限：<b style="background:#fff2cc">要確認<\/b>/);
  assert.match(html, /No\. 2 \/ 2/);
  assert.match(html, /<td>〇<\/td>/);
});
