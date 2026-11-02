// AI壁打ち（/task-coach）。重要タスク評価シートの校舎タブを読み、項目ごとに Claude と行動計画を相談する。
// 相談の結果は「行動計画の案」（日付・区分・行動）にまとめ、秋～冬行動計画への書き込みと Word ファイルにできる。
//
// ★テストからも読めるよう、ここには import を置かない（型と計算だけ）。
//   評価シートの読み込み・行動計画への書き込みは lib/taskCoachStore.ts（Apps Script 経由）。
//   プロンプトは lib/taskCoachPrompt.ts。

// この画面を使う部門。左メニューにもこの部門の人にだけ出す。
export const COACH_DEPT = '小中等部';

// 評価シートのタブ名＝秋～冬行動計画の校舎の行の名前。★校舎の増減はここを直す。
export const COACH_SCHOOLS = ['日野校', '駅前校', '大野校', '日宇校'];

// 秋～冬行動計画の「区分」の列（校舎ごとに3行）。
export const PLAN_KINDS = ['外部', '内部', '他'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const MAX_TURNS = 40;          // 送る履歴の上限（往復×2）
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_ACTIONS = 20;
export const MAX_ACTION_LENGTH = 120;

// --- 評価シートの読み取り -------------------------------------------------------

export type ProgressRow = { name: string; base: string; target: string; actual: string; rate: string; source: string };
export type ActionRow = {
  name: string; level: number; points: string; levelName: string;
  sources: string; evidence: string; advice: string;
};
export type TaskEvaluation = {
  title: string; period: string; reporter: string; note: string;
  total: string; progressPoint: string; actionPoint: string;
  progress: ProgressRow[]; actions: ActionRow[]; good: string[]; issues: string[];
};

const cell = (rows: string[][], r: number, c: number) => String(rows[r]?.[c] ?? '').trim();
const bullet = (s: string) => s.replace(/^[・\s]+/, '');

/**
 * 評価シートの校舎タブ（A1:G32 の表示値）を読む。行の位置ではなく見出しの文字で探すので、
 * 行を足したり減らしたりしても読める。行動の行が1つも無ければ null。
 */
export function parseEvaluation(rows: string[][]): TaskEvaluation | null {
  const ev: TaskEvaluation = {
    title: cell(rows, 0, 0), period: '', reporter: '', note: '', total: '', progressPoint: '', actionPoint: '',
    progress: [], actions: [], good: [], issues: [],
  };
  let section: '' | 'progress' | 'actions' | 'good' | 'issues' = '';
  for (let r = 1; r < rows.length; r++) {
    const a = cell(rows, r, 0);
    const b = cell(rows, r, 1);
    if (a === '報告者' || a === '責任者') { ev.reporter = b; ev.period = cell(rows, r, 3); continue; }
    if (a.startsWith('合計点')) { ev.total = b; ev.note = cell(rows, r + 1, 0); continue; }
    if (a === '指標' && b === '母数') { section = 'progress'; continue; }
    if (a === '指標' && b === '段階') { section = 'actions'; continue; }
    if (a.startsWith('進捗点')) { ev.progressPoint = cell(rows, r, 4); section = ''; continue; }
    if (a.startsWith('行動点')) { ev.actionPoint = cell(rows, r, 2); section = ''; continue; }
    if (a === '良い動き') { section = 'good'; continue; }
    if (a === '課題') { section = 'issues'; continue; }
    if (!a) continue;
    if (section === 'progress') {
      ev.progress.push({ name: a, base: b, target: cell(rows, r, 2), actual: cell(rows, r, 3), rate: cell(rows, r, 4), source: cell(rows, r, 5) });
    } else if (section === 'actions') {
      const level = Number(b);
      if (!Number.isInteger(level)) continue;
      ev.actions.push({
        name: a, level, points: cell(rows, r, 2), levelName: cell(rows, r, 3),
        sources: cell(rows, r, 4), evidence: cell(rows, r, 5), advice: cell(rows, r, 6),
      });
    } else if (section === 'good') {
      ev.good.push(bullet(a));
    } else if (section === 'issues') {
      ev.issues.push(bullet(a));
    }
  }
  return ev.actions.length ? ev : null;
}

/** 項目の選択肢。'all'＝全体、'0'〜'5'＝行動の項目（評価シートの並び順）。 */
export function itemOptions(ev: TaskEvaluation | null): { key: string; label: string }[] {
  return [{ key: 'all', label: '全体' }, ...(ev?.actions ?? []).map((a, i) => ({ key: String(i), label: a.name }))];
}

export function isValidItem(ev: TaskEvaluation, key: string): boolean {
  return key === 'all' || (/^\d+$/.test(key) && Number(key) < ev.actions.length);
}

/** プロンプトに入れる評価の本文。相談する項目を先頭に詳しく置き、ほかの項目も根拠まで添える。 */
export function evaluationText(ev: TaskEvaluation, key: string): string {
  const lines: string[] = [];
  lines.push(`${ev.title}（評価期間：${ev.period}）`);
  lines.push(`合計 ${ev.total}点（進捗 ${ev.progressPoint}点・行動 ${ev.actionPoint}点）`);
  lines.push('', '◆進捗');
  for (const p of ev.progress) {
    lines.push(`・${p.name}：母数 ${p.base}／基準 ${p.target}／実績 ${p.actual}／達成率 ${p.rate}（出所：${p.source}）`);
  }
  const focus = key === 'all' ? -1 : Number(key);
  const describe = (a: ActionRow) =>
    `${a.name}：段階${a.level}（${a.levelName}）\n  根拠：${a.evidence}\n  アドバイス：${a.advice}`;
  if (focus >= 0 && ev.actions[focus]) {
    lines.push('', '◆相談したい項目', describe(ev.actions[focus]));
  }
  lines.push('', focus >= 0 ? '◆ほかの項目' : '◆行動の段階');
  ev.actions.forEach((a, i) => { if (i !== focus) lines.push(describe(a)); });
  if (ev.good.length) lines.push('', '◆良い動き', ...ev.good.map((g) => `・${g}`));
  if (ev.issues.length) lines.push('', '◆課題', ...ev.issues.map((g) => `・${g}`));
  return lines.join('\n');
}

// --- 行動計画に書ける日付 ---------------------------------------------------------

export type DateOption = { value: string; label: string };
const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 行動計画に書ける日付（今日から2週間・日曜を除く）。秋～冬行動計画の「月日」の行と同じ「11/4」の形。
 * 日付は日本時間で数える。
 */
export function planDates(now: Date = new Date()): DateOption[] {
  const today = Date.parse(`${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now)}T00:00:00Z`);
  const out: DateOption[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today + i * DAY);
    if (d.getUTCDay() === 0) continue;
    const value = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    out.push({ value, label: `${value}（${WEEKDAYS[d.getUTCDay()]}）` });
  }
  return out;
}

// --- 行動計画の案 ---------------------------------------------------------------

export type PlanAction = { date: string; kind: PlanKind; text: string };
export type CoachPlan = { goal: string; summary: string; actions: PlanAction[] };

const str = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * AI が返した案（または画面で直した案）を整える。
 * requireDate=false のときは、書ける日付に無い日付を空にして返す（画面で選び直してもらう）。
 * requireDate=true のとき（書き込み・ファイル作成）は、日付が無い行が1つでもあれば通さない。
 */
export function cleanPlan(raw: unknown, dates: string[], requireDate: boolean):
  | { ok: true; plan: CoachPlan }
  | { ok: false; reason: 'bad_plan' | 'no_actions' | 'bad_date' } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'bad_plan' };
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.actions) ? o.actions : [];
  const actions: PlanAction[] = [];
  for (const item of list.slice(0, MAX_ACTIONS)) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    const text = str(a.text, MAX_ACTION_LENGTH).replace(/^[★☆・\s]+/, '');
    if (!text) continue;
    const kind = PLAN_KINDS.find((k) => k === str(a.kind, 4)) ?? '他';
    const given = str(a.date, 10).replace(/^0/, '').replace(/\/0/, '/'); // 「11/04」も「11/4」として読む
    const date = dates.includes(given) ? given : '';
    if (requireDate && !date) return { ok: false, reason: 'bad_date' };
    actions.push({ date, kind, text });
  }
  if (!actions.length) return { ok: false, reason: 'no_actions' };
  return { ok: true, plan: { goal: str(o.goal, 200), summary: str(o.summary, 400), actions } };
}

/** AI の返事から JSON を取り出す（前後に文章や ``` が付いていても読む）。読めなければ null。 */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 送られてきた会話を整える（役割が交互でない・空・長すぎるものを落とし、直近だけ残す）。 */
export function cleanHistory(raw: unknown): { role: 'user' | 'assistant'; content: string }[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const o = m as Record<string, unknown>;
    const role = o.role === 'assistant' ? 'assistant' : o.role === 'user' ? 'user' : null;
    const content = String(o.content ?? '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!role || !content) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += `\n${content}`;
    else out.push({ role, content });
  }
  const recent = out.slice(-MAX_TURNS);
  while (recent.length && recent[0].role !== 'user') recent.shift();
  return recent;
}
