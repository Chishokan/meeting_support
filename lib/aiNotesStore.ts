// 「今日の注意点」の AI の一言（3行）の保存・取得。サーバ専用。
//
// AI の一言は 1日1回、全体（すべて＋各校舎）に対してまとめて生成し、その日は変えない
//（保存のたびに書き直すと言うことが日に何度も変わり、担当者が朝に決めた優先順位が揺れるため）。
// 生成した文は台帳スプレッドシートの「AI注意点」タブに日付×対象で残す（Vercel の関数は
// メモリを持ち越せないので、サーバ内キャッシュだけでは「その日は固定」を守れない）。
//
// 本番：Apps Script（apps_script/Code.gs の getDailyAiNotes / saveDailyAiNotes）
// 開発：APPS_SCRIPT_URL が無いときは .data/ai-notes.json（git には入れない）

import { promises as fs } from 'fs';
import path from 'path';
import { callGas, nowJp } from './inquiryStore';

export type AiNote = {
  date: string;        // YYYY-MM-DD（日本時間）
  scope: string;       // 'すべて' か校舎名
  text: string;        // AI の一言（3行）
  generatedAt: string; // 生成日時（YYYY/MM/DD HH:mm）
};

export type NotesResult = { ok: true; notes: AiNote[] } | { ok: false; reason: string };

function useLocal(): boolean {
  return !process.env.APPS_SCRIPT_URL && process.env.NODE_ENV !== 'production';
}

const LOCAL_FILE = path.join(process.cwd(), '.data', 'ai-notes.json');
const KEEP_DAYS = 60;

function toNote(r: Record<string, unknown>): AiNote | null {
  const date = String(r.date ?? r['日付'] ?? '').trim();
  const scope = String(r.scope ?? r['対象'] ?? '').trim();
  const text = String(r.text ?? r['本文'] ?? '').trim();
  const generatedAt = String(r.generatedAt ?? r['生成日時'] ?? '').trim();
  if (!date || !scope || !text) return null;
  return { date, scope, text, generatedAt };
}

async function readLocal(): Promise<AiNote[]> {
  try {
    const j = JSON.parse(await fs.readFile(LOCAL_FILE, 'utf8'));
    return Array.isArray(j) ? (j as Record<string, unknown>[]).map(toNote).filter((n): n is AiNote => !!n) : [];
  } catch {
    return [];
  }
}

/** その日の一言をすべての対象ぶん返す。 */
export async function getAiNotes(date: string): Promise<NotesResult> {
  if (useLocal()) {
    return { ok: true, notes: (await readLocal()).filter((n) => n.date === date) };
  }
  const j = await callGas({ action: 'getDailyAiNotes', date });
  if (!j.ok || !Array.isArray(j.items)) return { ok: false, reason: j.reason || 'upstream_error' };
  const notes = (j.items as Record<string, unknown>[]).map(toNote).filter((n): n is AiNote => !!n && n.date === date);
  return { ok: true, notes };
}

/** 一言を保存する（同じ日付×対象があれば上書き）。 */
export async function saveAiNotes(notes: AiNote[]): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!notes.length) return { ok: true };
  if (useLocal()) {
    const cur = await readLocal();
    const key = (n: AiNote) => `${n.date}|${n.scope}`;
    const incoming = new Set(notes.map(key));
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
    const next = cur.filter((n) => !incoming.has(key(n)) && n.date >= cutoff).concat(notes);
    await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
    await fs.writeFile(LOCAL_FILE, JSON.stringify(next, null, 2), 'utf8');
    return { ok: true };
  }
  const j = await callGas({
    action: 'saveDailyAiNotes',
    notes: notes.map((n) => ({ '日付': n.date, '対象': n.scope, '本文': n.text, '生成日時': n.generatedAt || nowJp() })),
  });
  if (!j.ok) return { ok: false, reason: j.reason || 'upstream_error' };
  return { ok: true };
}
