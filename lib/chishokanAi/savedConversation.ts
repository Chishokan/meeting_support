// 智翔館AI：会話を1つのファイル（JSON）に書き出し、読み込んで続きから使うための形。ほかに依存しない（型だけ使う）。
//
// 入れるもの：会話（質問と回答・読んだ資料の札・注意）、コンテキスト欄の項目（版の履歴も）、次の質問に持ち越す資料（文字にしたもの）。
// 添付した PDF・画像そのものは入れない（大きいので。続きで要るときは付け直してもらう）。
// 読み込んだ会話は、同じ会話番号の続きとして会話ログに残る。
// コンテキスト欄（pinned）と持ち越し（carry）の中身は、それぞれの決まりで確かめ直す
// （normalizePinnedList ／ normalizeContext。ここは外側の形と会話だけを確かめる）。

import type { Source } from './conversation';

export const SAVE_FORMAT = 'chishokan-ai-conversation';
export const SAVE_VERSION = 1;
/** 読み込めるファイルの大きさの上限（画面で確かめる）。 */
export const SAVE_MAX_BYTES = 5_000_000;
export const SAVE_MAX_MESSAGES = 400;
const MAX_CONTENT = 200_000;

export type SavedMsg = {
  role: 'user' | 'assistant';
  content: string;
  api?: string;
  sources?: Source[];
  notices?: string[];
  cut?: 'time' | 'length' | null;
  stopped?: boolean;
  error?: boolean;
  turn?: number;
  taskLabel?: string;
  at?: string;
};

export type SavedConversation = {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: string;
  conversationId: string;
  title: string;
  messages: SavedMsg[];
  /** コンテキスト欄の項目（normalizePinnedList で確かめる） */
  pinned: unknown;
  /** 使った番号の最大（消した番号を使い回さないため） */
  pinUsed: number;
  /** 次の質問に持ち越す資料（normalizeContext で確かめる） */
  carry: unknown;
};

export const NO_TITLE = '（質問なし）';

/** 会話の題名（最初の質問の始めの部分）。 */
export function conversationTitle(messages: { role: string; content: string; api?: string }[]): string {
  const q = messages.find((m) => m.role === 'user');
  const t = (q?.api ?? q?.content ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 30 ? `${t.slice(0, 30)}…` : t || NO_TITLE;
}

/** 書き出すときの形（会話の中の作業中の表示や 👍👎 の状態は入れない）。 */
export function toSavedMessages(messages: SavedMsg[]): SavedMsg[] {
  return messages.map((m) => {
    const o: SavedMsg = { role: m.role, content: m.content };
    if (m.api !== undefined && m.api !== m.content) o.api = m.api;
    if (m.sources?.length) o.sources = m.sources;
    if (m.notices?.length) o.notices = m.notices;
    if (m.cut) o.cut = m.cut;
    if (m.stopped) o.stopped = true;
    if (m.error) o.error = true;
    if (m.turn) o.turn = m.turn;
    if (m.taskLabel) o.taskLabel = m.taskLabel;
    if (m.at) o.at = m.at;
    return o;
  });
}

export function buildSaved(o: {
  conversationId: string;
  messages: SavedMsg[];
  pinned: unknown;
  pinUsed: number;
  carry: unknown;
  savedAt: string;
}): SavedConversation {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: o.savedAt,
    conversationId: o.conversationId,
    title: conversationTitle(o.messages),
    messages: toSavedMessages(o.messages),
    pinned: o.pinned,
    pinUsed: o.pinUsed,
    carry: o.carry,
  };
}

/** ファイル名（例：智翔館AI_会話_20261114-1305_冬期講習の計画.json）。 */
export function savedFileName(title: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  const safe = (title === NO_TITLE ? '' : title).replace(/…$/, '').replace(/[\\/:*?"<>|\s。、，．,.]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
  return `智翔館AI_会話_${stamp}${safe ? `_${safe}` : ''}.json`;
}

function str(v: unknown, n: number): string {
  return typeof v === 'string' ? v.slice(0, n) : '';
}

function source(v: unknown): Source | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'knowledge' && typeof o.path === 'string' && o.path.length <= 300) return { kind: 'knowledge', path: o.path };
  if (o.kind === 'drive' && typeof o.name === 'string' && typeof o.id === 'string' && /^[\w-]{10,100}$/.test(o.id)) {
    return { kind: 'drive', name: o.name.slice(0, 200), id: o.id };
  }
  return null;
}

/** 読み込んだファイルの中身を確かめる。 */
export function parseSaved(raw: unknown): { ok: true; value: SavedConversation } | { ok: false; message: string } {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o || o.format !== SAVE_FORMAT) return { ok: false, message: '智翔館AIが書き出した会話のファイルではありません。' };
  if (typeof o.version !== 'number' || o.version > SAVE_VERSION) {
    return { ok: false, message: 'このファイルは新しい形式で書き出されています。画面を読み込み直してから、もう一度選んでください。' };
  }
  if (!Array.isArray(o.messages)) return { ok: false, message: 'ファイルに会話が入っていません。' };
  const messages: SavedMsg[] = [];
  for (const x of o.messages.slice(0, SAVE_MAX_MESSAGES)) {
    if (!x || typeof x !== 'object') continue;
    const m = x as Record<string, unknown>;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const content = str(m.content, MAX_CONTENT);
    const msg: SavedMsg = { role: m.role, content };
    if (typeof m.api === 'string') msg.api = m.api.slice(0, MAX_CONTENT);
    if (Array.isArray(m.sources)) {
      const s = m.sources.map(source).filter((v): v is Source => !!v).slice(0, 40);
      if (s.length) msg.sources = s;
    }
    if (Array.isArray(m.notices)) {
      const n = m.notices.filter((v): v is string => typeof v === 'string').map((v) => v.slice(0, 1000)).slice(0, 10);
      if (n.length) msg.notices = n;
    }
    if (m.cut === 'time' || m.cut === 'length') msg.cut = m.cut;
    if (m.stopped === true) msg.stopped = true;
    if (m.error === true) msg.error = true;
    if (typeof m.turn === 'number' && Number.isFinite(m.turn) && m.turn > 0) msg.turn = Math.floor(m.turn);
    if (typeof m.taskLabel === 'string' && m.taskLabel) msg.taskLabel = m.taskLabel.slice(0, 60);
    if (typeof m.at === 'string' && m.at) msg.at = m.at.slice(0, 40);
    messages.push(msg);
  }
  // コンテキストだけを書き出したファイル（質問の前）も読める
  if (!messages.some((m) => m.role === 'user') && !(Array.isArray(o.pinned) && o.pinned.length)) {
    return { ok: false, message: 'ファイルに会話もコンテキストも入っていません。' };
  }
  const conversationId = typeof o.conversationId === 'string' && /^[\w-]{4,40}$/.test(o.conversationId) ? o.conversationId : '';
  const pinUsed = typeof o.pinUsed === 'number' && Number.isFinite(o.pinUsed) ? Math.max(0, Math.min(999, Math.floor(o.pinUsed))) : 0;
  return {
    ok: true,
    value: {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      savedAt: str(o.savedAt, 40),
      conversationId,
      title: conversationTitle(messages),
      messages,
      pinned: o.pinned,
      pinUsed,
      carry: o.carry,
    },
  };
}
