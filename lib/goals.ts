// 目標管理：中等部会議議事録の「秋～冬行動計画」タブから月×校舎×指標の目標／実績を読む。
//
// 実績の出所は指標ごとに変える（方針）：
// - 問合せ管理から計算できるもの（入会・体験）は自動計算値を使う。
//   シートの実績は会議前にまとめて入力されるため遅れる。日々の進捗を見るには一次データが要る。
// - 計算できないもの（サイトク・模試）はシートに入力された実績を使う。
// どちらを使ったかは画面に出す。数字の出所が分からないまま判断されるのを防ぐため。

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

// --- 表示順 ---------------------------------------------------------------

/**
 * カードの並び順。会議で見る順（日野・駅前・大野・日宇 → 県中 → その他）に固定する。
 * シートのタブ順やデータの出現順に任せると、月によって並びが変わって読みにくい。
 * ここに無い名前は末尾へ（新しい校舎が増えても落ちないように）。
 */
export const CAMPUS_ORDER = ['日野校', '駅前校', '大野校', '日宇校', '県中対策', 'その他'];

export function campusRank(name: string): number {
  const i = CAMPUS_ORDER.findIndex((c) => sameCampus(c, name));
  return i === -1 ? CAMPUS_ORDER.length : i;
}

/** 表示順に並べ替える（元の配列は変えない）。 */
export function sortByCampusOrder<T extends { campus: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const d = campusRank(a.campus) - campusRank(b.campus);
    return d !== 0 ? d : a.campus.localeCompare(b.campus, 'ja');
  });
}

// --- 実績の出所 -----------------------------------------------------------

/**
 * 問合せ管理から自動計算できる指標。
 *
 * ★「入会」は自動計算できない。問合せ管理には入塾日の列が無いため。
 *   「結果=入塾」を問い合わせ日の月で数えると、行動計画の「今月入会」とは別物になる。
 *   実データで確認すると、入塾42件の問い合わせ日は5月7件・6月13件・7月15件に集中し、
 *   9月に問い合わせた行の入塾は0件。9月に入会した人の行は5〜7月にある。
 *   備考に「6/2入会」と書かれている行は42件中1件だけで、抽出もできない。
 *   → シートに入塾日の列が追加されるまでは、行動計画の手入力値を使う。
 *
 * 「体験」は体験日の列があるので、体験日の月で数えれば一致する（trialsInMonth）。
 */
const AUTO_METRICS: { match: string; kind: 'trialByDate' }[] = [
  { match: '体験', kind: 'trialByDate' },
];

export type GoalView = {
  metric: string;
  target: number | null;
  actual: number | null;
  source: '自動' | 'シート';
};

/**
 * ある月・ある校舎の目標対比を組み立てる。
 * autoTrials（体験日の月で数えた件数）が渡されていれば、体験の指標はその値を使う。
 * それ以外はすべてシートの手入力値。
 */
export function goalsFor(
  goals: GoalRow[],
  month: number,
  campus: string,
  autoTrials?: number,
): GoalView[] {
  return goals
    .filter((g) => g.month === month && sameCampus(g.campus, campus))
    .map((g) => {
      const auto = AUTO_METRICS.find((a) => g.metric.includes(a.match));
      if (auto && autoTrials != null) {
        return { metric: g.metric, target: g.target, actual: autoTrials, source: '自動' as const };
      }
      return { metric: g.metric, target: g.target, actual: g.actual, source: 'シート' as const };
    })
    .filter((v) => v.target != null || v.actual != null);
}

/** 目標に届いていない指標だけを返す（AIに「何が遅れているか」を答えさせるため）。 */
export function behindGoals(views: GoalView[]): GoalView[] {
  return views.filter((v) => v.target != null && v.target > 0 && (v.actual ?? 0) < v.target);
}

/**
 * プロンプト用。月・校舎ごとに1行。
 * trialsByMonth は「月 → 校舎名 → 体験日がその月の件数」。
 */
export function formatGoals(goals: GoalRow[], trialsByMonth: Map<number, Map<string, number>>): string {
  if (!goals.length) return '（目標データがありません）';

  const months = [...new Set(goals.map((g) => g.month))].sort((a, b) => a - b);
  const out: string[] = [];

  for (const m of months) {
    out.push(`■ ${m}月`);
    const campuses = [...new Set(goals.filter((g) => g.month === m).map((g) => g.campus))];
    for (const c of campuses) {
      const trials = trialsByMonth.get(m);
      let auto: number | undefined;
      if (trials) {
        for (const [k, v] of trials) {
          if (sameCampus(k, c)) { auto = v; break; }
        }
      }
      const views = goalsFor(goals, m, c, auto);
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
