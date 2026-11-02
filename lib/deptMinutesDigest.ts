// 部門会議の議事録を「社長送付用の1枚まとめ」にする部品（AI を呼ばない純粋な部分）。
//
// 流れ（README「議事録の社長への自動送付」）：
//   1. 議事録が保存される（「部門会議議事録」シートに1行）
//   2. Apps Script（apps_script/MinutesNotify.gs）が10分ごとにシートを見て、まだ送っていない議事録を
//      /api/dept-minutes/digest に送る
//   3. API が AI（lib/deptMinutesDigestAi.ts）で要点を DigestBody にまとめ、
//      PDF（lib/deptMinutesDigestPdf.ts）とトーク用の文（buildMessage）を返す
//   4. Apps Script が LINE WORKS Bot で社長へ送り、シートに送付日時を書く
//
// ここは AI の出力の整形・検査と、文面・ファイル名づくりだけ。テスト: lib/deptMinutesDigest.test.ts
// ★AI への指示（項目の意味）は lib/deptMinutesDigestAi.ts。項目を増やすときは両方と PDF を直す。

/** Apps Script から届く議事録1件（「部門会議議事録」シートの1行）。 */
export type DigestInput = {
  id: string;
  ts: string; // 登録日時（ISO）
  campus: string; // 部門
  user: string; // 入力者
  title: string;
  date: string; // 開催日時（入力されたまま。'2026/10/28' '2026/10/21 0:00' '10/20(火) 15時～' など）
  place: string;
  attendees: string;
  agenda: string;
  minutes: string;
  quality: string;
  editedAt: string;
  editedBy: string;
  revised: boolean; // 送付済みの議事録を直したので送り直す（修正版）
};

export type DigestDecision = { title: string; detail: string; owner: string; due: string };
export type TodoStatus = '' | 'done' | 'not_done';
export type DigestTodo = { task: string; owner: string; due: string; status: TodoStatus };

/** AI がまとめる部分。 */
export type DigestBody = {
  purpose: string;
  summary: string;
  decisions: DigestDecision[];
  todos: DigestTodo[];
  pending: string[];
  reports: string[];
  next: string;
  checks: string[];
};

/** PDF に載せる1件分（会議情報は AI を通さずシートの値をそのまま使う）。 */
export type Digest = DigestBody & {
  id: string;
  dept: string;
  title: string;
  date: string;
  place: string;
  attendees: string;
  recorder: string;
  revised: boolean;
  createdAt: string; // 'YYYY/MM/DD HH:mm'（JST）
};

/** 不明・未定の印。PDF とトークでは目立つ色で出す。 */
export const UNKNOWN = '【要確認】';

// AI の出しすぎで PDF が何枚にもならないための上限（議事録の項目を落とさない程度に大きめ）。
export const LIMITS = {
  summary: 260,
  purpose: 120,
  item: 200,
  short: 60,
  decisions: 15,
  todos: 20,
  pending: 8,
  reports: 8,
  checks: 4,
} as const;

function str(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function list(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems);
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const DONE = new Set(['done', '済', '〇', '○', '完了']);
const NOT_DONE = new Set(['not_done', '未', '✕', '×', '未完了']);

function status(v: unknown): TodoStatus {
  const s = typeof v === 'string' ? v.trim() : '';
  if (DONE.has(s)) return 'done';
  if (NOT_DONE.has(s)) return 'not_done';
  return '';
}

/**
 * AI のツール入力を DigestBody に整える。形が崩れていても落ちないようにし、
 * 要約も決定事項も ToDo も無いときだけ null（＝まとめに失敗）にする。
 */
export function normalizeDigest(raw: unknown): DigestBody | null {
  const o = obj(raw);
  const decisions = (Array.isArray(o.decisions) ? o.decisions : [])
    .map((d) => {
      const x = obj(d);
      return {
        title: str(x.title, LIMITS.short),
        detail: str(x.detail, LIMITS.item),
        owner: str(x.owner, LIMITS.short),
        due: str(x.due, LIMITS.short),
      };
    })
    .filter((d) => d.title || d.detail)
    .slice(0, LIMITS.decisions);
  const todos = (Array.isArray(o.todos) ? o.todos : [])
    .map((t) => {
      const x = obj(t);
      return {
        task: str(x.task, LIMITS.item),
        owner: str(x.owner, LIMITS.short),
        due: str(x.due, LIMITS.short),
        status: status(x.status),
      };
    })
    .filter((t) => t.task)
    .slice(0, LIMITS.todos);
  const body: DigestBody = {
    purpose: str(o.purpose, LIMITS.purpose),
    summary: str(o.summary, LIMITS.summary),
    decisions,
    todos,
    pending: list(o.pending, LIMITS.pending, LIMITS.item),
    reports: list(o.reports, LIMITS.reports, LIMITS.item),
    next: str(o.next, LIMITS.item),
    checks: list(o.checks, LIMITS.checks, LIMITS.item),
  };
  if (!body.summary && !body.decisions.length && !body.todos.length) return null;
  return body;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 開催日時を「2026/10/28（水）」「2026/10/21（水）11:00」の形にそろえる。
 * 年・月・日が読めないもの（'10/20(火) 毎週火曜日15時～' など）は入力のまま返す。
 * 「0:00」は時刻未入力の印（日付だけ選ぶと付く）なので落とす。
 */
export function formatMeetingDate(date: string): string {
  const s = String(date || '').trim();
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (!m) return s;
  const [, y, mo, d, hh, mm] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(dt.getTime()) || dt.getUTCDate() !== Number(d)) return s;
  const day = `${y}/${mo.padStart(2, '0')}/${d.padStart(2, '0')}（${WEEKDAYS[dt.getUTCDay()]}）`;
  const time = hh !== undefined && !(Number(hh) === 0 && mm === '00') ? `${Number(hh)}:${mm}` : '';
  return day + time;
}

/** 'YYYY/MM/DD HH:mm'（日本時間）。 */
export function jstStamp(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${j.getUTCFullYear()}/${p(j.getUTCMonth() + 1)}/${p(j.getUTCDate())} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}

/** 記録者の欄。直した人がいれば「（10/28 冨田翔太 修正）」を添える。 */
export function recorderLabel(input: Pick<DigestInput, 'user' | 'editedAt' | 'editedBy'>): string {
  const user = input.user.trim() || UNKNOWN;
  const by = input.editedBy.trim();
  if (!by) return user;
  const at = Date.parse(input.editedAt);
  const md = Number.isNaN(at) ? '' : jstStamp(new Date(at)).slice(5, 10).replace(/^0/, '').replace('/0', '/') + ' ';
  return by === user ? `${user}（${md}修正）` : `${user}（${md}${by} 修正）`;
}

export function toDigest(input: DigestInput, body: DigestBody, now: Date): Digest {
  return {
    ...body,
    id: input.id,
    dept: input.campus.trim() || '部門未設定',
    title: input.title.trim() || '（会議名なし）',
    date: formatMeetingDate(input.date) || UNKNOWN,
    place: input.place.trim() || '未記入',
    attendees: input.attendees.trim() || '未記入',
    recorder: recorderLabel(input),
    revised: input.revised,
    createdAt: jstStamp(now),
  };
}

/** ファイル名に使えない文字を落とす（LINE WORKS・Windows の両方で開けるように）。 */
function safe(s: string): string {
  return s.replace(/[\\/:*?"<>|\r\n\t]/g, '').replace(/\s+/g, '').slice(0, 40);
}

/** '議事録_20261028_中高連携会議.pdf'。開催日が読めなければ登録日を使う。修正版は '_修正版' を付ける。 */
export function pdfFileName(input: Pick<DigestInput, 'date' | 'ts' | 'title' | 'revised'>): string {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(String(input.date || '').trim());
  let ymd = m ? `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}` : '';
  if (!ymd) {
    const t = Date.parse(input.ts);
    ymd = Number.isNaN(t) ? '' : jstStamp(new Date(t)).slice(0, 10).replace(/\//g, '');
  }
  const parts = ['議事録', ymd, safe(input.title) || '部門会議'].filter(Boolean);
  return parts.join('_') + (input.revised ? '_修正版' : '') + '.pdf';
}

/** LINE WORKS のテキストは 2,000 字まで。余裕を見てこの長さで切る。 */
export const MESSAGE_MAX = 1800;

/** 社長へのトークの本文。PDF を開かなくても要点だけ分かるように。 */
export function buildMessage(d: Digest): string {
  const head = [
    `${d.revised ? '【議事録・修正版】' : '【議事録】'}${d.title}`,
    `${d.date}／${d.place}／${d.dept}（記録：${d.recorder}）`,
  ];
  const parts: string[] = [head.join('\n')];
  if (d.summary) parts.push(`■概要\n${d.summary}`);
  if (d.decisions.length) {
    parts.push(
      `■決定事項（${d.decisions.length}件）\n` +
        d.decisions.map((x, i) => `${i + 1}. ${x.title || x.detail}`).join('\n'),
    );
  }
  if (d.checks.length) parts.push(`■要確認\n` + d.checks.map((c) => `・${c}`).join('\n'));
  // Apps Script は PDF を先に送り、続けてこの本文を送る（PDF が送れなかったときに本文だけ届かないように）。
  const tail = d.revised
    ? '送付済みの議事録が直されたため、修正版をお送りします。詳しくはPDFをご覧ください。'
    : '詳しくはPDFをご覧ください。';
  let text = parts.join('\n\n') + '\n\n' + tail;
  if (text.length > MESSAGE_MAX) {
    // 長すぎるときは決定事項の一覧を件数だけにする（PDF には全部載っている）。
    const short = parts.map((p) => (p.startsWith('■決定事項') ? `■決定事項 ${d.decisions.length}件（PDF参照）` : p));
    text = short.join('\n\n') + '\n\n' + tail;
    if (text.length > MESSAGE_MAX) text = text.slice(0, MESSAGE_MAX - 1) + '…';
  }
  return text;
}

/** Apps Script から届いた本文を DigestInput にする。必須（議事録本文）が無ければ null。 */
export function parseInput(raw: unknown): DigestInput | null {
  const o = obj(raw);
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : o[k] == null ? '' : String(o[k]));
  const input: DigestInput = {
    id: s('id'),
    ts: s('ts'),
    campus: s('campus'),
    user: s('user'),
    title: s('title'),
    date: s('date'),
    place: s('place'),
    attendees: s('attendees'),
    agenda: s('agenda'),
    minutes: s('minutes'),
    quality: s('quality'),
    editedAt: s('editedAt'),
    editedBy: s('editedBy'),
    revised: o.revised === true,
  };
  return input.minutes.trim() ? input : null;
}
