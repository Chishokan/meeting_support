// 智翔館AI：コンテキスト欄（画面の右の欄に、職員が会話の前提として置く文）。画面と API の両方で使う決まり。ほかに依存しない。
//
// - 置いた項目は、質問のたびに全部 AI に渡す（会話の前提になる）。1つの会話につき PIN_MAX_ITEMS 個まで。
// - 職員は欄の中で直接書き換えられる。AI は頼まれたときだけ、propose_context_edit で「直し案」を出す。
//   案は画面に出すだけで、職員が「置き換える」（新しい項目なら「追加する」）を押したときに初めて変わる。
// - 書き換えるたびに前の版を残す（PIN_MAX_HISTORY 個まで）。前の版に戻すときも、戻す前の文を版に残す（消えない）。
// - 追加・置き換え・前の版に戻したことは、会話ログに1行残す（名前・字数・はじめの200字）。全文は質問のたびには記録しない。

export type PinnedBy = 'added' | 'self' | 'ai' | 'restore';

export type PinnedVersion = { text: string; name: string; at: string; by: PinnedBy };

export type Pinned = {
  /** 会話の中の番号（c1, c2 …）。AI はこの番号で項目を指す */
  id: string;
  name: string;
  text: string;
  /** いまの文を誰が作ったか */
  by: PinnedBy;
  at: string;
  /** 前の版（古いものが先・新しいものが後ろ） */
  history: PinnedVersion[];
};

/** API に送る形（版の履歴は送らない）。 */
export type PinnedForApi = { id: string; name: string; text: string };

export type PinProposal = { id: string; name: string; text: string; summary: string };

export const PIN_MAX_ITEMS = 10;
export const PIN_MAX_NAME = 40;
export const PIN_MAX_TEXT = 10_000;
/** 全部の項目の合計（毎回 AI に渡すので、費用と回答の速さのために抑える）。 */
export const PIN_TOTAL_CHARS = 30_000;
export const PIN_MAX_HISTORY = 5;
/** 1回の回答で出せる直し案の数。 */
export const PIN_MAX_PROPOSALS = 3;

/** その文がどうやってできたか（版の一覧に出す）。 */
export const PIN_BY_LABEL: Record<PinnedBy, string> = {
  added: '追加した文',
  self: '本人が書き換えた文',
  ai: 'AIの案で置き換えた文',
  restore: '前の版に戻した文',
};
const BY_VALUES = Object.keys(PIN_BY_LABEL) as PinnedBy[];

const ID_RE = /^c\d{1,3}$/;

function clean(s: unknown, n: number): string {
  return typeof s === 'string' ? s.replace(/\r\n?/g, '\n').trim().slice(0, n) : '';
}

/** 画面から届いた項目を確かめる（形の違うもの・多すぎる分・長すぎる分は落とす）。 */
export function normalizePinnedForApi(raw: unknown): PinnedForApi[] {
  if (!Array.isArray(raw)) return [];
  const out: PinnedForApi[] = [];
  let total = 0;
  for (const x of raw) {
    if (out.length >= PIN_MAX_ITEMS) break;
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === 'string' && ID_RE.test(o.id) ? o.id : '';
    const name = clean(o.name, PIN_MAX_NAME);
    const text = clean(o.text, PIN_MAX_TEXT);
    if (!id || !text || out.some((p) => p.id === id)) continue;
    if (total + text.length > PIN_TOTAL_CHARS) break;
    total += text.length;
    out.push({ id, name: name || id, text });
  }
  return out;
}

/** 書き出したファイル・保存した会話から読んだ項目を確かめる（版の履歴も含む）。 */
export function normalizePinnedList(raw: unknown): Pinned[] {
  if (!Array.isArray(raw)) return [];
  const at = (v: unknown) => (typeof v === 'string' && v.length <= 40 ? v : '');
  const by = (v: unknown): PinnedBy => (BY_VALUES.includes(v as PinnedBy) ? (v as PinnedBy) : 'added');
  const out: Pinned[] = [];
  let total = 0;
  for (const x of raw) {
    if (out.length >= PIN_MAX_ITEMS) break;
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === 'string' && ID_RE.test(o.id) ? o.id : '';
    const text = clean(o.text, PIN_MAX_TEXT);
    if (!id || !text || out.some((p) => p.id === id) || total + text.length > PIN_TOTAL_CHARS) continue;
    total += text.length;
    const history = (Array.isArray(o.history) ? o.history : [])
      .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string')
      .map((v) => ({ text: clean(v.text, PIN_MAX_TEXT), name: clean(v.name, PIN_MAX_NAME) || id, at: at(v.at), by: by(v.by) }))
      .filter((v) => v.text)
      .slice(-PIN_MAX_HISTORY);
    out.push({ id, name: clean(o.name, PIN_MAX_NAME) || id, text, by: by(o.by), at: at(o.at), history });
  }
  return out;
}

/** AI に渡す文。項目が無ければ空。 */
export function buildPinnedBlock(items: PinnedForApi[]): string {
  if (!items.length) return '';
  const body = items.map((p) => `■ ${p.id}「${p.name}」\n${p.text}`).join('\n\n');
  return (
    '【コンテキスト（職員が画面の右の欄に置いた、この会話の前提。質問のたびにアプリが渡している）】\n' +
    '職員が自分で置いた前提なので、回答はこれに沿う。ただし社内の事実（日付・料金・方針）が資料と食い違うときは資料を優先し、食い違いを伝える。\n' +
    '直すように頼まれたときだけ propose_context_edit で直し案を出す（頼まれずに変えない）。\n\n' +
    body
  );
}

/** AI の直し案の道具。案は画面に出すだけで、職員が押したときに変わる。 */
export const PROPOSE_CONTEXT_TOOL = {
  name: 'propose_context_edit',
  description:
    '画面の右の「コンテキスト」欄の項目を直す案、または新しい項目を足す案を、職員に見せる。' +
    '職員が「置き換える」（新しい項目は「追加する」）を押したときだけ変わる（この道具では、まだ変わらない）。' +
    '職員に「コンテキストを直して」「コンテキストに入れて」などと頼まれたときだけ使う。頼まれずに使わない。',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '直す項目の番号（例 c2）。新しい項目を足すときは空の文字にする' },
      name: { type: 'string', description: `項目の名前（${PIN_MAX_NAME}字まで）。直すときは今の名前のままでよい` },
      text: { type: 'string', description: `直したあとの全文（変える所だけでなく、項目の全部を書く。${PIN_MAX_TEXT}字まで）` },
      summary: { type: 'string', description: '何をどう変えたか（1〜2文）' },
    },
    required: ['id', 'name', 'text', 'summary'],
  },
} as const;

/** 直し案を確かめる。おかしければ、AI に返す理由。 */
export function checkProposal(
  raw: unknown,
  items: PinnedForApi[],
): { ok: true; proposal: PinProposal } | { ok: false; message: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = clean(o.id, 10);
  const text = typeof o.text === 'string' ? o.text.replace(/\r\n?/g, '\n').trim() : '';
  const summary = clean(o.summary, 300);
  const list = items.length ? items.map((p) => `${p.id}「${p.name}」`).join('、') : 'なし';
  if (!text) return { ok: false, message: '直したあとの全文（text）がありません。項目の全部を書いてください。' };
  if (text.length > PIN_MAX_TEXT) {
    return { ok: false, message: `項目は${PIN_MAX_TEXT}字までです（今は${text.length}字）。要点にしぼって書き直してください。` };
  }
  if (id) {
    const cur = items.find((p) => p.id === id);
    if (!cur) return { ok: false, message: `${id} という項目はありません。ある項目：${list}。新しく足すときは id を空にします。` };
    if (cur.text === text) return { ok: false, message: `${id} は今の文と同じです。変える所を直した全文を書いてください。` };
    return { ok: true, proposal: { id, name: clean(o.name, PIN_MAX_NAME) || cur.name, text, summary } };
  }
  if (items.length >= PIN_MAX_ITEMS) {
    return { ok: false, message: `コンテキストは${PIN_MAX_ITEMS}個までで、もう一杯です。職員に、要らない項目を消すか、今ある項目（${list}）に入れるかを聞いてください。` };
  }
  const name = clean(o.name, PIN_MAX_NAME);
  if (!name) return { ok: false, message: '新しい項目の名前（name）を付けてください。' };
  return { ok: true, proposal: { id: '', name, text, summary } };
}

/** 道具の結果として AI に返す文。 */
export function proposalToolResult(p: PinProposal): string {
  return (
    `${p.id ? `${p.id}「${p.name}」の直し案` : `新しい項目「${p.name}」の案`}を、画面の右の欄に出しました。` +
    `職員が「${p.id ? '置き換える' : '追加する'}」を押すまで、コンテキストは変わりません。` +
    '回答には、何をどう変えたかを短く書き、右の欄で見比べて押すよう伝える。案の全文を回答にもう一度書かない。'
  );
}

// --- 画面で使うもの ----------------------------------------------------------

export function pinnedTotal(items: { text: string }[]): number {
  return items.reduce((n, p) => n + p.text.length, 0);
}

/** 次の番号（c1, c2 …）。消した番号は使い回さない。 */
export function nextPinId(items: { id: string }[], used = 0): { id: string; used: number } {
  const max = Math.max(used, ...items.map((p) => Number(p.id.slice(1)) || 0));
  return { id: `c${max + 1}`, used: max + 1 };
}

/** 新しい項目。 */
export function newPinned(id: string, name: string, text: string, by: PinnedBy, at: string): Pinned {
  return { id, name: name.trim().slice(0, PIN_MAX_NAME) || id, text: text.replace(/\r\n?/g, '\n').trim(), by, at, history: [] };
}

/** 文を入れ替える（前の文を版に残す。同じ文なら名前だけ変える）。 */
export function replacePinned(p: Pinned, name: string, text: string, by: PinnedBy, at: string): Pinned {
  const t = text.replace(/\r\n?/g, '\n').trim();
  const n = name.trim().slice(0, PIN_MAX_NAME) || p.name;
  if (t === p.text) return { ...p, name: n };
  const history = [...p.history, { text: p.text, name: p.name, at: p.at, by: p.by }].slice(-PIN_MAX_HISTORY);
  return { ...p, name: n, text: t, by, at, history };
}

/** index 番目の前の版に戻す（戻す前の文は版に残す）。 */
export function restorePinned(p: Pinned, index: number, at: string): Pinned {
  const v = p.history[index];
  if (!v) return p;
  const rest = p.history.filter((_, i) => i !== index);
  const history = [...rest, { text: p.text, name: p.name, at: p.at, by: p.by }].slice(-PIN_MAX_HISTORY);
  return { ...p, name: v.name, text: v.text, by: 'restore', at, history };
}

/** 回答などから項目の名前の候補を作る（最初の見出しか、最初の行）。 */
export function guessPinName(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const head = lines.find((l) => /^#{1,4}\s/.test(l)) ?? lines[0] ?? '';
  return head.replace(/^#{1,4}\s+/, '').replace(/[*_`>|]/g, '').replace(/^[-・\d.)）\s]+/, '').trim().slice(0, PIN_MAX_NAME) || 'メモ';
}

// --- 会話ログ ----------------------------------------------------------------

export const PIN_LOG_ACTIONS = ['追加', '置き換え（AIの案）', '書き換え（本人）', '前の版に戻す', '削除'] as const;
export type PinLogAction = (typeof PIN_LOG_ACTIONS)[number];

/** 会話ログに残す1行（input と output）。 */
export function pinLogEntry(o: { conversationId: string; action: PinLogAction; id: string; name: string; text: string }): { input: string; output: string } {
  const convo = o.conversationId ? `（会話: ${o.conversationId}）` : '';
  const head = o.text.length > 200 ? `${o.text.slice(0, 200)}…` : o.text;
  return {
    input: `[智翔館AI・コンテキスト]${convo} ${o.action}：${o.id}「${o.name}」（${o.text.length}字）`,
    output: o.action === '削除' ? '' : head,
  };
}

/** 画面から届いたログの中身を確かめる。 */
export function checkPinLog(raw: unknown): { conversationId: string; action: PinLogAction; id: string; name: string; text: string } | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const action = (PIN_LOG_ACTIONS as readonly string[]).includes(String(o.action)) ? (o.action as PinLogAction) : null;
  const id = typeof o.id === 'string' && ID_RE.test(o.id) ? o.id : '';
  if (!action || !id) return null;
  const conversationId = typeof o.conversationId === 'string' && /^[\w-]{4,40}$/.test(o.conversationId) ? o.conversationId : '';
  return { conversationId, action, id, name: clean(o.name, PIN_MAX_NAME), text: clean(o.text, PIN_MAX_TEXT) };
}
