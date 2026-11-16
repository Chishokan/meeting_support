import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkPreset,
  checkSave,
  cleanTitle,
  cutoff,
  HISTORY_MAX,
  idsToPurge,
  isConvoId,
  PRESET_MAX,
  SAVED_MAX,
  splitRows,
  type ConvoRow,
  type Preset,
} from './savedRules.ts';

const now = new Date('2026-11-14T00:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const row = (id: string, kind: '履歴' | '保存', d: number): ConvoRow => ({ id, kind, title: id, turns: 1, chars: 10, createdAt: daysAgo(d), updatedAt: daysAgo(d) });

test('期限：履歴は30日、保存は1年', () => {
  assert.equal(cutoff('履歴', now).toISOString(), daysAgo(30));
  assert.equal(cutoff('保存', now).toISOString(), daysAgo(365));
  const rows = [row('h-new', '履歴', 29), row('h-old', '履歴', 31), row('s-new', '保存', 300), row('s-old', '保存', 400)];
  assert.deepEqual(idsToPurge(rows, now).sort(), ['h-old', 's-old']);
});

test('履歴は50件を超えたら古いものから消す（保存した会話は数では消さない）', () => {
  const rows = Array.from({ length: HISTORY_MAX + 3 }, (_, i) => row(`h${i}`, '履歴', i * 0.1));
  rows.push(...Array.from({ length: 25 }, (_, i) => row(`s${i}`, '保存', 1)));
  const del = idsToPurge(rows, now);
  assert.deepEqual(del, [`h${HISTORY_MAX}`, `h${HISTORY_MAX + 1}`, `h${HISTORY_MAX + 2}`]);
});

test('保存できるか', () => {
  const rows = [row('a', '履歴', 1)];
  assert.equal(checkSave(rows, 'a').ok, true);
  assert.equal(checkSave(rows, 'zzz').ok, false);
  const full = [...Array.from({ length: SAVED_MAX }, (_, i) => row(`s${i}`, '保存', 1)), row('a', '履歴', 1)];
  assert.equal(checkSave(full, 'a').ok, false);
  // 保存済みの会話の名前を変えるのはよい
  assert.equal(checkSave(full, 's0').ok, true);
});

test('一覧は新しい順に分ける', () => {
  const s = splitRows([row('h1', '履歴', 5), row('s1', '保存', 3), row('h2', '履歴', 1)]);
  assert.deepEqual(s.history.map((r) => r.id), ['h2', 'h1']);
  assert.deepEqual(s.saved.map((r) => r.id), ['s1']);
});

test('番号と名前', () => {
  assert.equal(isConvoId('20261114-1305-ab12'), true);
  assert.equal(isConvoId('../x'), false);
  assert.equal(cleanTitle('  冬期講習\nの計画  '), '冬期講習 の計画');
  assert.equal(cleanTitle(3), '');
});

test('いつものコンテキスト', () => {
  const limits = { maxName: 40, maxText: 100 };
  const existing: Preset[] = [{ id: 'p1', name: '担当', text: '中3', auto: true, sortOrder: 0, updatedAt: '' }];
  assert.deepEqual(checkPreset({ name: '決まり', text: '敬体で' }, existing, limits), {
    ok: true,
    preset: { id: 'p2', name: '決まり', text: '敬体で', auto: false, sortOrder: 1 },
  });
  // 直すときは番号と並びと「新しい会話に入れる」を引き継ぐ
  assert.deepEqual(checkPreset({ id: 'p1', text: '中2・中3' }, existing, limits), {
    ok: true,
    preset: { id: 'p1', name: '担当', text: '中2・中3', auto: true, sortOrder: 0 },
  });
  assert.equal(checkPreset({ name: 'x', text: '' }, existing, limits).ok, false);
  assert.equal(checkPreset({ name: 'x', text: 'あ'.repeat(101) }, existing, limits).ok, false);
  const full = Array.from({ length: PRESET_MAX }, (_, i) => ({ id: `p${i + 1}`, name: 'n', text: 't', auto: false, sortOrder: i, updatedAt: '' }));
  assert.equal(checkPreset({ name: 'x', text: 'y' }, full, limits).ok, false);
  assert.equal(checkPreset({ id: 'p3', name: 'x', text: 'y' }, full, limits).ok, true);
});
