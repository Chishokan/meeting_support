// 智翔館AI：会話の保存（履歴・保存した会話）と、いつものコンテキストの決まり。ほかに依存しない（型だけ使う）。
//
// 持ち主は、ログインで確かめたメールアドレス（lib/core/auth.ts の verifiedEmail）。確かめられない間は使えない。
// - 履歴：質問のたびに自動で保存。最後に使ってから HISTORY_DAYS 日・HISTORY_MAX 件まで（超えたら古いものから消える）
// - 保存した会話：「この会話を保存」で名前を付けて残す。最後に使ってから SAVED_DAYS 日・SAVED_MAX 件まで（超えるときは保存できない）
// - いつものコンテキスト：会話をまたいで使う前提。1人 PRESET_MAX 個まで。「新しい会話に入れる」にしたものは、新しい会話に自動で入る
// - 職員一覧から外れた人の分は、REMOVED_DAYS 日後に消す
// 置き場所は Supabase（supabase/migrations/0004_chishokan_ai.sql）。読み書きは lib/chishokanAi/savedStore.ts。

export const HISTORY_MAX = 50;
export const HISTORY_DAYS = 30;
export const SAVED_MAX = 20;
export const SAVED_DAYS = 365;
export const PRESET_MAX = 10;
export const REMOVED_DAYS = 30;
/** 1つの会話の大きさの上限（書き出す形の JSON の文字数）。超えたら、要点をまとめて新しい会話で続けてもらう。 */
export const CONVO_MAX_CHARS = 1_500_000;
export const TITLE_MAX = 60;

export type ConvoKind = '履歴' | '保存';

export type ConvoRow = {
  id: string;
  kind: ConvoKind;
  title: string;
  turns: number;
  chars: number;
  createdAt: string;
  updatedAt: string;
};

export type Preset = { id: string; name: string; text: string; auto: boolean; sortOrder: number; updatedAt: string };

const DAY = 86_400_000;

export function isConvoId(v: unknown): v is string {
  return typeof v === 'string' && /^[\w-]{4,40}$/.test(v);
}

export function isPresetId(v: unknown): v is string {
  return typeof v === 'string' && /^p\d{1,3}$/.test(v);
}

/** 残す期間の起点（これより前に最後に使ったものは消す）。 */
export function cutoff(kind: ConvoKind, now: Date): Date {
  return new Date(now.getTime() - (kind === '保存' ? SAVED_DAYS : HISTORY_DAYS) * DAY);
}

/** 消す会話の番号（期限切れと、履歴の件数の上限を超えた古いもの）。 */
export function idsToPurge(rows: ConvoRow[], now: Date): string[] {
  const out: string[] = [];
  const keep: ConvoRow[] = [];
  for (const r of rows) {
    const t = new Date(r.updatedAt).getTime();
    if (!Number.isNaN(t) && t < cutoff(r.kind, now).getTime()) out.push(r.id);
    else keep.push(r);
  }
  const history = keep.filter((r) => r.kind === '履歴').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const r of history.slice(HISTORY_MAX)) out.push(r.id);
  return out;
}

/** 「この会話を保存」できるか。 */
export function checkSave(rows: ConvoRow[], id: string): { ok: true } | { ok: false; message: string } {
  if (!rows.some((r) => r.id === id)) return { ok: false, message: 'この会話はまだ保存されていません。質問を1つ送ってから、もう一度押してください。' };
  const saved = rows.filter((r) => r.kind === '保存' && r.id !== id).length;
  if (saved >= SAVED_MAX) return { ok: false, message: `保存できる会話は${SAVED_MAX}件までです。要らない会話を消してから保存してください。` };
  return { ok: true };
}

export function cleanTitle(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : '';
}

/** 一覧を新しい順に、履歴と保存に分ける。 */
export function splitRows(rows: ConvoRow[]): { history: ConvoRow[]; saved: ConvoRow[] } {
  const sorted = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { history: sorted.filter((r) => r.kind === '履歴'), saved: sorted.filter((r) => r.kind === '保存') };
}

/** いつものコンテキストの入力を確かめる。id が無ければ新しい番号を付ける。 */
export function checkPreset(
  raw: unknown,
  existing: Preset[],
  limits: { maxName: number; maxText: number },
): { ok: true; preset: Omit<Preset, 'updatedAt'> } | { ok: false; message: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.replace(/\r\n?/g, '\n').trim() : '';
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, limits.maxName) : '';
  if (!text) return { ok: false, message: '本文がありません。' };
  if (text.length > limits.maxText) return { ok: false, message: `1つ${limits.maxText.toLocaleString()}字までです。` };
  const cur = isPresetId(o.id) ? existing.find((p) => p.id === o.id) : undefined;
  if (!cur && existing.length >= PRESET_MAX) {
    return { ok: false, message: `いつものコンテキストは${PRESET_MAX}個までです。要らないものを消してから登録してください。` };
  }
  const id = cur?.id ?? `p${Math.max(0, ...existing.map((p) => Number(p.id.slice(1)) || 0)) + 1}`;
  const auto = typeof o.auto === 'boolean' ? o.auto : cur?.auto ?? false;
  const sortOrder = cur?.sortOrder ?? existing.length;
  return { ok: true, preset: { id, name: name || cur?.name || 'いつもの前提', text, auto, sortOrder } };
}
