// 門配の月の集計（model.ts の summarizeMonth）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMonth, type MonpaiRecord, type MonthSetting, type School } from './model.ts';

const SCHOOLS: School[] = [
  { district: '大野', name: '大野中', kind: '中', students: 300, order: 1, note: '' },
  { district: '大野', name: '大野小', kind: '小', students: 200, order: 2, note: '' },
  { district: '駅前', name: '清水中', kind: '中', students: 100, order: 1, note: '' },
];

let seq = 0;
function rec(p: Partial<MonpaiRecord>): MonpaiRecord {
  return {
    id: String(++seq), date: '2026-09-10', time: '', district: '大野', school: '大野中', staff1: '', staff2: '',
    material: '', planned: 0, done: null, status: '予定', reason: '', memo: '',
    createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', ...p,
  };
}

test('summarizeMonth: 中止は計画にも実績にも数えず、過ぎた日の未報告とこれからの予定を分ける', () => {
  const s = summarizeMonth([
    rec({ planned: 50, done: 40, status: '実施' }),
    rec({ planned: 30, done: 0, status: '実施' }),
    rec({ planned: 20, status: '中止', reason: '雨' }),
    rec({ date: '2026-09-29', planned: 25 }), // 今日（9/30）より前で未報告
    rec({ date: '2026-09-30', planned: 10 }), // 今日の予定は未報告にしない
    rec({ date: '2026-10-01', planned: 99, done: 99, status: '実施' }), // 別の月
  ], SCHOOLS, [], '2026-09', '2026-09-30');

  const t = s.districts.find((d) => d.district === '大野')!.schools.find((x) => x.school === '大野中')!;
  assert.deepEqual(
    { planned: t.planned, done: t.done, visits: t.visits, canceled: t.canceled, unreported: t.unreported, upcoming: t.upcoming },
    { planned: 115, done: 40, visits: 2, canceled: 1, unreported: 1, upcoming: 1 },
  );
  assert.equal(s.total.done, 40);
  assert.deepEqual(s.unreported.map((r) => r.date), ['2026-09-29']);
  assert.deepEqual(s.canceled.map((r) => r.reason), ['雨']);
});

test('summarizeMonth: ボトムは学校マスタの学校だけ（月別設定の率を使う）。マスタに無い学校の実績も数える', () => {
  const settings: MonthSetting[] = [{ month: '2026-09', school: '大野中', rate: 0.5, recruit: false }];
  const s = summarizeMonth([
    rec({ school: '大野中', planned: 100, done: 90, status: '実施' }),
    rec({ school: '旧学校', planned: 30, done: 30, status: '実施' }),
  ], SCHOOLS, settings, '2026-09', '2026-10-13');

  const ono = s.districts.find((d) => d.district === '大野')!;
  assert.deepEqual(ono.schools.map((x) => [x.school, x.bottom, x.done, x.registered]), [
    ['大野中', 150, 90, true], // 300 × 50%
    ['大野小', 60, 0, true], // 200 × 30%（実績が無くても行は出す）
    ['旧学校', 0, 30, false],
  ]);
  assert.equal(ono.bottom, 210);
  assert.equal(ono.done, 120);
  // 地区の並びは DISTRICTS の順。記録の無い地区もボトムは数える
  assert.equal(s.districts[0].district, '駅前');
  assert.equal(s.districts[0].bottom, 20);
  assert.equal(s.total.bottom, 230);
  assert.equal(s.total.done, 120);
});

test('summarizeMonth: 担当は1人ずつ数え、姓だけと姓名を同じ人にまとめる', () => {
  const s = summarizeMonth([
    rec({ staff1: '越智', planned: 50, done: 50, status: '実施' }),
    rec({ staff1: '越智浩晃', staff2: '松田', planned: 40, done: 30, status: '実施' }),
    rec({ staff1: '中山、松田', planned: 20, status: '中止', reason: '行事' }),
    rec({ staff1: '中山', date: '2026-09-01', planned: 20 }), // 未報告
    rec({ staff1: '中山', date: '2026-09-30', planned: 20 }), // これからの予定は数えない
  ], SCHOOLS, [], '2026-09', '2026-09-15');

  assert.deepEqual(s.staff, [
    { name: '越智浩晃', visits: 2, done: 80, canceled: 0, unreported: 0 },
    { name: '松田', visits: 1, done: 30, canceled: 1, unreported: 0 },
    { name: '中山', visits: 0, done: 0, canceled: 1, unreported: 1 },
  ]);
});
