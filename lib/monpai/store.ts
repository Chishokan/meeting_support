// 門配管理の保存・取得。サーバ専用。
//
// 保存先は次の順で選ぶ（上にあるほど優先）：
//   1. Supabase（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）… テーブルは supabase/migrations/0001_monpai.sql
//   2. 門配専用の Apps Script（MONPAI_SCRIPT_URL / MONPAI_SCRIPT_TOKEN）… apps_script/monpai.gs
//   3. 手元の開発だけ：.data/monpai.json（git には入れない）
// Supabase に移したあとも、環境変数を外せばスプレッドシートに戻せる（切り替え期間の保険）。
//
// ★列を増やしたら、SQL・下の対応表（RECORD_HEADERS / fromDb / toDb）・monpai.gs をそろえること。

import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { MaterialItem, MaterialMovement, MonpaiRecord, MonthSetting, RecordInput, School, SchoolKind, Status } from './model';
import { SEED_SCHOOLS } from './seed';
import { jpDateTime, supabaseAdmin } from '../core/supabase';

type Fail = { ok: false; reason: string };
export type MasterResult = { ok: true; schools: School[]; settings: MonthSetting[]; backend: 'db' | 'sheet' | 'local' } | Fail;
export type ListResult = { ok: true; items: MonpaiRecord[] } | Fail;
export type SaveResult = { ok: true; item: MonpaiRecord } | Fail;
export type DeleteResult = { ok: true } | Fail;
export type MaterialsResult =
  | {
      ok: true;
      items: MaterialItem[];
      movements: MaterialMovement[]; // 在庫の計算に使う（Supabase では品名ごとの合計）
      usage: { material: string; done: number | null }[];
      recent?: MaterialMovement[]; // 画面の「最近の入出庫」（新しい順）。無ければ movements から作る
    }
  | Fail;

// シートの見出し ↔ 記録のキー（この順で1行）
const RECORD_HEADERS: [keyof MonpaiRecord, string][] = [
  ['id', 'ID'], ['date', '日付'], ['time', '時間'], ['district', '地区'], ['school', '学校'],
  ['staff1', '担当1'], ['staff2', '担当2'], ['material', '配布物'], ['planned', '計画部数'],
  ['done', '実施部数'], ['status', '状態'], ['reason', '不実施理由'], ['memo', '反応メモ'],
  ['createdAt', '作成日時'], ['createdBy', '作成者'], ['updatedAt', '更新日時'], ['updatedBy', '更新者'],
];

export function nowJp(): string {
  const p = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}/${g('month')}/${g('day')} ${g('hour')}:${g('minute')}`;
}

const s = (v: unknown) => (v == null ? '' : String(v).trim());
const numOrNull = (v: unknown) => (s(v) === '' ? null : Number(v) || 0);

function fromSheetRecord(r: Record<string, unknown>): MonpaiRecord {
  const o: Record<string, unknown> = {};
  for (const [k, h] of RECORD_HEADERS) o[k] = s(r[h]);
  o.planned = Number(r['計画部数']) || 0;
  o.done = numOrNull(r['実施部数']);
  o.status = (['予定', '実施', '中止'].includes(String(o.status)) ? o.status : '予定') as Status;
  return o as MonpaiRecord;
}

function toSheetRecord(r: MonpaiRecord): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, h] of RECORD_HEADERS) o[h] = r[k] == null ? '' : r[k];
  return o;
}

function fromSheetSchool(r: Record<string, unknown>): School {
  return {
    district: s(r['地区']),
    name: s(r['学校名']),
    kind: (s(r['種別']) === '小' ? '小' : '中') as SchoolKind,
    students: Number(r['生徒数']) || 0,
    order: Number(r['並び順']) || 0,
    note: s(r['備考']),
  };
}

function fromSheetSetting(r: Record<string, unknown>): MonthSetting {
  const raw = s(r['率']).replace('%', '');
  const n = raw === '' ? null : Number(raw);
  return {
    month: s(r['月']).slice(0, 7),
    school: s(r['学校名']),
    // 「50」「50%」「0.5」のどれで書いても 0.5 として扱う
    rate: n == null || Number.isNaN(n) ? null : n > 1 ? n / 100 : n,
    recruit: ['1', '○', '〇', 'TRUE', 'true', '募集期'].includes(s(r['募集期'])),
  };
}

function useLocal(): boolean {
  return !supabaseAdmin() && !process.env.MONPAI_SCRIPT_URL && process.env.NODE_ENV !== 'production';
}

// ---- Supabase ---------------------------------------------------------------

type Row = Record<string, unknown>;

function fromDbRecord(r: Row): MonpaiRecord {
  return {
    id: s(r.id), date: s(r.date).slice(0, 10), time: s(r.time), district: s(r.district), school: s(r.school),
    staff1: s(r.staff1), staff2: s(r.staff2), material: s(r.material),
    planned: Number(r.planned) || 0, done: r.done == null ? null : Number(r.done),
    status: (['予定', '実施', '中止'].includes(s(r.status)) ? s(r.status) : '予定') as Status,
    reason: s(r.reason), memo: s(r.memo),
    createdAt: jpDateTime(r.created_at as string), createdBy: s(r.created_by),
    updatedAt: jpDateTime(r.updated_at as string), updatedBy: s(r.updated_by),
  };
}

function toDbRecord(r: RecordInput) {
  return {
    date: r.date, time: r.time, district: r.district, school: r.school, staff1: r.staff1, staff2: r.staff2,
    material: r.material, planned: r.planned, done: r.done, status: r.status, reason: r.reason, memo: r.memo,
  };
}

/** 月（YYYY-MM）の初日と翌月の初日。date の範囲検索に使う。 */
function monthRange(m: string): [string, string] {
  const [y, mo] = m.split('-').map(Number);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return [`${m}-01`, `${next}-01`];
}

// 原因を画面で特定できるよう、エラーの種類（code）と文面を reason に載せる：「db_error|コード|文面」
// （キーや接続先そのものは含まれない。画面側の reasonText が設定の直し方に言い換える）
const dbFail = (where: string, err: { message?: string; code?: string } | null): Fail => {
  const code = err?.code ?? '';
  const msg = (err?.message ?? '').replace(/\|/g, '/').slice(0, 200);
  console.log('[monpai-db]', where, code, msg);
  return { ok: false, reason: `db_error|${code}|${msg}` };
};

type Gas = {
  ok?: boolean; reason?: string; items?: unknown[]; schools?: unknown[]; settings?: unknown[];
  movements?: unknown[]; usage?: unknown[]; item?: Record<string, unknown>;
};

async function callGas(payload: Record<string, unknown>): Promise<Gas> {
  const url = process.env.MONPAI_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: process.env.MONPAI_SCRIPT_TOKEN || '', ...payload }),
      cache: 'no-store',
    });
    // GAS は失敗時も 200 を返すので、本文の ok/reason で判定する
    const j = (await res.json().catch(() => null)) as Gas | null;
    if (!res.ok || !j) return { ok: false, reason: 'upstream_error' };
    return j;
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

// ---- 手元の開発用ローカル保存 ------------------------------------------------

type Local = {
  schools: School[]; settings: MonthSetting[]; records: MonpaiRecord[];
  materials?: MaterialItem[]; movements?: MaterialMovement[];
};
const LOCAL_FILE = path.join(process.cwd(), '.data', 'monpai.json');

async function readLocal(): Promise<Local> {
  try {
    return JSON.parse(await fs.readFile(LOCAL_FILE, 'utf8')) as Local;
  } catch {
    return { schools: SEED_SCHOOLS, settings: [], records: [] };
  }
}

async function writeLocal(d: Local): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(d, null, 2), 'utf8');
}

// ---- 公開 -----------------------------------------------------------------

export async function getMaster(): Promise<MasterResult> {
  const db = supabaseAdmin();
  if (db) {
    const [sc, st] = await Promise.all([
      db.from('monpai_schools').select('*'),
      db.from('monpai_month_settings').select('*'),
    ]);
    if (sc.error) return dbFail('schools', sc.error);
    if (st.error) return dbFail('settings', st.error);
    return {
      ok: true,
      backend: 'db',
      schools: (sc.data as Row[]).map((r) => ({
        district: s(r.district), name: s(r.name), kind: (s(r.kind) === '小' ? '小' : '中') as SchoolKind,
        students: Number(r.students) || 0, order: Number(r.sort_order) || 0, note: s(r.note),
      })),
      settings: (st.data as Row[]).map((r) => ({
        month: s(r.month), school: s(r.school), rate: r.rate == null ? null : Number(r.rate), recruit: !!r.recruit,
      })),
    };
  }
  if (useLocal()) {
    const d = await readLocal();
    return { ok: true, schools: d.schools, settings: d.settings, backend: 'local' };
  }
  const j = await callGas({ action: 'monpaiMaster' });
  if (!j.ok) return { ok: false, reason: j.reason || 'upstream_error' };
  const schools = ((j.schools ?? []) as Record<string, unknown>[]).map(fromSheetSchool).filter((x) => x.name && x.district);
  const settings = ((j.settings ?? []) as Record<string, unknown>[]).map(fromSheetSetting).filter((x) => /^\d{4}-\d{2}$/.test(x.month));
  return { ok: true, schools, settings, backend: 'sheet' };
}

/** months（YYYY-MM）のどれかに入る記録を返す。 */
export async function listRecords(months: string[]): Promise<ListResult> {
  const db = supabaseAdmin();
  if (db) {
    const sorted = [...months].sort();
    const [from] = monthRange(sorted[0]);
    const [, to] = monthRange(sorted[sorted.length - 1]);
    // Supabase は1回に最大1000行しか返さないので、1000行ずつ取り切る
    const rows: Row[] = [];
    for (let at = 0; ; at += 1000) {
      const { data, error } = await db
        .from('monpai_records').select('*')
        .is('deleted_at', null).gte('date', from).lt('date', to)
        .order('date').order('id').range(at, at + 999);
      if (error) return dbFail('list', error);
      rows.push(...(data as Row[]));
      if (data.length < 1000 || at >= 20000) break;
    }
    return { ok: true, items: rows.map(fromDbRecord).filter((r) => months.includes(r.date.slice(0, 7))) };
  }
  if (useLocal()) {
    const d = await readLocal();
    return { ok: true, items: d.records.filter((r) => months.includes(r.date.slice(0, 7))) };
  }
  const j = await callGas({ action: 'monpaiList', months });
  if (!j.ok || !Array.isArray(j.items)) return { ok: false, reason: j.reason || 'upstream_error' };
  return { ok: true, items: (j.items as Record<string, unknown>[]).map(fromSheetRecord).filter((r) => r.id) };
}

/** id が空なら新規、あれば上書き。作成日時・作成者は元の値を守る。 */
export async function saveRecord(id: string, input: RecordInput, user: string): Promise<SaveResult> {
  const ts = nowJp();
  const db = supabaseAdmin();
  if (db) {
    const body = { ...toDbRecord(input), updated_by: user, updated_at: new Date().toISOString() };
    const q = id
      ? db.from('monpai_records').update(body).eq('id', id).is('deleted_at', null).select().maybeSingle()
      : db.from('monpai_records').insert({ ...body, created_by: user }).select().single();
    const { data, error } = await q;
    if (error) return dbFail('save', error);
    if (!data) return { ok: false, reason: 'not_found' };
    return { ok: true, item: fromDbRecord(data as Row) };
  }
  if (useLocal()) {
    const d = await readLocal();
    const i = id ? d.records.findIndex((r) => r.id === id) : -1;
    if (id && i === -1) return { ok: false, reason: 'not_found' };
    const cur = i >= 0 ? d.records[i] : null;
    const item: MonpaiRecord = {
      ...input,
      id: cur?.id ?? randomUUID(),
      createdAt: cur?.createdAt ?? ts, createdBy: cur?.createdBy ?? user,
      updatedAt: ts, updatedBy: user,
    };
    if (i >= 0) d.records[i] = item; else d.records.push(item);
    await writeLocal(d);
    return { ok: true, item };
  }
  const draft: MonpaiRecord = {
    ...input, id: id || randomUUID(),
    createdAt: ts, createdBy: user, updatedAt: ts, updatedBy: user,
  };
  const j = await callGas({ action: 'monpaiSave', record: toSheetRecord(draft), isNew: !id });
  if (!j.ok || !j.item) return { ok: false, reason: j.reason || 'upstream_error' };
  return { ok: true, item: fromSheetRecord(j.item) };
}

export async function deleteRecord(id: string, user: string): Promise<DeleteResult> {
  const db = supabaseAdmin();
  if (db) {
    const now = new Date().toISOString();
    const { data, error } = await db
      .from('monpai_records').update({ deleted_at: now, updated_at: now, updated_by: user })
      .eq('id', id).is('deleted_at', null).select('id');
    if (error) return dbFail('delete', error);
    return data && data.length ? { ok: true } : { ok: false, reason: 'not_found' };
  }
  if (useLocal()) {
    const d = await readLocal();
    const n = d.records.length;
    d.records = d.records.filter((r) => r.id !== id);
    if (d.records.length === n) return { ok: false, reason: 'not_found' };
    await writeLocal(d);
    return { ok: true };
  }
  const j = await callGas({ action: 'monpaiDelete', id, user });
  return j.ok ? { ok: true } : { ok: false, reason: j.reason || 'upstream_error' };
}

// ---- 配布物・ノベルティ -------------------------------------------------------

function fromSheetMaterial(r: Record<string, unknown>): MaterialItem {
  return {
    name: s(r['品名']), kind: s(r['種類']), prep: s(r['準備担当']),
    threshold: Number(r['発注目安']) || 0, note: s(r['備考']),
  };
}

function fromSheetMovement(r: Record<string, unknown>): MaterialMovement {
  return { date: s(r['日付']), name: s(r['品名']), qty: Number(r['数量']) || 0, memo: s(r['メモ']), user: s(r['登録者']) };
}

/** 配布物の一覧・入出庫・実績の配布数（在庫の計算は model.ts の computeStock）。 */
export async function getMaterials(): Promise<MaterialsResult> {
  const db = supabaseAdmin();
  if (db) {
    const [it, rc, us, recent] = await Promise.all([
      db.from('monpai_materials').select('*').order('name'),
      db.from('monpai_material_received').select('*'),
      db.from('monpai_material_usage').select('*'),
      db.from('monpai_material_movements').select('*').order('id', { ascending: false }).limit(50),
    ]);
    if (it.error) return dbFail('materials', it.error);
    if (rc.error) return dbFail('received', rc.error);
    if (us.error) return dbFail('usage', us.error);
    if (recent.error) return dbFail('movements', recent.error);
    const move = (r: Row): MaterialMovement => ({
      date: s(r.date).slice(0, 10), name: s(r.name), qty: Number(r.qty) || 0, memo: s(r.memo), user: s(r.created_by),
    });
    return {
      ok: true,
      items: (it.data as Row[]).map((r) => ({ name: s(r.name), kind: s(r.kind), prep: s(r.prep), threshold: Number(r.threshold) || 0, note: s(r.note) })),
      movements: (rc.data as Row[]).map((r) => ({ date: '', name: s(r.name), qty: Number(r.qty) || 0, memo: '', user: '' })),
      usage: (us.data as Row[]).map((r) => ({ material: s(r.material), done: r.done == null ? null : Number(r.done) })),
      recent: (recent.data as Row[]).map(move),
    };
  }
  if (useLocal()) {
    const d = await readLocal();
    return {
      ok: true,
      items: d.materials ?? [],
      movements: d.movements ?? [],
      usage: d.records.map((r) => ({ material: r.material, done: r.done })),
    };
  }
  const j = await callGas({ action: 'monpaiMaterials' });
  if (!j.ok) return { ok: false, reason: j.reason || 'upstream_error' };
  return {
    ok: true,
    items: ((j.items ?? []) as Record<string, unknown>[]).map(fromSheetMaterial).filter((x) => x.name),
    movements: ((j.movements ?? []) as Record<string, unknown>[]).map(fromSheetMovement).filter((x) => x.name),
    usage: ((j.usage ?? []) as Record<string, unknown>[]).map((u) => ({ material: s(u['配布物']), done: numOrNull(u['実施部数']) })),
  };
}

/** 品名が同じなら上書き、無ければ追加。 */
export async function saveMaterial(item: MaterialItem): Promise<{ ok: true } | Fail> {
  const db = supabaseAdmin();
  if (db) {
    const { error } = await db.from('monpai_materials').upsert(
      { name: item.name, kind: item.kind, prep: item.prep, threshold: item.threshold, note: item.note },
      { onConflict: 'name' },
    );
    return error ? dbFail('saveMaterial', error) : { ok: true };
  }
  if (useLocal()) {
    const d = await readLocal();
    const list = d.materials ?? [];
    const i = list.findIndex((m) => m.name === item.name);
    if (i >= 0) list[i] = item; else list.push(item);
    d.materials = list;
    await writeLocal(d);
    return { ok: true };
  }
  const j = await callGas({
    action: 'monpaiSaveMaterial',
    item: { 品名: item.name, 種類: item.kind, 準備担当: item.prep, 発注目安: item.threshold, 備考: item.note },
  });
  return j.ok ? { ok: true } : { ok: false, reason: j.reason || 'upstream_error' };
}

export async function addMovement(m: MaterialMovement): Promise<{ ok: true } | Fail> {
  const db = supabaseAdmin();
  if (db) {
    const { error } = await db.from('monpai_material_movements').insert(
      { date: m.date, name: m.name, qty: m.qty, memo: m.memo, created_by: m.user },
    );
    return error ? dbFail('addMovement', error) : { ok: true };
  }
  if (useLocal()) {
    const d = await readLocal();
    d.movements = [...(d.movements ?? []), m];
    await writeLocal(d);
    return { ok: true };
  }
  const j = await callGas({
    action: 'monpaiAddMovement',
    movement: { 日付: m.date, 品名: m.name, 数量: m.qty, メモ: m.memo, 登録者: m.user },
  });
  return j.ok ? { ok: true } : { ok: false, reason: j.reason || 'upstream_error' };
}

// ---- 学校マスタ・月別設定の編集（Supabase と手元のファイルだけ。スプレッドシートは直接編集する） ----

type Simple = { ok: true } | Fail;
const notSupported: Fail = { ok: false, reason: 'not_supported' };

export async function saveSchool(sc: School): Promise<Simple> {
  const db = supabaseAdmin();
  if (db) {
    const { error } = await db.from('monpai_schools').upsert(
      { name: sc.name, district: sc.district, kind: sc.kind, students: sc.students, sort_order: sc.order, note: sc.note },
      { onConflict: 'name' },
    );
    return error ? dbFail('saveSchool', error) : { ok: true };
  }
  if (!useLocal()) return notSupported;
  const d = await readLocal();
  const i = d.schools.findIndex((x) => x.name === sc.name);
  if (i >= 0) d.schools[i] = sc; else d.schools.push(sc);
  await writeLocal(d);
  return { ok: true };
}

/** 学校マスタから外す（過去の門配の記録は残る。記録は学校名で持っているので表示もそのまま）。 */
export async function deleteSchool(name: string): Promise<Simple> {
  const db = supabaseAdmin();
  if (db) {
    const { error } = await db.from('monpai_schools').delete().eq('name', name);
    return error ? dbFail('deleteSchool', error) : { ok: true };
  }
  if (!useLocal()) return notSupported;
  const d = await readLocal();
  d.schools = d.schools.filter((x) => x.name !== name);
  await writeLocal(d);
  return { ok: true };
}

export async function saveSetting(st: MonthSetting): Promise<Simple> {
  const db = supabaseAdmin();
  if (db) {
    const { error } = await db.from('monpai_month_settings').upsert(
      { month: st.month, school: st.school, rate: st.rate, recruit: st.recruit },
      { onConflict: 'month,school' },
    );
    return error ? dbFail('saveSetting', error) : { ok: true };
  }
  if (!useLocal()) return notSupported;
  const d = await readLocal();
  const i = d.settings.findIndex((x) => x.month === st.month && x.school === st.school);
  if (i >= 0) d.settings[i] = st; else d.settings.push(st);
  await writeLocal(d);
  return { ok: true };
}

export async function deleteSetting(month: string, school: string): Promise<Simple> {
  const db = supabaseAdmin();
  if (db) {
    const { error } = await db.from('monpai_month_settings').delete().eq('month', month).eq('school', school);
    return error ? dbFail('deleteSetting', error) : { ok: true };
  }
  if (!useLocal()) return notSupported;
  const d = await readLocal();
  d.settings = d.settings.filter((x) => !(x.month === month && x.school === school));
  await writeLocal(d);
  return { ok: true };
}

// ---- スプレッドシートからの取り込み（apps_script/monpai_import.gs から呼ばれる） ----------

export const IMPORT_USER = 'シート取込';

/**
 * 1か月分の記録を入れ替える：その月の「シート取込」で作った記録を消してから入れ直す。
 * 何度取り込んでも二重にならない。アプリで作った記録（作成者が人の名前）には触らない。
 */
export async function replaceImportedMonth(month: string, inputs: RecordInput[]): Promise<{ ok: true; inserted: number } | Fail> {
  const [from, to] = monthRange(month);
  const db = supabaseAdmin();
  if (db) {
    const del = await db.from('monpai_records').delete().eq('created_by', IMPORT_USER).gte('date', from).lt('date', to);
    if (del.error) return dbFail('import-delete', del.error);
    for (let i = 0; i < inputs.length; i += 500) {
      const rows = inputs.slice(i, i + 500).map((r) => ({ ...toDbRecord(r), created_by: IMPORT_USER, updated_by: IMPORT_USER }));
      const ins = await db.from('monpai_records').insert(rows);
      if (ins.error) return dbFail('import-insert', ins.error);
    }
    return { ok: true, inserted: inputs.length };
  }
  if (!useLocal()) return notSupported;
  const d = await readLocal();
  const ts = nowJp();
  d.records = d.records.filter((r) => !(r.createdBy === IMPORT_USER && r.date >= from && r.date < to));
  for (const r of inputs) {
    d.records.push({ ...r, id: randomUUID(), createdAt: ts, createdBy: IMPORT_USER, updatedAt: ts, updatedBy: IMPORT_USER });
  }
  await writeLocal(d);
  return { ok: true, inserted: inputs.length };
}
