// 採点（scoring.ts）と初期の版（seed.ts）のテスト。
//   npm test
// Node の型ストリップで動かすため、テスト対象は「import type」以外で model.ts を読まない作りにしてある。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageSeconds, judge, scoreScales } from './scoring.ts';
import { SEED_QUESTIONS, SEED_RULES, SEED_SCALES } from './seed.ts';
import type { Answer, Question, RoleRule, ScaleCode } from './model.ts';

const CODES: ScaleCode[] = ['L', 'CP', 'NP', 'A', 'FC', 'AC', 'ST', 'EM', 'AV', 'IM'];

function answersFrom(questions: Question[], pick: (q: Question) => 'Y' | 'N', seconds: number | null = 3): Answer[] {
  return questions.map((q) => ({ no: q.no, answer: pick(q), seconds }));
}

/** 尺度ごとに「はい」の数を指定した回答（その尺度の先頭から n 問を「はい」）。 */
function answersWithCounts(counts: Partial<Record<ScaleCode, number>>): Answer[] {
  const used: Partial<Record<ScaleCode, number>> = {};
  return SEED_QUESTIONS.map((q) => {
    const n = used[q.scale] ?? 0;
    used[q.scale] = n + 1;
    return { no: q.no, answer: n < (counts[q.scale] ?? 0) ? 'Y' : 'N', seconds: 3 };
  });
}

function flatRule(over: Partial<RoleRule> = {}): RoleRule {
  const scales = Object.fromEntries(
    CODES.map((c) => [c, { weight: 0, caution: null, alert: null, highNote: '', lowNote: '' }]),
  ) as RoleRule['scales'];
  return { gradeA: 60, gradeB: 40, lieAt: 7, minAvgSec: 1, highAt: 7, lowAt: 3, scales, ...over };
}

// ---- 初期の版 ---------------------------------------------------------------

test('seed: 設問は1〜100の100問で、一の位で尺度が決まる', () => {
  assert.equal(SEED_QUESTIONS.length, 100);
  SEED_QUESTIONS.forEach((q, i) => {
    assert.equal(q.no, i + 1);
    assert.equal(q.scale, CODES[q.no % 10 === 0 ? 9 : (q.no % 10) - 1]);
    assert.ok(q.text.length > 0, `設問 ${q.no} の本文が空`);
    assert.equal(q.active, true);
  });
  assert.equal(SEED_QUESTIONS[0].text, '勝負事に負けてもなんとも思わない');
  assert.equal(SEED_QUESTIONS[99].text, '私は同年代の異性と対等ではない');
});

test('seed: 尺度は10、判定基準は3職種ぶんすべての尺度を持つ', () => {
  assert.deepEqual(SEED_SCALES.map((s) => s.code), CODES);
  for (const role of ['講師', '事務', '社員'] as const) {
    const r = SEED_RULES[role];
    assert.deepEqual(Object.keys(r.scales).sort(), [...CODES].sort());
    assert.ok(r.gradeB <= r.gradeA);
    assert.ok(Object.values(r.scales).some((s) => s.weight > 0));
  }
});

test('seed: 公正採用選考の要確認（10・20・90・100）とストレス耐性の反転要確認に備考がある', () => {
  for (const no of [10, 20, 90, 100, 17, 57, 97]) {
    assert.match(SEED_QUESTIONS[no - 1].note, /要確認/);
  }
});

// ---- 尺度得点 ---------------------------------------------------------------

test('scoreScales: 全部「はい」なら全尺度10点', () => {
  const s = scoreScales(SEED_QUESTIONS, answersFrom(SEED_QUESTIONS, () => 'Y'));
  for (const c of CODES) assert.deepEqual(s[c], { raw: 10, max: 10, score: 10 });
});

test('scoreScales: 反転項目は「いいえ」で1点', () => {
  const qs = SEED_QUESTIONS.map((q) => (q.no === 7 ? { ...q, reverse: true } : q));
  const s = scoreScales(qs, answersFrom(qs, () => 'N'));
  assert.deepEqual(s.ST, { raw: 1, max: 10, score: 1 });
  assert.deepEqual(s.L, { raw: 0, max: 10, score: 0 });
});

test('scoreScales: 使わない設問は外し、10点満点に換算する', () => {
  const off = new Set([10, 20, 90, 100]);
  const qs = SEED_QUESTIONS.map((q) => (off.has(q.no) ? { ...q, active: false } : q));
  // IM の残り6問（30,40,50,60,70,80）のうち3問だけ「はい」
  const yes = new Set([30, 40, 50]);
  const s = scoreScales(qs, answersFrom(qs, (q) => (yes.has(q.no) ? 'Y' : 'N')));
  assert.deepEqual(s.IM, { raw: 3, max: 6, score: 5 });
});

test('scoreScales: 回答の無い設問は満点にも数えない。全部無ければ null', () => {
  const ans = answersFrom(SEED_QUESTIONS, () => 'Y').filter((a) => a.no % 10 !== 1 && a.no !== 2);
  const s = scoreScales(SEED_QUESTIONS, ans);
  assert.deepEqual(s.L, { raw: 0, max: 0, score: null });
  assert.deepEqual(s.CP, { raw: 9, max: 9, score: 10 });
});

test('averageSeconds: 秒数のある回答だけで平均し、無ければ null', () => {
  assert.equal(averageSeconds([{ no: 1, answer: 'Y', seconds: 2 }, { no: 2, answer: 'N', seconds: 4 }, { no: 3, answer: 'Y', seconds: null }]), 3);
  assert.equal(averageSeconds([{ no: 1, answer: 'Y', seconds: null }]), null);
});

// ---- 判定 -------------------------------------------------------------------

test('judge: 適性スコアは重みつきの平均（0〜100）で、基準で A/B/C が決まる', () => {
  const rule = flatRule();
  rule.scales.NP.weight = 1.5;
  rule.scales.CP.weight = 1;
  // NP 8点・CP 4点 → (1.5*8 + 1*4) / (2.5*10) = 16/25 = 64
  const scores = scoreScales(SEED_QUESTIONS, answersWithCounts({ NP: 8, CP: 4 }));
  const j = judge('講師', scores, rule, SEED_SCALES, null);
  assert.equal(j.aptitude, 64);
  assert.equal(j.baseGrade, 'A');
  assert.equal(j.grade, 'A');
  assert.equal(j.reliable, true);
  assert.deepEqual(j.flags, []);

  const low = judge('講師', scoreScales(SEED_QUESTIONS, answersWithCounts({ NP: 4, CP: 3 })), rule, SEED_SCALES, null);
  // (6 + 3) / 25 = 36 → C
  assert.equal(low.aptitude, 36);
  assert.equal(low.grade, 'C');
});

test('judge: 注意に当たれば B まで、要注意に当たれば C', () => {
  const rule = flatRule();
  rule.scales.NP.weight = 1;
  rule.scales.EM = { ...rule.scales.EM, caution: 6, alert: 8 };
  const caution = judge('講師', scoreScales(SEED_QUESTIONS, answersWithCounts({ NP: 9, EM: 6 })), rule, SEED_SCALES, null);
  assert.equal(caution.baseGrade, 'A');
  assert.equal(caution.grade, 'B');
  assert.deepEqual(caution.flags.map((f) => [f.kind, f.scale]), [['caution', 'EM']]);

  const alert = judge('講師', scoreScales(SEED_QUESTIONS, answersWithCounts({ NP: 9, EM: 8 })), rule, SEED_SCALES, null);
  assert.equal(alert.grade, 'C');
  assert.deepEqual(alert.flags.map((f) => [f.kind, f.scale]), [['alert', 'EM']]);

  // 基本判定が C なら注意でも C のまま（上がらない）
  const stillC = judge('講師', scoreScales(SEED_QUESTIONS, answersWithCounts({ NP: 2, EM: 6 })), rule, SEED_SCALES, null);
  assert.equal(stillC.grade, 'C');
});

test('judge: 虚偽が高い・回答が速すぎるときは判定は変えず「参考値」', () => {
  const rule = flatRule();
  rule.scales.NP.weight = 1;
  const scores = scoreScales(SEED_QUESTIONS, answersWithCounts({ NP: 9, L: 7 }));
  const j = judge('講師', scores, rule, SEED_SCALES, 0.6);
  assert.equal(j.grade, 'A');
  assert.equal(j.reliable, false);
  assert.deepEqual(j.flags.map((f) => f.kind).sort(), ['lie', 'speed']);

  // 紙受検（秒数なし）では速さを見ない
  const paper = judge('講師', scoreScales(SEED_QUESTIONS, answersWithCounts({ NP: 9 })), rule, SEED_SCALES, null);
  assert.equal(paper.reliable, true);
});

test('judge: 判定理由に適性スコアと基準、当たった閾値が出る', () => {
  const rule = flatRule();
  rule.scales.NP.weight = 1;
  rule.scales.IM = { ...rule.scales.IM, caution: 3, alert: 5 };
  const j = judge('講師', scoreScales(SEED_QUESTIONS, answersWithCounts({ NP: 7, IM: 5 })), rule, SEED_SCALES, null);
  assert.match(j.reasons[0], /適性スコア 70/);
  assert.ok(j.reasons.some((r) => r.includes('未成熟') && r.includes('5') && r.includes('C')));
});

test('judge: 確認ポイントは高い／低い尺度と、注意に当たった尺度から出る', () => {
  const rule = flatRule();
  rule.scales.NP = { ...rule.scales.NP, weight: 1, lowNote: 'NPが低い' };
  rule.scales.FC = { ...rule.scales.FC, highNote: 'FCが高い' };
  rule.scales.IM = { ...rule.scales.IM, caution: 3, highNote: 'IMを確認' };
  rule.scales.A = { ...rule.scales.A, highNote: 'Aが高い', lowNote: 'Aが低い' };
  const j = judge('講師', scoreScales(SEED_QUESTIONS, answersWithCounts({ NP: 2, FC: 8, IM: 3, A: 5 })), rule, SEED_SCALES, null);
  assert.deepEqual(
    j.checkpoints.map((c) => [c.scale, c.level, c.text]),
    [['NP', '低', 'NPが低い'], ['FC', '高', 'FCが高い'], ['IM', '高', 'IMを確認']],
  );
});

test('judge: 初期の判定基準で、同じ回答でも職種によって判定が変わりうる', () => {
  const scores = scoreScales(SEED_QUESTIONS, answersWithCounts({ CP: 9, NP: 3, A: 9, FC: 3, ST: 6 }));
  const teacher = judge('講師', scores, SEED_RULES['講師'], SEED_SCALES, 3);
  const office = judge('事務', scores, SEED_RULES['事務'], SEED_SCALES, 3);
  assert.ok(office.aptitude > teacher.aptitude, `事務 ${office.aptitude} > 講師 ${teacher.aptitude}`);
});
