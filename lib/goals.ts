// 目標管理：中等部会議議事録の「秋～冬行動計画」タブから月×校舎×指標の目標／実績を読む。
//
// 実績の出所は指標ごとに変える（方針）：
// - 問合せ管理から計算できるもの（入会・体験）は自動計算値を使う。
//   シートの実績は会議前にまとめて入力されるため遅れる。日々の進捗を見るには一次データが要る。
// - 計算できないもの（サイトク・模試）はシートに入力された実績を使う。
// どちらを使ったかは画面に出す。数字の出所が分からないまま判断されるのを防ぐため。

import type { CampusStat } from './inquiryBoard';

export type GoalRow = {
  month: number;    // 9, 10, ...
  campus: string;   // 中等部 / 日野校 / 駅前校 / 大野校 / 日宇校 / 県中
  metric: string;   // 今月入会 / サイトク前期外部受講者 / 体験授業 / 10/18一斉模試 …
  target: number | null;
  actual: number | null; // シートに手入力された実績
};

export type GoalsResult =
  | { ok: true; rows: GoalRow[]; sheet: string; fetchedAt: string }
  | { ok: false; reason: string };

export async function listGoals(): Promise<GoalsResult> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'listGoals', token: process.env.APPS_SCRIPT_TOKEN || '' }),
      cache: 'no-store',
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.ok !== true || !Array.isArray(j.items)) {
      return { ok: false, reason: (j && j.reason) || 'upstream_error' };
    }
    const rows: GoalRow[] = j.items.map((r: Record<string, unknown>) => ({
      month: Number(r?.month ?? 0),
      campus: String(r?.campus ?? ''),
      metric: String(r?.metric ?? ''),
      target: r?.target == null ? null : Number(r.target),
      actual: r?.actual == null ? null : Number(r.actual),
    }));
    return { ok: true, rows, sheet: String(j.sheet ?? ''), fetchedAt: String(j.fetchedAt ?? '') };
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

// --- 校舎名の突き合わせ ---------------------------------------------------

// 行動計画は「県中」、問合せ管理は「県中対策」のように表記が違う。
// 「校」「対策」と空白を落としてから、どちらかがどちらかを含めば同じ校舎とみなす。
function normCampus(s: string): string {
  return (s || '').replace(/[\s　]/g, '').replace(/校$/, '').replace(/対策$/, '');
}

export function sameCampus(a: string, b: string): boolean {
  const x = normCampus(a);
  const y = normCampus(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

// --- 実績の出所 -----------------------------------------------------------

/** 問合せ管理から自動計算できる指標。キーは指標名に含まれる文字列。 */
const AUTO_METRICS: { match: string; field: keyof Pick<CampusStat, 'joined' | 'trialDone'> }[] = [
  { match: '入会', field: 'joined' },
  { match: '体験', field: 'trialDone' },
];

export type GoalView = {
  metric: string;
  target: number | null;
  actual: number | null;
  source: '自動' | 'シート';
};

/**
 * ある月・ある校舎の目標対比を組み立てる。
 * stat が渡されていれば、自動計算できる指標はそちらの値を使う。
 */
export function goalsFor(
  goals: GoalRow[],
  month: number,
  campus: string,
  stat?: CampusStat,
): GoalView[] {
  return goals
    .filter((g) => g.month === month && sameCampus(g.campus, campus))
    .map((g) => {
      const auto = AUTO_METRICS.find((a) => g.metric.includes(a.match));
      if (auto && stat) {
        return { metric: g.metric, target: g.target, actual: stat[auto.field], source: '自動' as const };
      }
      return { metric: g.metric, target: g.target, actual: g.actual, source: 'シート' as const };
    })
    .filter((v) => v.target != null || v.actual != null);
}

/** 目標に届いていない指標だけを返す（AIに「何が遅れているか」を答えさせるため）。 */
export function behindGoals(views: GoalView[]): GoalView[] {
  return views.filter((v) => v.target != null && v.target > 0 && (v.actual ?? 0) < v.target);
}

/** プロンプト用。月・校舎ごとに1行。 */
export function formatGoals(goals: GoalRow[], statsByMonth: Map<number, CampusStat[]>): string {
  if (!goals.length) return '（目標データがありません）';

  const months = [...new Set(goals.map((g) => g.month))].sort((a, b) => a - b);
  const out: string[] = [];

  for (const m of months) {
    out.push(`■ ${m}月`);
    const campuses = [...new Set(goals.filter((g) => g.month === m).map((g) => g.campus))];
    for (const c of campuses) {
      const stat = (statsByMonth.get(m) ?? []).find((s) => sameCampus(s.campus, c));
      const views = goalsFor(goals, m, c, stat);
      if (!views.length) continue;
      const body = views
        .map((v) => {
          const t = v.target == null ? '—' : v.target;
          const a = v.actual == null ? '—' : v.actual;
          return `${v.metric} ${a}/${t}（実績の出所:${v.source}）`;
        })
        .join(' ／ ');
      out.push(`  ${c}：${body}`);
    }
  }
  return out.join('\n');
}
