// AI壁打ち（/task-coach）の読み書き。サーバ専用。すべて Apps Script（APPS_SCRIPT_URL）経由。
//   getTaskEvaluation  … 重要タスク評価シート（apps_script/Code.gs の TASK_EVAL_BOOK_ID）の校舎タブを読む
//   appendPlanActions  … 秋～冬行動計画（GOALS_BOOK_ID）の該当セルに「★行動」を書き足す（今ある文は消さない）
// 再デプロイ前の Apps Script は未知の action を会話ログに書いて ok を返すので、返り値の印が無ければ未対応として扱う。

import { parseEvaluation, type PlanAction, type TaskEvaluation } from './taskCoach';

type GasResult = Record<string, unknown> & { ok?: boolean; reason?: string };

async function callGas(payload: Record<string, unknown>): Promise<GasResult> {
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

// 会話の1往復ごとに評価シートを読みに行かないよう、校舎ごとに少しの間だけ覚えておく。
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; ev: TaskEvaluation }>();

export async function getEvaluation(school: string, fresh = false):
  Promise<{ ok: true; evaluation: TaskEvaluation } | { ok: false; reason: string }> {
  const hit = cache.get(school);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return { ok: true, evaluation: hit.ev };
  const j = await callGas({ action: 'getTaskEvaluation', school });
  if (!j.ok) return { ok: false, reason: j.reason || 'upstream_error' };
  if (!Array.isArray(j.rows)) return { ok: false, reason: 'not_deployed' };
  const ev = parseEvaluation((j.rows as unknown[][]).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [])));
  if (!ev) return { ok: false, reason: 'no_evaluation' };
  cache.set(school, { at: Date.now(), ev });
  return { ok: true, evaluation: ev };
}

export type WriteResult = { date: string; kind: string; text: string; status: 'written' | 'skipped' | 'not_found'; cell?: string };

export async function appendPlan(school: string, actions: PlanAction[], who: { campus: string; user: string }):
  Promise<{ ok: true; results: WriteResult[] } | { ok: false; reason: string }> {
  const j = await callGas({
    action: 'appendPlanActions', school, campus: who.campus, user: who.user, ts: new Date().toISOString(),
    actions: actions.map((a) => ({ date: a.date, kind: a.kind, text: a.text })),
  });
  if (!j.ok) return { ok: false, reason: j.reason || 'upstream_error' };
  if (j.saved !== 'planActions' || !Array.isArray(j.results)) return { ok: false, reason: 'not_deployed' };
  return { ok: true, results: j.results as WriteResult[] };
}
