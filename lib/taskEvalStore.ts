// 重要タスク評価のダウンロード（/task-eval）のサーバ側。サーバ専用。
// 一覧：Apps Script の listDriveFolder で評価フォルダの中身を読み、週ごとの A4版（PDF）にまとめる。
// PDF：Apps Script の readDriveFile で中身（base64）を受け取る。

import { callGas } from '@/lib/chishokanAi/gas';
import { findEvalFile, parseEvalFiles, TASK_EVAL_FOLDER_ID, type DriveItem, type EvalWeek } from '@/lib/taskEval';

export type ListResult = { ok: true; weeks: EvalWeek[] } | { ok: false; reason: string };

/** 評価フォルダの A4版を週ごとにまとめて返す（新しい週から）。 */
export async function listEvalWeeks(): Promise<ListResult> {
  const r = await callGas({ action: 'listDriveFolder', id: TASK_EVAL_FOLDER_ID });
  if (!r.ok) return { ok: false, reason: r.reason || 'upstream_error' };
  if (!Array.isArray(r.items)) return { ok: false, reason: 'not_deployed' };
  return { ok: true, weeks: parseEvalFiles(r.items as DriveItem[]) };
}

export type FileResult = { ok: true; body: Uint8Array; filename: string } | { ok: false; reason: string; status: number };

/** 一覧にある A4版（PDF）だけを取り出す。 */
export async function downloadEvalPdf(id: string): Promise<FileResult> {
  const list = await listEvalWeeks();
  if (!list.ok) return { ok: false, reason: list.reason, status: 502 };
  const file = findEvalFile(list.weeks, id);
  if (!file) return { ok: false, reason: 'not_found', status: 404 };
  const r = await callGas({ action: 'readDriveFile', id: file.id });
  if (!r.ok) return { ok: false, reason: r.reason || 'upstream_error', status: 502 };
  if (r.kind !== 'pdf' || typeof r.base64 !== 'string') return { ok: false, reason: 'bad_file', status: 502 };
  return { ok: true, body: new Uint8Array(Buffer.from(r.base64, 'base64')), filename: file.name };
}
