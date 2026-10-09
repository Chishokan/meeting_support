// 適性検査の採点（純粋関数。サーバの API だけが呼ぶ。受検者のブラウザでは計算しない）。
//
//   1. 尺度得点：加点方向の回答を1点。採点に使う設問が10問に満たない尺度は10点満点に換算する
//   2. 適性スコア（0〜100）＝ Σ(重み×尺度得点) ÷ Σ(重み×10) × 100
//   3. 基本判定：A基準以上→A、B基準以上→B、それ未満→C
//   4. リスク：「注意」に当たれば判定はBまで、「要注意」に当たればC
//   5. 信頼性：虚偽が高い／回答が速すぎる ときは判定を変えず「参考値」にする
//   6. 判定理由と、面接での確認ポイントを添える
// 重み・閾値は職種ごと（RoleRule）。初期値は lib/aptitude/seed.ts、画面から版ごとに直せる。
//
// ★テスト（lib/aptitude/scoring.test.ts）で動かすため、model.ts からは型だけを読む。

import type { Answer, Checkpoint, Flag, Grade, Judgment, Question, Role, RoleRule, Scale, ScaleCode, ScaleScore } from './model';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 尺度ごとの得点。回答の無い設問・使わない設問は数えない。 */
export function scoreScales(questions: Question[], answers: Answer[]): Record<ScaleCode, ScaleScore> {
  const byNo = new Map(answers.map((a) => [a.no, a.answer]));
  const out = {} as Record<ScaleCode, ScaleScore>;
  for (const q of questions) {
    const s = (out[q.scale] ??= { raw: 0, max: 0, score: null });
    const a = byNo.get(q.no);
    if (!q.active || !a) continue;
    s.max += 1;
    if ((a === 'Y') !== q.reverse) s.raw += 1;
  }
  for (const s of Object.values(out)) s.score = s.max ? round1((s.raw / s.max) * 10) : null;
  return out;
}

/** 平均回答秒数（秒数の記録がある回答だけで計算。紙受検など記録が無ければ null）。 */
export function averageSeconds(answers: Answer[]): number | null {
  const xs = answers.map((a) => a.seconds).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

const fmt = (n: number) => String(round1(n));

export function judge(
  role: Role,
  scores: Record<ScaleCode, ScaleScore>,
  rule: RoleRule,
  scales: Scale[],
  avgSeconds: number | null,
): Judgment {
  const ordered = [...scales].sort((a, b) => a.order - b.order);
  const nameOf = (c: ScaleCode) => scales.find((s) => s.code === c)?.name ?? c;
  const scoreOf = (c: ScaleCode) => scores[c]?.score ?? null;

  // 2. 適性スコア
  let sum = 0;
  let denom = 0;
  for (const s of ordered) {
    const w = rule.scales[s.code]?.weight ?? 0;
    const v = scoreOf(s.code);
    if (w <= 0 || v == null) continue;
    sum += w * v;
    denom += w * 10;
  }
  const aptitude = denom ? Math.round((sum / denom) * 100) : 0;

  // 3. 基本判定
  const baseGrade: Grade = aptitude >= rule.gradeA ? 'A' : aptitude >= rule.gradeB ? 'B' : 'C';
  const reasons = [`適性スコア ${aptitude}（A：${rule.gradeA}以上／B：${rule.gradeB}以上）→ 基本の判定は ${baseGrade}`];

  // 4. リスク
  const flags: Flag[] = [];
  const flagged = new Set<ScaleCode>();
  for (const s of ordered) {
    const r = rule.scales[s.code];
    const v = scoreOf(s.code);
    if (!r || v == null) continue;
    if (r.alert != null && v >= r.alert) {
      flags.push({ kind: 'alert', scale: s.code, text: `${s.name} ${fmt(v)}点（要注意：${r.alert}点以上）` });
      flagged.add(s.code);
    } else if (r.caution != null && v >= r.caution) {
      flags.push({ kind: 'caution', scale: s.code, text: `${s.name} ${fmt(v)}点（注意：${r.caution}点以上）` });
      flagged.add(s.code);
    }
  }
  let grade = baseGrade;
  for (const f of flags) {
    if (f.kind === 'alert') {
      reasons.push(`${f.text} → 判定を C に`);
      grade = 'C';
    } else {
      reasons.push(`${f.text} → 判定は B まで`);
      if (grade === 'A') grade = 'B';
    }
  }

  // 5. 信頼性
  const lie = scoreOf('L');
  if (lie != null && lie >= rule.lieAt) {
    const text = `${nameOf('L')} ${fmt(lie)}点（${rule.lieAt}点以上）：よく見せようとした回答の可能性`;
    flags.push({ kind: 'lie', scale: 'L', text });
    reasons.push(`${text} → 判定は参考値`);
  }
  if (avgSeconds != null && avgSeconds < rule.minAvgSec) {
    const text = `平均回答時間 ${fmt(avgSeconds)}秒/問（${rule.minAvgSec}秒未満）：設問を読まずに答えた可能性`;
    flags.push({ kind: 'speed', text });
    reasons.push(`${text} → 判定は参考値`);
  }

  // 6. 確認ポイント（高い：highAt 以上か注意に当たった尺度／低い：lowAt 以下）
  const checkpoints: Checkpoint[] = [];
  for (const s of ordered) {
    const r = rule.scales[s.code];
    const v = scoreOf(s.code);
    if (!r || v == null) continue;
    if (r.highNote && (v >= rule.highAt || flagged.has(s.code))) checkpoints.push({ scale: s.code, level: '高', text: r.highNote });
    else if (r.lowNote && v <= rule.lowAt) checkpoints.push({ scale: s.code, level: '低', text: r.lowNote });
  }

  const reliable = !flags.some((f) => f.kind === 'lie' || f.kind === 'speed');
  return { role, aptitude, baseGrade, grade, reliable, flags, reasons, checkpoints };
}
