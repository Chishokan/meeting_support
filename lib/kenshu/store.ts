// 全体研修会アンケート（/kenshu）の回答の保存・取得。サーバ専用。
//
// 本番：Apps Script（apps_script/Code.gs の getKenshuAnswer / saveKenshuAnswer）経由で
//       スプレッドシート「研修会アンケート」に1人1行（研修会×部門×氏名）で保存する。送り直すと上書き。
// 開発：APPS_SCRIPT_URL が無いときは .data/kenshu.json に保存する（git には入れない）。
//       Vercel 本番でスクリプト未設定なら not_configured を返し、画面に「保存先が未設定」と出す。

import { promises as fs } from 'fs';
import path from 'path';
import { cleanItems } from './survey';

export type KenshuAnswer = {
  work: string[];
  life: string[];
  submittedAt: string; // 最初に提出した日時（YYYY/MM/DD HH:mm）
  updatedAt: string;   // 最後に提出し直した日時（初回は空）
};
export type GetResult = { ok: true; answer: KenshuAnswer | null } | { ok: false; reason: string };
export type SaveResult = { ok: true; answer: KenshuAnswer } | { ok: false; reason: string };

type Who = { survey: string; campus: string; user: string };

function nowJp(): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}/${g('month')}/${g('day')} ${g('hour')}:${g('minute')}`;
}

function useLocal(): boolean {
  return !process.env.APPS_SCRIPT_URL && process.env.NODE_ENV !== 'production';
}

function toAnswer(r: unknown): KenshuAnswer | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  return {
    work: cleanItems(o.work),
    life: cleanItems(o.life),
    submittedAt: String(o.submittedAt ?? ''),
    updatedAt: String(o.updatedAt ?? ''),
  };
}

// ---- Apps Script ---------------------------------------------------------

async function callGas(payload: Record<string, unknown>): Promise<{ ok?: boolean; reason?: string; item?: unknown }> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: process.env.APPS_SCRIPT_TOKEN || '', ...payload }),
      cache: 'no-store',
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j) return { ok: false, reason: 'upstream_error' };
    return j;
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

// ---- 開発用ローカル保存 ---------------------------------------------------

const LOCAL_FILE = path.join(process.cwd(), '.data', 'kenshu.json');
type LocalRow = Who & KenshuAnswer;

async function readLocal(): Promise<LocalRow[]> {
  try {
    const j = JSON.parse(await fs.readFile(LOCAL_FILE, 'utf8'));
    return Array.isArray(j) ? (j as LocalRow[]) : [];
  } catch {
    return [];
  }
}

async function writeLocal(rows: LocalRow[]): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(rows, null, 2), 'utf8');
}

const same = (a: Who, b: Who) => a.survey === b.survey && a.campus === b.campus && a.user === b.user;

// ---- 公開 API ------------------------------------------------------------

/** 自分の回答（まだ出していなければ null）。 */
export async function getAnswer(who: Who): Promise<GetResult> {
  if (useLocal()) {
    const row = (await readLocal()).find((r) => same(r, who));
    return { ok: true, answer: row ? toAnswer(row) : null };
  }
  const j = await callGas({ action: 'getKenshuAnswer', ...who });
  if (!j.ok) return { ok: false, reason: j.reason || 'upstream_error' };
  return { ok: true, answer: toAnswer(j.item) };
}

/** 回答を保存する。同じ人の回答があれば上書きし、最初の提出日時は残す。 */
export async function saveAnswer(who: Who, work: string[], life: string[]): Promise<SaveResult> {
  if (useLocal()) {
    const rows = await readLocal();
    const i = rows.findIndex((r) => same(r, who));
    const ts = nowJp();
    const row: LocalRow = i >= 0
      ? { ...rows[i], work, life, updatedAt: ts }
      : { ...who, work, life, submittedAt: ts, updatedAt: '' };
    if (i >= 0) rows[i] = row; else rows.push(row);
    await writeLocal(rows);
    return { ok: true, answer: toAnswer(row)! };
  }
  const j = await callGas({ action: 'saveKenshuAnswer', ...who, work, life });
  const answer = j.ok ? toAnswer(j.item) : null;
  if (!answer) return { ok: false, reason: j.reason || 'upstream_error' };
  return { ok: true, answer };
}
