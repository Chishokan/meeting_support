// 中学校のテスト問題の保存と検索（testPapers.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_SCHOOLS,
  OTHER_SCHOOL,
  PUBLIC_HIGH_SCHOOL,
  SCHOOL_GROUPS,
  TEST_FILE_MAX_BYTES,
  TEST_FILE_MAX_CHARS,
  checkFile,
  checkMeta,
  checkSavedFiles,
  checkSearchInput,
  currentSchoolYear,
  filterTestPapers,
  formatTestPapers,
  parseFilesCell,
  schoolKey,
  testFileName,
  testLabel,
  type TestPaperRec,
} from './testPapers.ts';

const TEIKI = { kind: '定期テスト', year: 2026, round: 2, school: '佐世保市立日宇中学校', grade: '中2', subject: '数学', memo: '' };

test('学校の一覧：同じ名前が無い・佐世保市と西海市の学校がある', () => {
  assert.equal(new Set(ALL_SCHOOLS).size, ALL_SCHOOLS.length);
  assert.ok(SCHOOL_GROUPS.some((g) => g.label.startsWith('佐世保市')));
  assert.ok(SCHOOL_GROUPS.some((g) => g.label.startsWith('西海市')));
  assert.ok(ALL_SCHOOLS.includes('佐世保市立日宇中学校'));
  assert.ok(ALL_SCHOOLS.includes('西海市立大瀬戸中学校'));
  assert.ok(!ALL_SCHOOLS.includes(OTHER_SCHOOL));
});

test('定期・実力：実施回（1〜4）・一覧の中学校・学年・科目がそろえば通す', () => {
  const r = checkMeta(TEIKI);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.listed, true);
    assert.equal(r.value.entranceType, '');
    assert.equal(testLabel(r.value), '2026年度 佐世保市立日宇中学校 中2 数学 第2回定期テスト');
  }
  assert.equal(checkMeta({ ...TEIKI, kind: '' }).ok, false);
  assert.equal(checkMeta({ ...TEIKI, kind: '模試' }).ok, false);
  assert.equal(checkMeta({ ...TEIKI, round: 5 }).ok, false);
  assert.equal(checkMeta({ ...TEIKI, round: 0 }).ok, false);
  assert.equal(checkMeta({ ...TEIKI, grade: '' }).ok, false);
  assert.equal(checkMeta({ ...TEIKI, subject: '技術' }).ok, false);
  assert.equal(checkMeta({ ...TEIKI, year: 1999 }).ok, false);
  // 一覧に無い名前をそのまま送っても通さない（表記の揺れを防ぐ）
  const typo = checkMeta({ ...TEIKI, school: '日宇中' });
  assert.equal(typo.ok, false);
  if (!typo.ok) assert.match(typo.message, /中学校を選んで/);
});

test('一覧に無い学校：「一覧に無い学校」を選んで名前を入れたときだけ通す', () => {
  assert.equal(checkMeta({ ...TEIKI, school: OTHER_SCHOOL, otherSchool: ' ' }).ok, false);
  const r = checkMeta({ ...TEIKI, kind: '実力テスト', school: OTHER_SCHOOL, otherSchool: ' 波佐見町立波佐見中学校 ' });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.school, '波佐見町立波佐見中学校');
    assert.equal(r.value.listed, false);
    assert.equal(testLabel(r.value), '2026年度 波佐見町立波佐見中学校 中2 数学 第2回実力テスト');
  }
});

test('入試問題：公立は「長崎県公立高校」、私立は学校名が必須。実施回・学年は使わない', () => {
  const pub = checkMeta({ kind: '入試問題', year: 2026, subject: '英語', entranceType: '公立', school: '何か' });
  assert.ok(pub.ok);
  if (pub.ok) {
    assert.equal(pub.value.school, PUBLIC_HIGH_SCHOOL);
    assert.equal(pub.value.round, 0);
    assert.equal(testLabel(pub.value), '2026年度 入試問題（公立） 英語');
  }
  assert.equal(checkMeta({ kind: '入試問題', year: 2026, subject: '英語', entranceType: '' }).ok, false);
  assert.equal(checkMeta({ kind: '入試問題', year: 2026, subject: '英語', entranceType: '私立', school: '' }).ok, false);
  const pri = checkMeta({ kind: '入試問題', year: 2025, subject: '5教科', entranceType: '私立', school: '九州文化学園高等学校' });
  assert.ok(pri.ok);
  if (pri.ok) assert.equal(testLabel(pri.value), '2025年度 入試問題（私立） 九州文化学園高等学校 5教科');
});

test('ファイル名：年度_種類_学校_学年_科目_実施回_番号_元の名前', () => {
  const r = checkMeta(TEIKI);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(testFileName(r.value, '期末 問題.pdf', 'application/pdf', 0), '2026年度_定期テスト_佐世保市立日宇中学校_中2_数学_第2回_1_期末 問題.pdf');
  assert.equal(testFileName(r.value, 'IMG_0001.HEIC', 'image/jpeg', 2), '2026年度_定期テスト_佐世保市立日宇中学校_中2_数学_第2回_3_IMG_0001.jpg');
  const pub = checkMeta({ kind: '入試問題', year: 2026, subject: '英語', entranceType: '公立' });
  assert.ok(pub.ok);
  if (pub.ok) assert.equal(testFileName(pub.value, 'a/b.pdf', 'application/pdf', 0), '2026年度_入試問題_公立_英語_1_a b.pdf');
});

test('ファイル：PDF・画像・Word だけ。大きすぎるものは断る', () => {
  assert.ok(checkFile({ name: 'a.pdf', mime: 'application/pdf', data: 'AAAA' }).ok);
  assert.equal(checkFile({ name: 'a.xlsx', mime: 'application/vnd.ms-excel', data: 'AAAA' }).ok, false);
  assert.equal(checkFile({ name: 'a.pdf', mime: 'application/pdf', data: '' }).ok, false);
  assert.equal(checkFile({ name: 'a.pdf', mime: 'application/pdf', data: 'A'.repeat(TEST_FILE_MAX_CHARS + 1) }).ok, false);
  // 画面の上限（元の大きさ）で選んだファイルは、base64 にしても API の上限に収まる
  assert.ok(Math.ceil(TEST_FILE_MAX_BYTES / 3) * 4 <= TEST_FILE_MAX_CHARS);
  // アプリが受け取れる大きさ（4.5MB）に、JSON の残りも含めて収まる
  assert.ok(TEST_FILE_MAX_CHARS + 2000 < 4_500_000);
});

test('記録するファイル：ドライブの URL と ID のものだけ通す', () => {
  const ok = { name: 'a.pdf', url: 'https://drive.google.com/file/d/ABCDEFGHIJK/view', id: 'ABCDEFGHIJK' };
  assert.deepEqual(checkSavedFiles([ok, { ...ok, url: 'https://example.com/x' }, { ...ok, id: 'x' }, null]), [ok]);
  assert.deepEqual(checkSavedFiles('x'), []);
});

test('今の年度（4月始まり・日本時間）', () => {
  assert.equal(currentSchoolYear(new Date('2026-11-20T00:00:00Z')), 2026);
  assert.equal(currentSchoolYear(new Date('2027-03-31T14:59:00Z')), 2026);
  assert.equal(currentSchoolYear(new Date('2027-03-31T15:00:00Z')), 2027); // 日本時間 4/1 0:00
});

const rec = (o: Partial<TestPaperRec>): TestPaperRec => ({
  id: 'x', ts: '2026/11/20 10:00', user: '太田', campus: '小中等部', kind: '定期テスト', year: '2026', school: '佐世保市立日宇中学校',
  entranceType: '', grade: '中2', subject: '数学', round: '2', memo: '',
  files: [{ name: 'a.pdf', url: 'https://drive.google.com/file/d/A/view' }], ...o,
});
const ROWS = [
  rec({ id: '1', memo: '範囲は一次関数・連立方程式' }),
  rec({ id: '2', year: '2025', round: '4' }),
  rec({ id: '3', school: '佐世保市立大野中学校', subject: '5教科', round: '1' }),
  rec({ id: '4', kind: '入試問題', school: '長崎県公立高校', entranceType: '公立', grade: '', subject: '英語', round: '' }),
  rec({ id: '5', kind: '入試問題', school: '九州文化学園高等学校', entranceType: '私立', grade: '', subject: '数学', round: '' }),
  rec({ id: '6', kind: '実力テスト', school: '西海市立西海中学校', grade: '中3', subject: '理科', round: '3' }),
];

test('検索：学校名は一部でよい・科目は5教科も含む・実施回・公立私立・新しい年度から', () => {
  const ids = (q: Record<string, unknown>) => filterTestPapers(ROWS, checkSearchInput(q)).map((r) => r.id);
  assert.deepEqual(ids({ school: '日宇中' }), ['1', '2']);
  assert.deepEqual(ids({ school: '佐世保市立日宇中学校' }), ['1', '2']);
  assert.deepEqual(ids({ school: '日宇', round: 2 }), ['1']);
  assert.deepEqual(ids({ kind: '定期テスト', subject: '数学' }), ['1', '3', '2']);
  assert.deepEqual(ids({ kind: '入試問題', entrance_type: '公立' }), ['4']);
  assert.deepEqual(ids({ kind: '入試問題', subject: '数学' }), ['5']);
  assert.deepEqual(ids({ year: '2025年度' }), ['2']);
  assert.deepEqual(ids({ school: '西海中', kind: '実力テスト' }), ['6']);
  assert.deepEqual(ids({ query: '一次関数' }), ['1']);
  assert.equal(schoolKey('佐世保市立 日宇中学校'), '日宇');
  assert.equal(schoolKey('日宇中'), '日宇');
  assert.equal(schoolKey('長崎県立佐世保北中学校'), '佐世保北');
  assert.equal(schoolKey('佐世保市立浅子小中学校'), '浅子');
});

test('結果の文：リンクをそのまま出す。無ければ保存の小窓を案内させる', () => {
  const q = checkSearchInput({ school: '日宇' });
  const t = formatTestPapers(filterTestPapers(ROWS, q), ROWS.length, q);
  assert.match(t, /2件／保存は全部で6件/);
  assert.match(t, /2026年度 佐世保市立日宇中学校 中2 数学 第2回定期テスト/);
  assert.match(t, /a\.pdf：https:\/\/drive\.google\.com\/file\/d\/A\/view/);
  const none = formatTestPapers([], 6, checkSearchInput({ school: '相浦' }));
  assert.match(none, /保存されていない/);
  assert.match(none, /テスト問題を保存/);
  assert.equal(checkSearchInput({ limit: 99 }).limit, 30);
  assert.equal(checkSearchInput({ round: 7 }).round, 0);
});

test('シートの「ファイル」の欄を読む（URL の無い行は捨てる）', () => {
  assert.deepEqual(parseFilesCell('a.pdf｜https://drive.google.com/a\nb.pdf｜\n'), [{ name: 'a.pdf', url: 'https://drive.google.com/a' }]);
});
