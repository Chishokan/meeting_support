// 智翔館AI：会話の保存（履歴・保存した会話）と、いつものコンテキストの読み書き。サーバ専用。
// 決まり（件数・期間）は savedRules.ts、表は supabase/migrations/0004_chishokan_ai.sql。
//
// 置き場所：Supabase（dev は chishokan_dev、本番は chishokan_prod）。
// 手元の開発だけ（NODE_ENV が production 以外で、Supabase の設定が無いとき）は .data/chishokan-ai-saved.json（git には入れない）。
// どの関数も、持ち主（ログインで確かめたメールアドレス）の行だけを読み書きする。

import { promises as fs } from 'fs';
import path from 'path';
import { supabaseAdmin } from '../core/supabase';
import { idsToPurge, REMOVED_DAYS, splitRows, type ConvoKind, type ConvoRow, type Preset } from './savedRules';

export type StoreFail = { ok: false; reason: 'no_db' | 'db_error' | 'not_found'; detail?: string };
type FullRow = ConvoRow & { data: unknown };
type LocalDb = { convos: Record<string, FullRow[]>; presets: Record<string, Preset[]> };

const T_CONVO = 'ai_conversations';
const T_PRESET = 'ai_context_presets';
const LOCAL_FILE = path.join(process.cwd(), '.data', 'chishokan-ai-saved.json');

function localMode(): boolean {
  return !supabaseAdmin() && process.env.NODE_ENV !== 'production';
}

/** 保存先があるか（無ければ、画面に保存の機能を出さない）。 */
export function storeAvailable(): boolean {
  return !!supabaseAdmin() || localMode();
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

const fail = (e: { message?: string } | null | undefined): StoreFail => ({ ok: false, reason: 'db_error', detail: e?.message?.slice(0, 200) });

type DbConvo = { id: string; kind: ConvoKind; title: string; turns: number; chars: number; created_at: string; updated_at: string; data?: unknown };
const fromDb = (r: DbConvo): ConvoRow => ({
  id: r.id, kind: r.kind, title: r.title, turns: Number(r.turns) || 0, chars: Number(r.chars) || 0, createdAt: r.created_at, updatedAt: r.updated_at,
});
const LIST_COLS = 'id,kind,title,turns,chars,created_at,updated_at';

async function listRows(owner: string): Promise<{ ok: true; rows: ConvoRow[] } | StoreFail> {
  if (localMode()) {
    const db = await readLocal();
    return { ok: true, rows: (db.convos[owner] ?? []).map(({ data: _data, ...r }) => r) };
  }
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, reason: 'no_db' };
  const { data, error } = await sb.from(T_CONVO).select(LIST_COLS).eq('owner', owner);
  if (error) return fail(error);
  return { ok: true, rows: (data as DbConvo[]).map(fromDb) };
}

async function deleteIds(owner: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  if (localMode()) {
    const db = await readLocal();
    db.convos[owner] = (db.convos[owner] ?? []).filter((r) => !ids.includes(r.id));
    await writeLocal(db);
    return;
  }
  await supabaseAdmin()?.from(T_CONVO).delete().eq('owner', owner).in('id', ids);
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
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, reason: 'no_db' };
  const { data, error } = await sb.from(T_CONVO).select(`${LIST_COLS},data`).eq('owner', owner).eq('id', id).maybeSingle();
  if (error) return fail(error);
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true, row: { ...fromDb(data as DbConvo), data: (data as DbConvo).data } };
}

/**
 * 会話を書く（質問のたびの自動保存）。今ある行の種類（履歴・保存）と、保存した会話の名前はそのまま。
 * 新しい会話なら履歴として足す。
 */
export async function putConversation(
  owner: string,
  id: string,
  v: { data: unknown; autoTitle: string; turns: number; chars: number },
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
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, reason: 'no_db' };
  const { data: cur, error: e1 } = await sb.from(T_CONVO).select('kind,title').eq('owner', owner).eq('id', id).maybeSingle();
  if (e1) return fail(e1);
  const kind: ConvoKind = (cur as { kind?: ConvoKind } | null)?.kind ?? '履歴';
  const title = kind === '保存' ? String((cur as { title?: string }).title ?? '') : v.autoTitle;
  const { error } = await sb
    .from(T_CONVO)
    .upsert({ owner, id, kind, title, data: v.data, turns: v.turns, chars: v.chars, updated_at: at }, { onConflict: 'owner,id' });
  if (error) return fail(error);
  return { ok: true, kind };
}

/** 保存した会話にする（名前を付ける）／履歴に戻す。 */
export async function setConversationKind(owner: string, id: string, kind: ConvoKind, title: string, now = new Date()): Promise<{ ok: true } | StoreFail> {
  const at = now.toISOString();
  if (localMode()) {
    const db = await readLocal();
    const row = db.convos[owner]?.find((r) => r.id === id);
    if (!row) return { ok: false, reason: 'not_found' };
    Object.assign(row, { kind, title: title || row.title, updatedAt: at });
    await writeLocal(db);
    return { ok: true };
  }
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, reason: 'no_db' };
  const patch: Record<string, unknown> = { kind, updated_at: at };
  if (title) patch.title = title;
  const { data, error } = await sb.from(T_CONVO).update(patch).eq('owner', owner).eq('id', id).select('id');
  if (error) return fail(error);
  return (data as unknown[]).length ? { ok: true } : { ok: false, reason: 'not_found' };
}

export async function deleteConversation(owner: string, id: string): Promise<{ ok: true } | StoreFail> {
  if (!localMode() && !supabaseAdmin()) return { ok: false, reason: 'no_db' };
  try {
    await deleteIds(owner, [id]);
    return { ok: true };
  } catch (e) {
    return fail(e as Error);
  }
}

// --- いつものコンテキスト -------------------------------------------------------

type DbPreset = { id: string; name: string; text: string; auto: boolean; sort_order: number; updated_at: string };

export async function listPresets(owner: string): Promise<{ ok: true; items: Preset[] } | StoreFail> {
  if (localMode()) return { ok: true, items: [...((await readLocal()).presets[owner] ?? [])].sort((a, b) => a.sortOrder - b.sortOrder) };
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, reason: 'no_db' };
  const { data, error } = await sb.from(T_PRESET).select('id,name,text,auto,sort_order,updated_at').eq('owner', owner).order('sort_order');
  if (error) return fail(error);
  return {
    ok: true,
    items: (data as DbPreset[]).map((r) => ({ id: r.id, name: r.name, text: r.text, auto: !!r.auto, sortOrder: Number(r.sort_order) || 0, updatedAt: r.updated_at })),
  };
}

export async function putPreset(owner: string, p: Omit<Preset, 'updatedAt'>, now = new Date()): Promise<{ ok: true; item: Preset } | StoreFail> {
  const item: Preset = { ...p, updatedAt: now.toISOString() };
  if (localMode()) {
    const db = await readLocal();
    db.presets[owner] = [...(db.presets[owner] ?? []).filter((x) => x.id !== p.id), item];
    await writeLocal(db);
    return { ok: true, item };
  }
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, reason: 'no_db' };
  const { error } = await sb
    .from(T_PRESET)
    .upsert({ owner, id: p.id, name: p.name, text: p.text, auto: p.auto, sort_order: p.sortOrder, updated_at: item.updatedAt }, { onConflict: 'owner,id' });
  if (error) return fail(error);
  return { ok: true, item };
}

export async function deletePreset(owner: string, id: string): Promise<{ ok: true } | StoreFail> {
  if (localMode()) {
    const db = await readLocal();
    db.presets[owner] = (db.presets[owner] ?? []).filter((x) => x.id !== id);
    await writeLocal(db);
    return { ok: true };
  }
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, reason: 'no_db' };
  const { error } = await sb.from(T_PRESET).delete().eq('owner', owner).eq('id', id);
  return error ? fail(error) : { ok: true };
}

/**
 * 職員一覧から外れた人（退職など）の保存を消す。最後に使ってから REMOVED_DAYS 日たったものだけ。
 * active は、いまログインできるメールアドレス（小文字）。メールアドレスでのログインを入れたら、定期的に呼ぶ。
 */
export async function purgeRemovedOwners(active: string[], now = new Date()): Promise<{ ok: true; owners: string[] } | StoreFail> {
  const before = new Date(now.getTime() - REMOVED_DAYS * 86_400_000).toISOString();
  const keep = new Set(active.map((a) => a.toLowerCase()));
  if (localMode()) {
    const db = await readLocal();
    const all = new Set([...Object.keys(db.convos), ...Object.keys(db.presets)]);
    const owners = [...all].filter((o) => !keep.has(o) && [...(db.convos[o] ?? []), ...(db.presets[o] ?? [])].every((r) => r.updatedAt < before));
    for (const o of owners) { delete db.convos[o]; delete db.presets[o]; }
    await writeLocal(db);
    return { ok: true, owners };
  }
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, reason: 'no_db' };
  const c = await sb.from(T_CONVO).select('owner,updated_at');
  if (c.error) return fail(c.error);
  const p = await sb.from(T_PRESET).select('owner,updated_at');
  if (p.error) return fail(p.error);
  const last = new Map<string, string>();
  for (const r of [...c.data, ...p.data] as { owner: string; updated_at: string }[]) {
    if ((last.get(r.owner) ?? '') < r.updated_at) last.set(r.owner, r.updated_at);
  }
  const owners = [...last].filter(([o, at]) => !keep.has(o) && at < before).map(([o]) => o);
  if (owners.length) {
    const a = await sb.from(T_CONVO).delete().in('owner', owners);
    if (a.error) return fail(a.error);
    const b = await sb.from(T_PRESET).delete().in('owner', owners);
    if (b.error) return fail(b.error);
  }
  return { ok: true, owners };
}
