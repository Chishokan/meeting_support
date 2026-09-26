// 門配管理の保存・取得。サーバ専用。
//
// 本番・dev：門配専用の Apps Script（apps_script/monpai.gs）経由で、門配専用のスプレッドシートを読み書きする。
//            環境変数 MONPAI_SCRIPT_URL / MONPAI_SCRIPT_TOKEN（会議DXの APPS_SCRIPT_* とは別）。
// 手元の開発：MONPAI_SCRIPT_URL が無いときは .data/monpai.json に保存する（git には入れない）。
//
// ★列を増やしたら RECORD_HEADERS と monpai.gs の RECORD_HEADERS を合わせること。

import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { MonpaiRecord, MonthSetting, RecordInput, School, SchoolKind, Status } from './model';
import { SEED_SCHOOLS } from './seed';

type Fail = { ok: false; reason: string };
export type MasterResult = { ok: true; schools: School[]; settings: MonthSetting[]; backend: 'sheet' | 'local' } | Fail;
export type ListResult = { ok: true; items: MonpaiRecord[] } | Fail;
export type SaveResult = { ok: true; item: MonpaiRecord } | Fail;
export type DeleteResult = { ok: true } | Fail;

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
  return !process.env.MONPAI_SCRIPT_URL && process.env.NODE_ENV !== 'production';
}

type Gas = { ok?: boolean; reason?: string; items?: unknown[]; schools?: unknown[]; settings?: unknown[]; item?: Record<string, unknown> };

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

type Local = { schools: School[]; settings: MonthSetting[]; records: MonpaiRecord[] };
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
