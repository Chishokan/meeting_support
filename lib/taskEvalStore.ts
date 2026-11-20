// 重要タスク評価のダウンロード（/task-eval）のサーバ側。サーバ専用。
// 一覧：Apps Script の listDriveFolder で評価フォルダの中身を読み、週ごとにまとめる。
// A4版（PDF）：Apps Script の readDriveFile で中身（base64）を受け取る。
// 評価シート（Excel）：Google スプレッドシートの書き出し（export?format=xlsx）をサーバで受けて渡す。
//   評価フォルダは「リンクを知っている全員が閲覧可」なので、サインインなしで書き出せる。

import { callGas } from '@/lib/chishokanAi/gas';
import { findEvalFile, parseEvalFiles, TASK_EVAL_FOLDER_ID, type DriveItem, type EvalWeek } from '@/lib/taskEval';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 15 * 1024 * 1024;
const EXPORT_TIMEOUT_MS = 40_000;

export type ListResult = { ok: true; weeks: EvalWeek[] } | { ok: false; reason: string };

/** 評価フォルダの一覧を週ごとにまとめて返す（新しい週から）。 */
export async function listEvalWeeks(): Promise<ListResult> {
  const r = await callGas({ action: 'listDriveFolder', id: TASK_EVAL_FOLDER_ID });
  if (!r.ok) return { ok: false, reason: r.reason || 'upstream_error' };
  if (!Array.isArray(r.items)) return { ok: false, reason: 'not_deployed' };
  return { ok: true, weeks: parseEvalFiles(r.items as DriveItem[]) };
}

export type FileResult =
  | { ok: true; body: Uint8Array; contentType: string; filename: string }
  | { ok: false; reason: string; status: number };

/** 一覧にあるファイルだけを、決まった形（評価シートは xlsx、A4版は pdf）で取り出す。 */
export async function downloadEvalFile(id: string, format: string): Promise<FileResult> {
  const list = await listEvalWeeks();
  if (!list.ok) return { ok: false, reason: list.reason, status: 502 };
  const hit = findEvalFile(list.weeks, id, format);
  if (!hit) return { ok: false, reason: 'not_found', status: 404 };

  if (hit.format === 'pdf') {
    const r = await callGas({ action: 'readDriveFile', id: hit.file.id });
    if (!r.ok) return { ok: false, reason: r.reason || 'upstream_error', status: 502 };
    if (r.kind !== 'pdf' || typeof r.base64 !== 'string') return { ok: false, reason: 'bad_file', status: 502 };
    return { ok: true, body: new Uint8Array(Buffer.from(r.base64, 'base64')), contentType: 'application/pdf', filename: hit.filename };
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), EXPORT_TIMEOUT_MS);
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(hit.file.id)}/export?format=xlsx`, {
      cache: 'no-store', redirect: 'follow', signal: ctl.signal,
    });
    const type = res.headers.get('content-type') ?? '';
    // 共有が外れているとサインイン画面（HTML）が返るので、xlsx の形で返ったときだけ渡す
    if (!res.ok || !type.includes('spreadsheetml')) return { ok: false, reason: 'export_failed', status: 502 };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return { ok: false, reason: 'too_large', status: 502 };
    return { ok: true, body: buf, contentType: XLSX_TYPE, filename: hit.filename };
  } catch {
    return { ok: false, reason: ctl.signal.aborted ? 'timeout' : 'export_failed', status: 502 };
  } finally {
    clearTimeout(timer);
  }
}
