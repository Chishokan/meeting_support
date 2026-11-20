// 重要タスク報告の対象週と入力チェック（taskReport.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanReport, isValidWeek, MAX_TEXT_LENGTH, QUESTIONS, reportRow, SHEET_HEADERS, weekOptions } from './taskReport.ts';

const SCHOOLS = ['佐世保駅前校', '日野校'];
const at = (iso: string) => new Date(iso);

test('weekOptions: 金曜に開くと、その日で終わる週が既定。途中の週は足さない', () => {
  const { options, defaultValue } = weekOptions(at('2026-10-30T12:00:00+09:00'));
  assert.equal(defaultValue, '2026-10-24〜2026-10-30');
  assert.deepEqual(options.map((o) => o.value), [
    '2026-10-24〜2026-10-30', '2026-10-17〜2026-10-23', '2026-10-10〜2026-10-16',
  ]);
  assert.equal(options[0].label, '10/24（土）〜10/30（金）');
});

test('weekOptions: 土〜木に開くと、既定は前の金曜で終わる週。途中の今週を先頭に足す', () => {
  const { options, defaultValue } = weekOptions(at('2026-11-01T09:00:00+09:00')); // 日曜
  assert.equal(defaultValue, '2026-10-24〜2026-10-30');
  assert.equal(options[0].value, '2026-10-31〜2026-11-06');
  assert.equal(options[0].label, '10/31（土）〜11/6（金）（途中）');
  assert.equal(options.length, 4);
});

test('weekOptions: 日付は日本時間で数える（UTC では前日でも、日本時間で土曜なら土曜）', () => {
  const { defaultValue } = weekOptions(at('2026-10-30T16:00:00Z')); // 日本時間 10/31（土）1:00
  assert.equal(defaultValue, '2026-10-24〜2026-10-30');
  assert.equal(weekOptions(at('2026-10-30T16:00:00Z')).options[0].value, '2026-10-31〜2026-11-06');
});

test('isValidWeek: 土曜はじまりの7日間だけを通す', () => {
  assert.equal(isValidWeek('2026-10-17〜2026-10-23'), true);
  assert.equal(isValidWeek('2026-10-18〜2026-10-24'), false); // 日曜はじまり
  assert.equal(isValidWeek('2026-10-17〜2026-10-24'), false); // 8日間
  assert.equal(isValidWeek('2026-02-30〜2026-03-06'), false); // ない日付
  assert.equal(isValidWeek(''), false);
});

const full = {
  week: '2026-11-14〜2026-11-20',
  school: '佐世保駅前校',
  answers: { m1: ' 模試の案内を中1・2の全員に配った ', m2: '冬期の外部生リストに電話した', other: '' },
};

test('QUESTIONS: マイルストーン2つ（必須）と、そのほか（任意）の3問', () => {
  assert.deepEqual(QUESTIONS.map((q) => [q.key, q.no, q.required]), [['m1', 1, true], ['m2', 2, true], ['other', 3, false]]);
  assert.match(QUESTIONS[0].label, /中1・2模試、レベル模試の動員率7割/);
  assert.match(QUESTIONS[1].label, /冬期講習 外部生（中1・2年）の目標動員率3割完了/);
});

test('cleanReport: 必須の2つがそろえば通し、前後の空白を落とす', () => {
  const r = cleanReport(full, SCHOOLS);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.report.answers.m1, '模試の案内を中1・2の全員に配った');
  assert.equal(r.report.answers.other, '');
  assert.deepEqual(reportRow(r.report), ['2026-11-14〜2026-11-20', '佐世保駅前校', '模試の案内を中1・2の全員に配った', '冬期の外部生リストに電話した', '']);
  assert.equal(SHEET_HEADERS.length, reportRow(r.report).length);
  assert.equal(SHEET_HEADERS[2], '1 マイルストーン1（中1・2模試、レベル模試の動員率7割）の改善・工夫');
});

test('cleanReport: 足りない設問の番号を返す（3は任意）', () => {
  const r = cleanReport({ ...full, answers: { m1: ' ', m2: '', other: 'メモ' } }, SCHOOLS);
  assert.deepEqual(r, { ok: false, reason: 'missing', missing: [1, 2] });
});

test('cleanReport: 週・校舎が正しくなければ通さない。前の設問（進行表の%など）が送られてきても無視する', () => {
  assert.equal(cleanReport({ ...full, week: '2026-11-15〜2026-11-21' }, SCHOOLS).ok, false);
  assert.equal(cleanReport({ ...full, school: '広田教室' }, SCHOOLS).ok, false);
  const r = cleanReport({ ...full, answers: { ...full.answers, progress: '120', m3: 'x' } }, SCHOOLS);
  assert.equal(r.ok, true);
  assert.equal(r.ok && reportRow(r.report).length, 5);
});

test('cleanReport: 長すぎる文は上限で切る', () => {
  const r = cleanReport({ ...full, answers: { ...full.answers, m1: 'あ'.repeat(MAX_TEXT_LENGTH + 50) } }, SCHOOLS);
  assert.equal(r.ok && r.report.answers.m1.length, MAX_TEXT_LENGTH);
});
