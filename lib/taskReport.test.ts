// 重要タスク報告の対象週と入力チェック（taskReport.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanReport, isValidWeek, MAX_TEXT_LENGTH, reportRow, SHEET_HEADERS, weekOptions } from './taskReport.ts';

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
  week: '2026-10-17〜2026-10-23',
  school: '佐世保駅前校',
  answers: { progress: ' 72 ', m1: '門配の時間を変えた', m2: 'なし', m3: '声かけ', other: '' },
};

test('cleanReport: 必須の4つがそろえば通し、前後の空白を落とす', () => {
  const r = cleanReport(full, SCHOOLS);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.report.answers.progress, '72');
  assert.equal(r.report.answers.other, '');
  assert.deepEqual(reportRow(r.report), ['2026-10-17〜2026-10-23', '佐世保駅前校', '72', '門配の時間を変えた', 'なし', '声かけ', '']);
  assert.equal(SHEET_HEADERS.length, reportRow(r.report).length);
});

test('cleanReport: 足りない設問の番号を返す（5は任意）', () => {
  const r = cleanReport({ ...full, answers: { progress: '', m1: ' ', m2: 'a', m3: '', other: '' } }, SCHOOLS);
  assert.deepEqual(r, { ok: false, reason: 'missing', missing: [1, 2, 4] });
});

test('cleanReport: 週・校舎・%の範囲が正しくなければ通さない', () => {
  assert.equal(cleanReport({ ...full, week: '2026-10-18〜2026-10-24' }, SCHOOLS).ok, false);
  assert.equal(cleanReport({ ...full, school: '広田教室' }, SCHOOLS).ok, false);
  for (const progress of ['120', '-1', 'abc']) {
    const r = cleanReport({ ...full, answers: { ...full.answers, progress } }, SCHOOLS);
    assert.deepEqual(r, { ok: false, reason: 'bad_progress' });
  }
});

test('cleanReport: 長すぎる文は上限で切る', () => {
  const r = cleanReport({ ...full, answers: { ...full.answers, m1: 'あ'.repeat(MAX_TEXT_LENGTH + 50) } }, SCHOOLS);
  assert.equal(r.ok && r.report.answers.m1.length, MAX_TEXT_LENGTH);
});
