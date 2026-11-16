// 智翔館AI：会話の保存（履歴・保存した会話）と、いつものコンテキストの読み書き。サーバ専用。
// 決まり（件数・期間）は savedRules.ts。
//
// 置き場所：スプレッドシート「智翔館AI 会話ログ」（Apps Script の aiConvo… ／ aiPreset…。apps_script/Code.gs）。
//   _会話の保存 … 1行＝1つの会話（中身の JSON は4万5千字ずつ右のセルに分ける）
//   _いつものコンテキスト … 1行＝1つ
// 手元の開発だけ（NODE_ENV が production 以外で、APPS_SCRIPT_URL が無いとき）は .data/chishokan-ai-saved.json（git には入れない）。
// どの関数も、持ち主（ログインで確かめたメールアドレス）の行だけを読み書きする。

import { promises as fs } from 'fs';
import path from 'path';
import { callGas } from './gas';
import { idsToPurge, splitRows, type ConvoKind, type ConvoRow, type Preset } from './savedRules';

export type StoreFail = { ok: false; reason: 'no_db' | 'db_error' | 'not_found'; detail?: string };
type FullRow = ConvoRow & { data: unknown };
type LocalDb = { convos: Record<string, FullRow[]>; presets: Record<string, Preset[]> };

const LOCAL_FILE = path.join(process.cwd(), '.data', 'chishokan-ai-saved.json');

function gasOn(): boolean {
  return !!process.env.APPS_SCRIPT_URL;
}

function localMode(): boolean {
  return !gasOn() && process.env.NODE_ENV !== 'production';
}

/** 保存先があるか（無ければ、画面に保存の機能を出さない）。 */
export function storeAvailable(): boolean {
  return gasOn() || localMode();
}

async function readLocal(): Promise<LocalDb> {
  try {
    const j = JSON.parse(await fs.readFile(LOCAL_FILE, 'utf8')) as Partial<LocalDb>;
    return { convos: j.convos ?? {}, presets: j.presets ?? {} };
  } catch {
    return { convos: {}, presets: {} };
  }
}

async function writeLocal(db: LocalDb): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(db));
}

/** Apps Script を呼ぶ。再デプロイ前（印 saved が無い）や失敗は StoreFail。 */
async function gas(payload: Record<string, unknown>, mark: 'aiConvo' | 'aiPreset'): Promise<Record<string, unknown> | StoreFail> {
  const j = await callGas(payload);
  if (!j.ok) return { ok: false, reason: 'db_error', detail: String(j.reason ?? '') };
  if (j.saved !== mark) return { ok: false, reason: 'db_error', detail: 'Apps Script が古いまま（再デプロイが必要）' };
  return j;
}
const failed = (r: Record<string, unknown> | StoreFail): r is StoreFail => r.ok === false;

function toRow(v: unknown): ConvoRow | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  return {
    id: o.id,
    kind: o.kind === '保存' ? '保存' : '履歴',
    title: String(o.title ?? ''),
    turns: Number(o.turns) || 0,
    chars: Number(o.chars) || 0,
    createdAt: String(o.createdAt ?? ''),
    updatedAt: String(o.updatedAt ?? ''),
  };
}

async function listRows(owner: string): Promise<{ ok: true; rows: ConvoRow[] } | StoreFail> {
  if (localMode()) {
    const db = await readLocal();
    return { ok: true, rows: (db.convos[owner] ?? []).map(({ data: _data, ...r }) => r) };
  }
  if (!gasOn()) return { ok: false, reason: 'no_db' };
  const j = await gas({ action: 'aiConvoList', owner }, 'aiConvo');
  if (failed(j)) return j;
  return { ok: true, rows: (Array.isArray(j.rows) ? j.rows : []).map(toRow).filter((r): r is ConvoRow => !!r) };
}

async function deleteIds(owner: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  if (localMode()) {
    const db = await readLocal();
    db.convos[owner] = (db.convos[owner] ?? []).filter((r) => !ids.includes(r.id));
    await writeLocal(db);
    return;
  }
  const j = await gas({ action: 'aiConvoDelete', owner, ids }, 'aiConvo');
  if (failed(j)) throw new Error(j.detail ?? j.reason);
}

/** 一覧（新しい順）。開くたびに、期限切れと上限を超えた古い履歴を消す。 */
export async function listConversations(owner: string, now = new Date()): Promise<{ ok: true; history: ConvoRow[]; saved: ConvoRow[]; all: ConvoRow[] } | StoreFail> {
  const r = await listRows(owner);
  if (!r.ok) return r;
  const purge = idsToPurge(r.rows, now);
  if (purge.length) await deleteIds(owner, purge).catch(() => {});
  const rows = r.rows.filter((x) => !purge.includes(x.id));
  return { ok: true, ...splitRows(rows), all: rows };
}

export async function getConversation(owner: string, id: string): Promise<{ ok: true; row: FullRow } | StoreFail> {
  if (localMode()) {
    const row = (await readLocal()).convos[owner]?.find((r) => r.id === id);
    return row ? { ok: true, row } : { ok: false, reason: 'not_found' };
  }
  if (!gasOn()) return { ok: false, reason: 'no_db' };
  const j = await gas({ action: 'aiConvoGet', owner, id }, 'aiConvo');
  if (failed(j)) return j;
  const row = toRow(j);
  if (!j.found || !row) return { ok: false, reason: 'not_found' };
  let data: unknown;
  try {
    data = JSON.parse(String(j.data ?? ''));
  } catch {
    return { ok: false, reason: 'db_error', detail: '保存した中身を読めませんでした' };
  }
  return { ok: true, row: { ...row, data } };
}

/**
 * 会話を書く（質問のたびの自動保存）。今ある行の種類（履歴・保存）と、保存した会話の名前はそのまま。
 * 新しい会話なら履歴として足す。user は、シートで見分けやすいように一緒に書く名前。
 */
export async function putConversation(
  owner: string,
  id: string,
  v: { data: unknown; autoTitle: string; turns: number; chars: number; user?: string },
  now = new Date(),
): Promise<{ ok: true; kind: ConvoKind } | StoreFail> {
  const at = now.toISOString();
  if (localMode()) {
    const db = await readLocal();
    const list = db.convos[owner] ?? [];
    const cur = list.find((r) => r.id === id);
    const row: FullRow = {
      id, kind: cur?.kind ?? '履歴', title: cur?.kind === '保存' ? cur.title : v.autoTitle,
      turns: v.turns, chars: v.chars, createdAt: cur?.createdAt ?? at, updatedAt: at, data: v.data,
    };
    db.convos[owner] = [...list.filter((r) => r.id !== id), row];
    await writeLocal(db);
    return { ok: true, kind: row.kind };
  }
  if (!gasOn()) return { ok: false, reason: 'no_db' };
  const j = await gas(
    { action: 'aiConvoPut', owner, id, data: JSON.stringify(v.data), autoTitle: v.autoTitle, turns: v.turns, user: v.user ?? '' },
    'aiConvo',
  );
  if (failed(j)) return j;
  return { ok: true, kind: j.kind === '保存' ? '保存' : '履歴' };
}

/** 保存した会話にする（名前を付ける）／履歴に戻す。 */
export async function setConversationKind(owner: string, id: string, kind: ConvoKind, title: string, now = new Date()): Promise<{ ok: true } | StoreFail> {
  if (localMode()) {
    const db = await readLocal();
    const row = db.convos[owner]?.find((r) => r.id === id);
    if (!row) return { ok: false, reason: 'not_found' };
    Object.assign(row, { kind, title: title || row.title, updatedAt: now.toISOString() });
    await writeLocal(db);
    return { ok: true };
  }
  if (!gasOn()) return { ok: false, reason: 'no_db' };
  const j = await gas({ action: 'aiConvoKind', owner, id, kind, title }, 'aiConvo');
  if (failed(j)) return j;
  return j.found ? { ok: true } : { ok: false, reason: 'not_found' };
}

export async function deleteConversation(owner: string, id: string): Promise<{ ok: true } | StoreFail> {
  if (!storeAvailable()) return { ok: false, reason: 'no_db' };
  try {
    await deleteIds(owner, [id]);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'db_error', detail: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

// --- いつものコンテキスト -------------------------------------------------------

export async function listPresets(owner: string): Promise<{ ok: true; items: Preset[] } | StoreFail> {
  if (localMode()) return { ok: true, items: [...((await readLocal()).presets[owner] ?? [])].sort((a, b) => a.sortOrder - b.sortOrder) };
  if (!gasOn()) return { ok: false, reason: 'no_db' };
  const j = await gas({ action: 'aiPresetList', owner }, 'aiPreset');
  if (failed(j)) return j;
  const items = (Array.isArray(j.items) ? j.items : [])
    .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
    .filter((x) => typeof x.id === 'string' && typeof x.text === 'string')
    .map((x) => ({ id: String(x.id), name: String(x.name ?? ''), text: String(x.text), auto: x.auto === true, sortOrder: Number(x.sortOrder) || 0, updatedAt: String(x.updatedAt ?? '') }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return { ok: true, items };
}

export async function putPreset(owner: string, p: Omit<Preset, 'updatedAt'>, now = new Date()): Promise<{ ok: true; item: Preset } | StoreFail> {
  const item: Preset = { ...p, updatedAt: now.toISOString() };
  if (localMode()) {
    const db = await readLocal();
    db.presets[owner] = [...(db.presets[owner] ?? []).filter((x) => x.id !== p.id), item];
    await writeLocal(db);
    return { ok: true, item };
  }
  if (!gasOn()) return { ok: false, reason: 'no_db' };
  const j = await gas({ action: 'aiPresetPut', owner, preset: p }, 'aiPreset');
  if (failed(j)) return j;
  return { ok: true, item };
}

export async function deletePreset(owner: string, id: string): Promise<{ ok: true } | StoreFail> {
  if (localMode()) {
    const db = await readLocal();
    db.presets[owner] = (db.presets[owner] ?? []).filter((x) => x.id !== id);
    await writeLocal(db);
    return { ok: true };
  }
  if (!gasOn()) return { ok: false, reason: 'no_db' };
  const j = await gas({ action: 'aiPresetDelete', owner, id }, 'aiPreset');
  return failed(j) ? j : { ok: true };
}
