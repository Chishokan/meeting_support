// つきいち改善の保存・取得。サーバ専用。
//
// 保存先：
//   1. Supabase（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）… テーブルは supabase/migrations/0003_kaizen.sql
//   2. 手元の開発だけ：.data/kaizen.json（git には入れない）
//   本番で Supabase が未設定なら not_configured を返し、画面に「未設定」と出す。
// 写真：Xサーバーのファイル置き場（xserver/kaigi-files/。lib/core/xserverFiles.ts）。表には置き場の中の名前だけを持ち、
//   画面には期限つき・署名つきの URL を渡す。置き場が未設定のとき、開発中は data URL で代用し、本番では写真を受け付けない。
//
// 誰が直せるか・投票できるか・何票までかは、ここに来る前に API（app/api/kaizen/）が lib/kaizen/model.ts で確かめる。
// ★列を増やしたら、SQL と下の fromDb / toDb をそろえること。

import { promises as fs } from 'fs';
import path from 'path';
import { jpDateTime, supabaseAdmin } from '../core/supabase';
import { deleteFiles, filesConfigured, putFile, signedFileUrl } from '../core/xserverFiles';
import { nowJstText, type Kaizen, type KaizenClose, type KaizenVote } from './model';

/** 写真の扱い：そのまま／外す／新しい写真（base64） */
export type PhotoChange = 'keep' | 'remove' | { data: string; mime: string; name: string };
export type PhotoChanges = { before: PhotoChange; after: PhotoChange };

export type KaizenData = { items: Kaizen[]; votes: KaizenVote[]; closes: KaizenClose[]; backend: 'db' | 'local' };
export type Fail = { ok: false; reason: string };
type Row = Record<string, unknown>;

const PAGE = 1000; // Supabase は1回1000行まで

function backend(): 'db' | 'local' | null {
  if (supabaseAdmin()) return 'db';
  if (process.env.NODE_ENV !== 'production') return 'local';
  return null;
}

const s = (v: unknown) => (v == null ? '' : String(v).trim());
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

/** 「2026/10/13 15:00」（日本時間）→ timestamptz に渡す ISO 形式。読めなければ今。 */
function jstToIso(t: string): string {
  const m = t.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00` : new Date().toISOString();
}

// 原因を画面で特定できるよう、エラーの種類（code）と文面を reason に載せる：「db_error|コード|文面」（門配管理と同じ形）
function dbFail(where: string, err: { message?: string; code?: string }): Fail {
  const code = err.code ?? '';
  const msg = (err.message ?? '').replace(/\|/g, '/').slice(0, 200);
  console.log('[kaizen-db]', where, code, msg);
  return { ok: false, reason: `db_error|${code}|${msg}` };
}

// ---- 行 ⇔ 型 ----------------------------------------------------------------

function fromDb(r: Row): Kaizen {
  return {
    id: s(r.id),
    month: s(r.month),
    submittedAt: jpDateTime(r.submitted_at as string),
    members: arr(r.members),
    campus: s(r.campus),
    title: s(r.title),
    before: s(r.before_text),
    after: s(r.after_text),
    beforePhotos: arr(r.before_photos),
    afterPhotos: arr(r.after_photos),
    enteredBy: s(r.entered_by),
    enteredDept: s(r.entered_dept),
    updatedAt: jpDateTime(r.updated_at as string),
    updatedBy: s(r.updated_by),
    source: s(r.source),
  };
}

function toDb(k: Kaizen): Row {
  return {
    id: k.id,
    month: k.month,
    submitted_at: jstToIso(k.submittedAt),
    members: k.members,
    campus: k.campus,
    title: k.title,
    before_text: k.before,
    after_text: k.after,
    before_photos: k.beforePhotos,
    after_photos: k.afterPhotos,
    entered_by: k.enteredBy,
    entered_dept: k.enteredDept,
    updated_at: jstToIso(k.updatedAt),
    updated_by: k.updatedBy,
    source: k.source,
  };
}

function voteFromDb(r: Row): KaizenVote {
  return { month: s(r.month), voter: s(r.voter), dept: s(r.dept), ids: arr(r.item_ids), votedAt: jpDateTime(r.voted_at as string) };
}

function voteToDb(v: KaizenVote): Row {
  return { month: v.month, voter: v.voter, dept: v.dept, item_ids: v.ids, voted_at: jstToIso(v.votedAt) };
}

function closeFromDb(r: Row): KaizenClose {
  return { month: s(r.month), closed: r.closed === true, by: s(r.closed_by), at: jpDateTime(r.closed_at as string) };
}

async function selectAll(table: string, order: string[], where?: (q: any) => any): Promise<Row[] | Fail> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin()!;
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select('*');
    if (where) q = where(q);
    for (const col of order) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) return dbFail(`select ${table}`, error);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) return out;
  }
}

const isFail = (v: unknown): v is Fail => !!v && typeof v === 'object' && (v as Fail).ok === false;

// ---- 写真 ------------------------------------------------------------------

/** ファイル置き場の中の名前か（旧スプレッドシートの Drive の URL・開発中の data URL ではないもの）。 */
const isStoredKey = (ref: string) => !/^(https?:|data:)/.test(ref);

function photoKey(itemId: string, slot: 'before' | 'after', mime: string): string {
  // dev と本番で同じ置き場を使っても混ざらないよう、Supabase の区画名（chishokan_dev / chishokan_prod）で分ける
  const env = ((process.env.SUPABASE_SCHEMA ?? '').trim() || 'local').replace(/[^A-Za-z0-9_-]/g, '');
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return `kaizen/${env}/${itemId}/${slot}-${Date.now()}.${ext}`;
}

async function putPhoto(itemId: string, slot: 'before' | 'after', p: { data: string; mime: string }): Promise<string | Fail> {
  if (!filesConfigured()) {
    // 置き場が未設定：開発中は data URL のまま持つ。本番では写真を受け付けない（写真なしの提出はできる）
    return process.env.NODE_ENV !== 'production' ? `data:${p.mime};base64,${p.data}` : { ok: false, reason: 'files_not_configured' };
  }
  const key = photoKey(itemId, slot, p.mime);
  const r = await putFile(key, Buffer.from(p.data, 'base64'), p.mime);
  return r.ok ? key : r;
}

/** 置き場の写真を消す（Drive の URL など、ほかの場所の写真には触らない）。失敗しても記録だけ残して続ける。 */
async function removePhotos(refs: string[]): Promise<void> {
  await deleteFiles(refs.filter(isStoredKey));
}

/** 画面に出せる形にする：置き場の中の名前を期限つきの URL に置き換える。URL を作れない写真は外す。 */
export async function withPhotoUrls<T extends Kaizen>(items: T[]): Promise<T[]> {
  const now = Date.now();
  const show = (refs: string[]) =>
    refs.flatMap((r) => {
      if (!isStoredKey(r)) return [r];
      const url = signedFileUrl(r, now);
      return url ? [url] : [];
    });
  return items.map((k) => ({ ...k, beforePhotos: show(k.beforePhotos), afterPhotos: show(k.afterPhotos) }));
}

// ---- 開発用ローカル保存 ------------------------------------------------------

const LOCAL_FILE = path.join(process.cwd(), '.data', 'kaizen.json');
type LocalDb = { items: (Kaizen & { deleted?: boolean })[]; votes: KaizenVote[]; closes: KaizenClose[] };

async function readLocal(): Promise<LocalDb> {
  try {
    const j = JSON.parse(await fs.readFile(LOCAL_FILE, 'utf8'));
    return { items: j.items ?? [], votes: j.votes ?? [], closes: j.closes ?? [] };
  } catch {
    return { items: [], votes: [], closes: [] };
  }
}

async function writeLocal(db: LocalDb): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// 1つの処理の中で読み書きが重ならないよう、手元の保存は順番に行う
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

// ---- 公開 API ------------------------------------------------------------

export async function loadKaizen(): Promise<({ ok: true } & KaizenData) | Fail> {
  const b = backend();
  if (!b) return { ok: false, reason: 'not_configured' };
  if (b === 'local') {
    const db = await readLocal();
    return { ok: true, items: db.items.filter((k) => !k.deleted), votes: db.votes, closes: db.closes, backend: b };
  }
  const items = await selectAll('kaizen_items', ['id'], (q) => q.is('deleted_at', null));
  if (isFail(items)) return items;
  const votes = await selectAll('kaizen_votes', ['month', 'voter']);
  if (isFail(votes)) return votes;
  const closes = await selectAll('kaizen_closes', ['month']);
  if (isFail(closes)) return closes;
  return { ok: true, items: items.map(fromDb), votes: votes.map(voteFromDb), closes: closes.map(closeFromDb), backend: b };
}

/**
 * 新規なら追加、同じ ID があれば上書き。写真は photos の指示どおりに差し替える。
 * cur は今の内容（新規なら null）。外した・差し替えた写真は、保存できてから置き場から消す。
 */
export async function saveKaizen(k: Kaizen, photos: PhotoChanges, cur: Kaizen | null): Promise<{ ok: true } | Fail> {
  const b = backend();
  if (!b) return { ok: false, reason: 'not_configured' };

  const uploaded: string[] = [];
  const apply = async (curRefs: string[], change: PhotoChange, slot: 'before' | 'after'): Promise<string[] | Fail> => {
    if (change === 'keep') return curRefs;
    if (change === 'remove') return [];
    const ref = await putPhoto(k.id, slot, change);
    if (isFail(ref)) return ref;
    uploaded.push(ref);
    return [ref];
  };
  const before = await apply(cur?.beforePhotos ?? [], photos.before, 'before');
  const after = isFail(before) ? before : await apply(cur?.afterPhotos ?? [], photos.after, 'after');
  if (isFail(before) || isFail(after)) {
    await removePhotos(uploaded);
    return isFail(before) ? before : (after as Fail);
  }
  const item: Kaizen = { ...k, beforePhotos: before, afterPhotos: after };

  if (b === 'local') {
    await serial(async () => {
      const db = await readLocal();
      const i = db.items.findIndex((x) => x.id === item.id);
      if (i >= 0) db.items[i] = item;
      else db.items.push(item);
      await writeLocal(db);
    });
  } else {
    const { error } = await supabaseAdmin()!.from('kaizen_items').upsert(toDb(item), { onConflict: 'id' });
    if (error) {
      await removePhotos(uploaded);
      return dbFail('upsert kaizen_items', error);
    }
  }
  const kept = new Set([...before, ...after]);
  await removePhotos([...(cur?.beforePhotos ?? []), ...(cur?.afterPhotos ?? [])].filter((r) => !kept.has(r)));
  return { ok: true };
}

/** 消す（行は残して deleted_at を付ける。写真は置き場から消す）。 */
export async function deleteKaizen(cur: Kaizen, user: string): Promise<{ ok: true } | Fail> {
  const b = backend();
  if (!b) return { ok: false, reason: 'not_configured' };
  if (b === 'local') {
    await serial(async () => {
      const db = await readLocal();
      const k = db.items.find((x) => x.id === cur.id);
      if (k) Object.assign(k, { deleted: true, updatedAt: nowJstText(), updatedBy: user });
      await writeLocal(db);
    });
    return { ok: true };
  }
  const { error } = await supabaseAdmin()!
    .from('kaizen_items')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString(), updated_by: user })
    .eq('id', cur.id);
  if (error) return dbFail('delete kaizen_items', error);
  await removePhotos([...cur.beforePhotos, ...cur.afterPhotos]);
  return { ok: true };
}

/** 対象月×投票者で1件。ids が空なら、その人のその月の票を消す。 */
export async function saveVote(v: KaizenVote): Promise<{ ok: true } | Fail> {
  const b = backend();
  if (!b) return { ok: false, reason: 'not_configured' };
  if (b === 'local') {
    await serial(async () => {
      const db = await readLocal();
      db.votes = db.votes.filter((x) => !(x.month === v.month && x.voter === v.voter));
      if (v.ids.length) db.votes.push(v);
      await writeLocal(db);
    });
    return { ok: true };
  }
  const t = supabaseAdmin()!.from('kaizen_votes');
  const { error } = v.ids.length
    ? await t.upsert(voteToDb(v), { onConflict: 'month,voter' })
    : await t.delete().eq('month', v.month).eq('voter', v.voter);
  return error ? dbFail('save kaizen_votes', error) : { ok: true };
}

export async function setClose(month: string, closed: boolean, user: string): Promise<{ ok: true } | Fail> {
  const b = backend();
  if (!b) return { ok: false, reason: 'not_configured' };
  if (b === 'local') {
    await serial(async () => {
      const db = await readLocal();
      db.closes = db.closes.filter((c) => c.month !== month);
      db.closes.push({ month, closed, by: user, at: nowJstText() });
      await writeLocal(db);
    });
    return { ok: true };
  }
  const { error } = await supabaseAdmin()!
    .from('kaizen_closes')
    .upsert({ month, closed, closed_by: user, closed_at: new Date().toISOString() }, { onConflict: 'month' });
  return error ? dbFail('upsert kaizen_closes', error) : { ok: true };
}

/** 旧スプレッドシートから移した改善・票をまとめて足す（重なりは API 側で除いてから渡す）。 */
export async function importKaizen(items: Kaizen[], votes: KaizenVote[]): Promise<{ ok: true } | Fail> {
  const b = backend();
  if (!b) return { ok: false, reason: 'not_configured' };
  if (b === 'local') {
    await serial(async () => {
      const db = await readLocal();
      db.items.push(...items);
      db.votes.push(...votes);
      await writeLocal(db);
    });
    return { ok: true };
  }
  const db = supabaseAdmin()!;
  if (items.length) {
    const { error } = await db.from('kaizen_items').insert(items.map(toDb));
    if (error) return dbFail('import kaizen_items', error);
  }
  if (votes.length) {
    const { error } = await db.from('kaizen_votes').upsert(votes.map(voteToDb), { onConflict: 'month,voter', ignoreDuplicates: true });
    if (error) return dbFail('import kaizen_votes', error);
  }
  return { ok: true };
}
