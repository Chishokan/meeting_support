// 適性検査の保存先を、Supabase と手元の JSON ファイルで同じ口（表ごとの select / insert / upsert / update / remove）で扱う。サーバ専用。
//
// 保存先の選び方：
//   1. Supabase（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）… テーブルは supabase/migrations/0002_aptitude.sql
//   2. 手元の開発だけ：.data/aptitude.json（git には入れない）
//   本番で Supabase が未設定なら「未設定」（not_configured）。個人情報を扱うのでスプレッドシートには置かない。
//
// 行は Supabase と同じ列名（snake_case）で持つ。型への読み替えは store.ts が1か所で行う。
// 件数は多くても数千行なので、一覧は表ごと読んでアプリ側で絞る（Supabase は1回1000行までなので分けて読む）。

import { promises as fs } from 'fs';
import path from 'path';
import { supabaseAdmin } from '../core/supabase';

export type Row = Record<string, unknown>;
/** 列＝値で絞る。配列はそのどれか（in）、null は「空」（is null）。 */
export type Filter = Record<string, string | number | boolean | null | (string | number)[]>;

export type TableName =
  | 'apt_versions' | 'apt_scales' | 'apt_questions' | 'apt_rules'
  | 'apt_candidates' | 'apt_sessions' | 'apt_answers' | 'apt_results' | 'apt_logs';

/** 読み書きの失敗。reason は画面側（lib/aptitude/client.ts の reasonText）が言い換える。 */
export class TableError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

export type Tables = {
  kind: 'db' | 'local';
  select(table: TableName, filter?: Filter): Promise<Row[]>;
  insert(table: TableName, rows: Row[]): Promise<void>;
  upsert(table: TableName, rows: Row[], keys: string[]): Promise<void>;
  update(table: TableName, filter: Filter, patch: Row): Promise<void>;
  remove(table: TableName, filter: Filter): Promise<void>;
};

/** 使える保存先。本番で Supabase が未設定なら null。 */
export function tables(): Tables | null {
  if (supabaseAdmin()) return dbTables;
  if (process.env.NODE_ENV !== 'production') return localTables;
  return null;
}

// ---- Supabase ---------------------------------------------------------------

// 原因を画面で特定できるよう、エラーの種類（code）と文面を reason に載せる：「db_error|コード|文面」（門配管理と同じ形）
function fail(where: string, err: { message?: string; code?: string }): never {
  const code = err.code ?? '';
  const msg = (err.message ?? '').replace(/\|/g, '/').slice(0, 200);
  console.log('[aptitude-db]', where, code, msg);
  throw new TableError(`db_error|${code}|${msg}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilter(q: any, filter: Filter = {}) {
  for (const [k, v] of Object.entries(filter)) {
    if (Array.isArray(v)) q = q.in(k, v);
    else if (v === null) q = q.is(k, null);
    else q = q.eq(k, v);
  }
  return q;
}

const PAGE = 1000;

// 分けて読むときに行が重なったり抜けたりしないよう、表ごとの主キーで並べてから読む
const ORDER: Record<TableName, string[]> = {
  apt_versions: ['id'],
  apt_scales: ['version_id', 'code'],
  apt_questions: ['version_id', 'no'],
  apt_rules: ['version_id', 'role'],
  apt_candidates: ['id'],
  apt_sessions: ['id'],
  apt_answers: ['session_id', 'question_no'],
  apt_results: ['session_id'],
  apt_logs: ['id'],
};

const dbTables: Tables = {
  kind: 'db',
  async select(table, filter) {
    const db = supabaseAdmin()!;
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = applyFilter(db.from(table).select('*'), filter);
      for (const col of ORDER[table]) q = q.order(col, { ascending: true });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) fail(`select ${table}`, error);
      out.push(...((data ?? []) as Row[]));
      if (!data || data.length < PAGE) return out;
    }
  },
  async insert(table, rows) {
    if (!rows.length) return;
    const { error } = await supabaseAdmin()!.from(table).insert(rows);
    if (error) fail(`insert ${table}`, error);
  },
  async upsert(table, rows, keys) {
    if (!rows.length) return;
    const { error } = await supabaseAdmin()!.from(table).upsert(rows, { onConflict: keys.join(',') });
    if (error) fail(`upsert ${table}`, error);
  },
  async update(table, filter, patch) {
    const { error } = await applyFilter(supabaseAdmin()!.from(table).update(patch), filter);
    if (error) fail(`update ${table}`, error);
  },
  async remove(table, filter) {
    const { error } = await applyFilter(supabaseAdmin()!.from(table).delete(), filter);
    if (error) fail(`delete ${table}`, error);
  },
};

// ---- 手元の開発用ローカル保存 ------------------------------------------------

const LOCAL_FILE = path.join(process.cwd(), '.data', 'aptitude.json');
type Local = Partial<Record<TableName, Row[]>>;

async function readLocal(): Promise<Local> {
  try {
    return JSON.parse(await fs.readFile(LOCAL_FILE, 'utf8')) as Local;
  } catch {
    return {};
  }
}

async function writeLocal(d: Local): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(d, null, 2), 'utf8');
}

function matches(r: Row, filter: Filter = {}): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (Array.isArray(v)) return v.some((x) => String(x) === String(r[k]));
    if (v === null) return r[k] == null;
    return String(r[k]) === String(v);
  });
}

// 1つの処理の中で読み書きが重ならないよう、手元の保存は順番に行う
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

const sameKey = (a: Row, b: Row, keys: string[]) => keys.every((k) => String(a[k]) === String(b[k]));

const localTables: Tables = {
  kind: 'local',
  select: (table, filter) => serial(async () => ((await readLocal())[table] ?? []).filter((r) => matches(r, filter))),
  insert: (table, rows) =>
    serial(async () => {
      const d = await readLocal();
      const list = (d[table] ??= []);
      for (const r of rows) {
        // apt_logs の id は Supabase では連番（identity）。手元でも連番を振る
        if (table === 'apt_logs' && r.id == null) r.id = list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
        list.push(r);
      }
      await writeLocal(d);
    }),
  upsert: (table, rows, keys) =>
    serial(async () => {
      const d = await readLocal();
      const list = (d[table] ??= []);
      for (const r of rows) {
        const i = list.findIndex((x) => sameKey(x, r, keys));
        if (i >= 0) list[i] = { ...list[i], ...r };
        else list.push(r);
      }
      await writeLocal(d);
    }),
  update: (table, filter, patch) =>
    serial(async () => {
      const d = await readLocal();
      d[table] = (d[table] ?? []).map((r) => (matches(r, filter) ? { ...r, ...patch } : r));
      await writeLocal(d);
    }),
  remove: (table, filter) =>
    serial(async () => {
      const d = await readLocal();
      d[table] = (d[table] ?? []).filter((r) => !matches(r, filter));
      await writeLocal(d);
    }),
};
