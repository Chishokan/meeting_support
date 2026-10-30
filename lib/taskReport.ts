// 重要タスク報告（/task-report）。小中等部の教室担当が毎週、マイルストーンの進み具合と改善・工夫を報告する。
// 報告はスプレッドシート「重要タスク報告」に1件1行で残り、重要タスクのAI評価の材料になる
//（行動計画・議事録・おはよう勉強会の集計から読み取れないことだけを聞く）。
// 画面（components/TaskReportUI.tsx）と API（app/api/task-report）の両方から使う。
//
// ★テストからも読めるよう、ここには import を置かない（型と計算だけ）。
//   校舎の選択肢は数値報告と同じ campusesFor(TASK_REPORT_DEPT)（lib/numberReports.ts）を渡してもらう。
//   保存先は「重要タスク報告」シート（apps_script/Code.gs の saveTaskReport）。

// この報告を出す部門。左メニューにもこの部門の人にだけ出す。
export const TASK_REPORT_DEPT = '小中等部';

export type TaskQuestion = {
  key: 'progress' | 'm1' | 'm2' | 'm3' | 'other';
  no: number;
  label: string;
  required: boolean;
  short: string; // 入力漏れの案内・シートの見出しに使う短い名前
};

// ★設問の文言を変えるときはここだけを直す（シートの見出しは short から作る）。
export const QUESTIONS: TaskQuestion[] = [
  { key: 'progress', no: 1, required: true, short: '進行表の平均（%）',
    label: '中１・中２生の定期テスト対策学習進行表の平均進み具合' },
  { key: 'm1', no: 2, required: true, short: 'マイルストーン1の改善・工夫',
    label: 'マイルストーン1（中1中2テスト対策外部生の集客目標の80%）をクリアするために実行した改善・工夫' },
  { key: 'm2', no: 3, required: true, short: 'マイルストーン2の改善・工夫',
    label: 'マイルストーン2（おはよう勉強会もしくは夜のオンライン学習会への内部生の参加率を70%まで高める）をクリアするために実行した改善・工夫' },
  { key: 'm3', no: 4, required: true, short: 'マイルストーン3の改善・工夫',
    label: 'マイルストーン3（内部生の定期テスト対策学習が、平均で進行表の80%まで進んでいる）をクリアするために実行した改善・工夫' },
  { key: 'other', no: 5, required: false, short: 'そのほかの報告・共有事項',
    label: 'そのほか今週の報告・共有事項' },
];

export type TaskAnswers = Record<TaskQuestion['key'], string>;

export const MAX_TEXT_LENGTH = 2000;

// --- 対象週（土曜はじまり・金曜締め） ------------------------------------------

export type WeekOption = { value: string; label: string };

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function ymd(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function md(t: number): string {
  const d = new Date(t);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAYS[d.getUTCDay()]}）`;
}

function week(end: number, suffix = ''): WeekOption {
  const start = end - 6 * DAY;
  return { value: `${ymd(start)}〜${ymd(end)}`, label: `${md(start)}〜${md(end)}${suffix}` };
}

/**
 * 対象週の選択肢（新しい順）と、最初に選んでおく週。
 * 既定は「直近の金曜日（今日を含む）で終わる週」。報告は金・土・日に前の1週間分を出す前提。
 * 土〜木に開いたときは、途中の今週も選べるように先頭に足す。
 */
export function weekOptions(now: Date = new Date()): { options: WeekOption[]; defaultValue: string } {
  // 端末・サーバのタイムゾーンに関わらず、日本時間の日付で数える。
  const today = Date.parse(`${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now)}T00:00:00Z`);
  const back = (new Date(today).getUTCDay() - 5 + 7) % 7; // 直近の金曜日まで何日戻るか
  const end = today - back * DAY;
  const options = [week(end), week(end - 7 * DAY), week(end - 14 * DAY)];
  if (back > 0) options.unshift(week(end + 7 * DAY, '（途中）'));
  return { options, defaultValue: week(end).value };
}

/** "2026-10-24〜2026-10-30" のように、土曜はじまりで7日間の週か。 */
export function isValidWeek(v: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})〜(\d{4}-\d{2}-\d{2})$/.exec(v);
  if (!m) return false;
  const start = Date.parse(`${m[1]}T00:00:00Z`);
  const end = Date.parse(`${m[2]}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return ymd(start) === m[1] && new Date(start).getUTCDay() === 6 && end - start === 6 * DAY;
}

// --- 入力のチェック ------------------------------------------------------------

export type TaskReport = { week: string; school: string; answers: TaskAnswers };

/** 送られてきた本文を整える。足りない項目があれば、その設問番号を返す。schools は選べる校舎。 */
export function cleanReport(body: unknown, schools: string[]):
  | { ok: true; report: TaskReport }
  | { ok: false; reason: 'bad_week' | 'bad_school' | 'bad_progress' | 'missing'; missing?: number[] } {
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const week = String(o.week ?? '').trim();
  if (!isValidWeek(week)) return { ok: false, reason: 'bad_week' };
  const school = String(o.school ?? '').trim();
  if (!schools.includes(school)) return { ok: false, reason: 'bad_school' };

  const raw = (o.answers && typeof o.answers === 'object' ? o.answers : {}) as Record<string, unknown>;
  const answers = {} as TaskAnswers;
  for (const q of QUESTIONS) answers[q.key] = String(raw[q.key] ?? '').trim().slice(0, MAX_TEXT_LENGTH);

  const missing = QUESTIONS.filter((q) => q.required && !answers[q.key]).map((q) => q.no);
  if (missing.length) return { ok: false, reason: 'missing', missing };

  const pct = Number(answers.progress);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, reason: 'bad_progress' };
  answers.progress = String(Math.round(pct * 10) / 10);

  return { ok: true, report: { week, school, answers } };
}

// スプレッドシートの見出しと1行分（日時・部門・記入者は Apps Script 側で先頭に足す）。
export const SHEET_HEADERS = ['対象週', '校舎', ...QUESTIONS.map((q) => `${q.no} ${q.short}`)];

export function reportRow(r: TaskReport): string[] {
  return [r.week, r.school, ...QUESTIONS.map((q) => r.answers[q.key])];
}
