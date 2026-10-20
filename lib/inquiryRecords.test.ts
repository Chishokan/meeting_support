// 問合せ管理の台帳（inquiryRecords.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPatch,
  editPatch,
  emptyInput,
  isFollowing,
  isOverdue,
  rebaseDraft,
  statsByGrade,
  type InquiryInput,
  type InquiryRecord,
} from './inquiryRecords.ts';

function rec(p: Partial<InquiryRecord>): InquiryRecord {
  return {
    ...emptyInput('日野校'),
    id: 'r1', no: 3, date: '2026-10-01', studentName: '佐藤 陽向',
    createdAt: '2026/10/01 10:00', createdBy: '山田', updatedAt: '2026/10/01 10:00', updatedBy: '山田',
    ...p,
  };
}

/** 画面が送る値（validateInput を通したあとの形）。 */
function input(r: InquiryRecord, p: Partial<InquiryInput> = {}): InquiryInput {
  const { id: _id, createdAt: _ca, createdBy: _cb, updatedAt: _ua, updatedBy: _ub, ...rest } = r;
  return { ...rest, ...p };
}

test('isFollowing: 結果が空と「検討中」はまだ決着していない', () => {
  assert.equal(isFollowing(''), true);
  assert.equal(isFollowing('検討中'), true);
  assert.equal(isFollowing('入塾'), false);
  assert.equal(isFollowing('講習会申込'), false);
  assert.equal(isFollowing('見送り'), false);
});

test('isOverdue: 検討中のままクローズ予定日を過ぎたら期限超過に入る', () => {
  const today = '2026-10-20';
  assert.equal(isOverdue({ closeDate: '2026-10-19', result: '' }, today), true);
  assert.equal(isOverdue({ closeDate: '2026-10-19', result: '検討中' }, today), true);
  assert.equal(isOverdue({ closeDate: '2026-10-19', result: '見送り' }, today), false);
  assert.equal(isOverdue({ closeDate: '2026-10-20', result: '検討中' }, today), false);
  assert.equal(isOverdue({ closeDate: '', result: '検討中' }, today), false);
});

test('statsByGrade: 検討中を別に数え、区分の合計が問合の件数と合う', () => {
  const rows = [
    rec({ id: 'a', grade: '中１', result: '' }),
    rec({ id: 'b', grade: '中１', result: '検討中' }),
    rec({ id: 'c', grade: '中１', result: '見送り' }),
    rec({ id: 'd', grade: '中１', result: '入塾' }),
    rec({ id: 'e', grade: '中１', result: '講習会申込' }),
  ];
  const t = statsByGrade(rows).total;
  assert.equal(t.considering, 1);
  assert.equal(t.open + t.considering + t.declined + t.joined + t.applied, t.total);
});

test('editPatch: 変えた項目だけを出す。旧データの表記の違いは「変えた」に入れない', () => {
  const base = rec({ grade: '中2', trial: '○', result: '' });
  const { patch, expect } = editPatch(base, input(base, { grade: '中２', trial: '〇', result: '入塾' }), 2026);
  assert.deepEqual(patch, { result: '入塾' });
  assert.deepEqual(expect, { result: '' });
});

test('editPatch: No. は値が来て変わったときだけ', () => {
  const base = rec({ no: 3 });
  assert.deepEqual(editPatch(base, { ...input(base), no: undefined }, 2026).patch, {});
  assert.deepEqual(editPatch(base, input(base, { no: 5 }), 2026).patch, { no: 5 });
});

test('applyPatch: 他の人が別の項目を直していたら、その変更を残して自分の項目だけ書く', () => {
  const base = rec({ contacted: '', note: '' });
  const current = rec({ contacted: '済', note: '', updatedBy: '鈴木' }); // 鈴木さんが連絡を直した
  const { patch, expect } = editPatch(base, input(base, { note: '体験希望' }), 2026);
  const r = applyPatch(current, patch, expect);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.next.contacted, '済');
    assert.equal(r.next.note, '体験希望');
  }
});

test('applyPatch: 同じ項目を別の値に直していたら衝突', () => {
  const base = rec({ result: '' });
  const current = rec({ result: '見送り' });
  const { patch, expect } = editPatch(base, input(base, { result: '入塾' }), 2026);
  const r = applyPatch(current, patch, expect);
  assert.deepEqual(r, { ok: false, conflicts: ['result'] });
});

test('applyPatch: 同じ項目を同じ値に直していたら衝突にしない', () => {
  const base = rec({ result: '' });
  const current = rec({ result: '入塾' });
  const { patch, expect } = editPatch(base, input(base, { result: '入塾' }), 2026);
  assert.equal(applyPatch(current, patch, expect).ok, true);
});

test('rebaseDraft: 自分が変えていない項目は新しい行の値になり、変えた項目は残る', () => {
  const prev = rec({ contacted: '', result: '', note: '' });
  const next = rec({ contacted: '済', result: '見送り', note: '' });
  const draft = input(prev, { result: '入塾', note: 'メモ' });
  const out = rebaseDraft(draft, prev, next);
  assert.equal(out.contacted, '済');   // 他の人の変更を取り込む
  assert.equal(out.result, '入塾');    // 自分の変更は残す（衝突した項目は画面で選ぶ）
  assert.equal(out.note, 'メモ');
});
