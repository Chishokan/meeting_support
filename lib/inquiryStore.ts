// 問合せ管理（/inquiry-board）の保存・取得。サーバ専用。
//
// 本番：Apps Script（apps_script/Code.gs の listInquiryRecords / saveInquiryRecord / deleteInquiryRecord）
//       経由でスプレッドシート「問合せ台帳」を読み書きする。
// 開発：APPS_SCRIPT_URL が無いときは .data/inquiry-board.json に保存する（git には入れない）。
//       Vercel 本番でスクリプト未設定なら not_configured を返し、画面に「未設定」と出す。
//
// ★列を増やしたら lib/inquiryRecords.ts の RECORD_FIELDS と Code.gs の INQUIRY_DB_HEADERS を合わせること。

import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  RECORD_FIELDS, UNASSIGNED_CAMPUS, applyPatch, editPatch, normalizeCampus,
  type InquiryInput, type InquiryRecord,
} from './inquiryRecords';

export type ListResult =
  | { ok: true; items: InquiryRecord[]; fetchedAt: string; backend: 'sheet' | 'local' }
  | { ok: false; reason: string };
export type SaveResult =
  | { ok: true; item: InquiryRecord }
  // reason が 'conflict' のときは、いまの行（item）と衝突した項目（conflicts）が付く
  | { ok: false; reason: string; item?: InquiryRecord; conflicts?: (keyof InquiryInput)[] };
export type DeleteResult = { ok: true } | { ok: false; reason: string };

// ---- 共通 ---------------------------------------------------------------

export function nowJp(): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}/${g('month')}/${g('day')} ${g('hour')}:${g('minute')}`;
}

/** 見出し名キーのオブジェクト（シートの1行）→ InquiryRecord。 */
export function fromSheetRow(r: Record<string, unknown>): InquiryRecord {
  const out: Record<string, unknown> = {};
  for (const f of RECORD_FIELDS) {
    const v = r?.[f.header];
    out[f.key] = f.key === 'no' ? Number(v ?? 0) || 0 : v == null ? '' : String(v).trim();
  }
  // 旧シートから移した行の「県中対策」は「県中」として扱う
  out.campus = normalizeCampus(String(out.campus ?? '')) || UNASSIGNED_CAMPUS;
  return out as InquiryRecord;
}

/** InquiryRecord → 見出し名キーのオブジェクト（Apps Script へ渡す形）。 */
export function toSheetRow(r: InquiryRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of RECORD_FIELDS) out[f.header] = r[f.key];
  return out;
}

function useLocal(): boolean {
  return !process.env.APPS_SCRIPT_URL && process.env.NODE_ENV !== 'production';
}

// ---- Apps Script ---------------------------------------------------------

export type GasResult = { ok?: boolean; reason?: string; items?: unknown[]; item?: Record<string, unknown>; conflicts?: string[]; fetchedAt?: string };

/** Apps Script を叩く共通口。lib/aiNotesStore.ts など台帳以外の保存もここを通る。 */
export async function callGas(payload: Record<string, unknown>): Promise<GasResult> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: process.env.APPS_SCRIPT_TOKEN || '', ...payload }),
      cache: 'no-store',
    });
    const j = (await res.json().catch(() => null)) as GasResult | null;
    if (!res.ok || !j) return { ok: false, reason: 'upstream_error' };
    return j;
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

// ---- 開発用ローカル保存 ---------------------------------------------------

const LOCAL_FILE = path.join(process.cwd(), '.data', 'inquiry-board.json');

async function readLocal(): Promise<InquiryRecord[]> {
  try {
    const raw = await fs.readFile(LOCAL_FILE, 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j) ? (j as InquiryRecord[]).map((r) => ({ ...r, campus: normalizeCampus(r.campus) || UNASSIGNED_CAMPUS })) : [];
  } catch {
    return [];
  }
}

async function writeLocal(rows: InquiryRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(rows, null, 2), 'utf8');
}

function nextNo(rows: InquiryRecord[], campus: string): number {
  return rows.filter((r) => r.campus === campus).reduce((m, r) => Math.max(m, r.no || 0), 0) + 1;
}

// ---- 公開 API ------------------------------------------------------------

export async function listRecords(): Promise<ListResult> {
  if (useLocal()) {
    return { ok: true, items: await readLocal(), fetchedAt: nowJp(), backend: 'local' };
  }
  const j = await callGas({ action: 'listInquiryRecords' });
  if (!j.ok || !Array.isArray(j.items)) return { ok: false, reason: j.reason || 'upstream_error' };
  const items = (j.items as Record<string, unknown>[]).map(fromSheetRow).filter((r) => r.id);
  return { ok: true, items, fetchedAt: String(j.fetchedAt ?? nowJp()), backend: 'sheet' };
}

export async function createRecord(input: InquiryInput, user: string): Promise<SaveResult> {
  const ts = nowJp();
  const base: InquiryRecord = {
    ...input,
    id: randomUUID(),
    no: input.no ?? 0,
    createdAt: ts, createdBy: user, updatedAt: ts, updatedBy: user,
  };
  if (useLocal()) {
    const rows = await readLocal();
    if (!base.no) base.no = nextNo(rows, base.campus);
    rows.push(base);
    await writeLocal(rows);
    return { ok: true, item: base };
  }
  // No. の採番は Apps Script 側（LockService で同時登録の重複を防ぐ）。
  const j = await callGas({ action: 'saveInquiryRecord', record: toSheetRow(base) });
  if (!j.ok || !j.item) return { ok: false, reason: j.reason || 'upstream_error' };
  return { ok: true, item: fromSheetRow(j.item) };
}

/**
 * 更新。base（画面で編集を始めた時点の行）を渡すと、この保存で変えた項目だけを書く
 * （開いたあとに他の人が直した項目を消さない。同じ項目を別の値に直していたら reason:'conflict'）。
 * base が無いとき（HP フォームの取り込み・重複の統合）は従来どおり行まるごと書く。
 */
export async function updateRecord(
  id: string, input: InquiryInput, user: string,
  opts: { base?: InquiryRecord | null; fallbackYear?: number } = {},
): Promise<SaveResult> {
  const ts = nowJp();
  const edit = opts.base ? editPatch(opts.base, input, opts.fallbackYear ?? new Date().getFullYear()) : null;
  if (useLocal()) {
    const rows = await readLocal();
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return { ok: false, reason: 'not_found' };
    const cur = rows[i];
    let next: InquiryRecord;
    if (edit) {
      if (!Object.keys(edit.patch).length) return { ok: true, item: cur };
      const r = applyPatch(cur, edit.patch, edit.expect);
      if (!r.ok) return { ok: false, reason: 'conflict', item: cur, conflicts: r.conflicts };
      next = { ...r.next, updatedAt: ts, updatedBy: user };
      if (next.campus !== cur.campus && edit.patch.no == null) next.no = nextNo(rows, next.campus);
    } else {
      next = {
        ...cur, ...input, id,
        no: input.no ?? cur.no,
        updatedAt: ts, updatedBy: user,
      };
      if (next.campus !== cur.campus && input.no == null) next.no = nextNo(rows, next.campus);
    }
    rows[i] = next;
    await writeLocal(rows);
    return { ok: true, item: next };
  }
  const rec: InquiryRecord = {
    ...input, id, no: input.no ?? 0,
    createdAt: '', createdBy: '', updatedAt: ts, updatedBy: user,
  };
  // record は行まるごと（patch を知らない古い Apps Script でも今までどおり保存できるように残す）。
  // patch・expect があれば、新しい Apps Script は変えた項目だけを書き、衝突なら conflict を返す。
  const j = await callGas({
    action: 'saveInquiryRecord',
    record: toSheetRow(rec),
    ...(edit ? { patch: headerKeyed(edit.patch), expect: headerKeyed(edit.expect) } : {}),
  });
  if (j.reason === 'conflict' && j.item) {
    const conflicts = (j.conflicts ?? [])
      .map((h) => RECORD_FIELDS.find((f) => f.header === h)?.key)
      .filter((k): k is keyof InquiryInput => !!k && k !== 'id');
    return { ok: false, reason: 'conflict', item: fromSheetRow(j.item), conflicts };
  }
  if (!j.ok || !j.item) return { ok: false, reason: j.reason || 'upstream_error' };
  return { ok: true, item: fromSheetRow(j.item) };
}

/** { result: '入塾' } → { '結果': '入塾' }（Apps Script は見出し名で列を引く）。 */
function headerKeyed(o: Partial<Record<keyof InquiryRecord, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of RECORD_FIELDS) if (f.key in o) out[f.header] = o[f.key];
  return out;
}

export async function deleteRecord(id: string, user: string): Promise<DeleteResult> {
  if (useLocal()) {
    const rows = await readLocal();
    const next = rows.filter((r) => r.id !== id);
    if (next.length === rows.length) return { ok: false, reason: 'not_found' };
    await writeLocal(next);
    return { ok: true };
  }
  const j = await callGas({ action: 'deleteInquiryRecord', id, user });
  if (!j.ok) return { ok: false, reason: j.reason || 'upstream_error' };
  return { ok: true };
}
