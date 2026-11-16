// 本番レベル模試（/moshi）の保存・取得。サーバ専用（API ルートからだけ使う）。
//
// 本番：Apps Script（apps_script/Code.gs の listMoshi / saveMoshiExam / deleteMoshiExam / saveMoshiResults /
//       deleteMoshiResults）経由で、スプレッドシート「本番レベル模試 成績」を読み書きする。
// 開発：APPS_SCRIPT_URL が無いときは .data/moshi.json に保存する（git には入れない）。
//       Vercel 本番でスクリプト未設定なら not_configured を返し、画面に「未設定」と出す。
//
// 成績の保存は「この保存で変えた列」（fields）だけを書く。同じ生徒の国語と数学を別の先生が同時に入れても消えない。

import { promises as fs } from 'fs';
import path from 'path';
import {
  SUBJECT_KEYS, SUBJECT_NAMES, fitScores, normalizeGender, scoresFromCell, scoresToCell, subjectOf,
  type ExamSubject, type MoshiExam, type MoshiResult, type ResultInput, type ScheduleRow, type SubjectKey,
} from './model';

export type MoshiData = { exams: MoshiExam[]; results: MoshiResult[]; fetchedAt: string; backend: 'sheet' | 'local' };
export type Fail = { ok: false; reason: string };

// 画面から送る「変えた項目」の名前 → シートの見出し
export type ResultField = 'campus' | 'examNo' | 'name' | 'gender' | 'choices' | 'comment' | SubjectKey;
export const RESULT_FIELDS: ResultField[] = ['campus', 'examNo', 'name', 'gender', 'choices', 'comment', ...SUBJECT_KEYS];

const CHOICE_HEADERS = ['第一志望', '第二志望', '第三志望', '第四志望'];
const FIELD_HEADERS: Record<ResultField, string[]> = {
  campus: ['校舎'], examNo: ['受験番号'], name: ['氏名'], gender: ['性別'], choices: CHOICE_HEADERS, comment: ['コメント'],
  ja: ['国語'], en: ['英語'], ma: ['数学'], so: ['社会'], sc: ['理科'],
};

// ---- 共通 ---------------------------------------------------------------

export function nowJp(): string {
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

type Gas = Record<string, unknown> & { ok?: boolean; reason?: string; saved?: string };

async function callGas(payload: Record<string, unknown>): Promise<Gas> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 50_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: process.env.APPS_SCRIPT_TOKEN || '', ...payload }),
      cache: 'no-store',
      signal: ctl.signal,
    });
    const j = (await res.json().catch(() => null)) as Gas | null;
    if (!res.ok || !j) return { ok: false, reason: 'upstream_error' };
    // 再デプロイ前の Apps Script は、知らない action を会話ログに書いて { ok:true } だけを返す。印が無ければ保存されていない
    if (j.ok && !String(j.saved ?? '').startsWith('moshi')) return { ok: false, reason: 'not_deployed' };
    return j;
  } catch {
    return { ok: false, reason: ctl.signal.aborted ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

// ---- シートの行 ⇄ 型 -------------------------------------------------------

type ExamSettings = Pick<MoshiExam, 'subjects' | 'schedule' | 'belongings' | 'notes' | 'venues'>;

export function examFromSheet(o: Record<string, unknown>): MoshiExam {
  let cfg: Partial<ExamSettings> = {};
  try { cfg = JSON.parse(String(o['設定'] ?? '') || '{}'); } catch { cfg = {}; }
  const subjects: ExamSubject[] = SUBJECT_KEYS.map((k) => {
    const s = (cfg.subjects ?? []).find((x) => x?.key === k);
    return { key: k, questions: (s?.questions ?? []).map((q) => ({ max: Number(q?.max) || 0, topic: String(q?.topic ?? '') })) };
  });
  return {
    id: String(o['ID'] ?? ''),
    name: String(o['模試名'] ?? ''),
    grade: String(o['学年'] ?? ''),
    date: String(o['実施日'] ?? ''),
    subjects,
    schedule: Array.isArray(cfg.schedule) ? (cfg.schedule as ScheduleRow[]).map((r) => ({ label: String(r?.label ?? ''), time: String(r?.time ?? '') })) : [],
    belongings: String(cfg.belongings ?? ''),
    notes: String(cfg.notes ?? ''),
    venues: cfg.venues && typeof cfg.venues === 'object' ? { ...cfg.venues } : {},
    createdAt: String(o['作成日時'] ?? ''), createdBy: String(o['作成者'] ?? ''),
    updatedAt: String(o['更新日時'] ?? ''), updatedBy: String(o['更新者'] ?? ''),
  };
}

function examToSheet(e: MoshiExam): Record<string, string> {
  const cfg: ExamSettings = { subjects: e.subjects, schedule: e.schedule, belongings: e.belongings, notes: e.notes, venues: e.venues };
  return {
    ID: e.id, 模試名: e.name, 学年: e.grade, 実施日: e.date, 設定: JSON.stringify(cfg),
    作成日時: e.createdAt, 作成者: e.createdBy, 更新日時: e.updatedAt, 更新者: e.updatedBy,
  };
}

export function resultFromSheet(o: Record<string, unknown>, exam: MoshiExam | undefined): MoshiResult {
  const scores = {} as MoshiResult['scores'];
  for (const k of SUBJECT_KEYS) {
    const n = exam ? subjectOf(exam, k).questions.length : String(o[SUBJECT_NAMES[k]] ?? '').split(',').length;
    scores[k] = scoresFromCell(o[SUBJECT_NAMES[k]], n);
  }
  return {
    id: String(o['ID'] ?? ''),
    examId: String(o['模試ID'] ?? ''),
    campus: String(o['校舎'] ?? ''),
    examNo: String(o['受験番号'] ?? ''),
    name: String(o['氏名'] ?? ''),
    gender: normalizeGender(o['性別']),
    choices: CHOICE_HEADERS.map((h) => String(o[h] ?? '')),
    scores,
    comment: String(o['コメント'] ?? ''),
    createdAt: String(o['作成日時'] ?? ''), createdBy: String(o['作成者'] ?? ''),
    updatedAt: String(o['更新日時'] ?? ''), updatedBy: String(o['更新者'] ?? ''),
  };
}

function resultToSheet(r: ResultInput): Record<string, string> {
  const o: Record<string, string> = {
    ID: r.id, 模試ID: r.examId, 校舎: r.campus, 受験番号: r.examNo, 氏名: r.name, 性別: r.gender, コメント: r.comment,
  };
  CHOICE_HEADERS.forEach((h, i) => { o[h] = r.choices[i] ?? ''; });
  for (const k of SUBJECT_KEYS) o[SUBJECT_NAMES[k]] = scoresToCell(r.scores[k] ?? []);
  return o;
}

// ---- 開発用ローカル保存 ---------------------------------------------------

const LOCAL_FILE = path.join(process.cwd(), '.data', 'moshi.json');
type LocalDb = { exams: MoshiExam[]; results: (MoshiResult & { deleted?: boolean })[] };

async function readLocal(): Promise<LocalDb> {
  try {
    const j = JSON.parse(await fs.readFile(LOCAL_FILE, 'utf8')) as Partial<LocalDb> & { exams?: (MoshiExam & { deleted?: boolean })[] };
    return { exams: Array.isArray(j.exams) ? j.exams : [], results: Array.isArray(j.results) ? j.results : [] };
  } catch {
    return { exams: [], results: [] };
  }
}

async function writeLocal(db: LocalDb): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// ---- 公開 API ------------------------------------------------------------

export async function loadAll(): Promise<({ ok: true } & MoshiData) | Fail> {
  if (useLocal()) {
    const db = await readLocal();
    const exams = (db.exams as (MoshiExam & { deleted?: boolean })[]).filter((e) => !e.deleted);
    const byId = new Map(exams.map((e) => [e.id, e]));
    const results = db.results.filter((r) => !r.deleted && byId.has(r.examId)).map(({ deleted: _d, ...r }) => ({ ...r, scores: fitScores(byId.get(r.examId)!, r.scores) }));
    return { ok: true, exams: exams.map(({ deleted: _d, ...e }) => e as MoshiExam), results, fetchedAt: nowJp(), backend: 'local' };
  }
  const j = await callGas({ action: 'listMoshi' });
  if (!j.ok || !Array.isArray(j.exams) || !Array.isArray(j.results)) return { ok: false, reason: j.reason || 'upstream_error' };
  const exams = (j.exams as Record<string, unknown>[]).map(examFromSheet).filter((e) => e.id);
  const byId = new Map(exams.map((e) => [e.id, e]));
  const results = (j.results as Record<string, unknown>[])
    .map((o) => resultFromSheet(o, byId.get(String(o['模試ID'] ?? ''))))
    .filter((r) => r.id && byId.has(r.examId));
  return { ok: true, exams, results, fetchedAt: String(j.fetchedAt ?? nowJp()), backend: 'sheet' };
}

export async function saveExam(exam: MoshiExam, user: string): Promise<{ ok: true; exam: MoshiExam } | Fail> {
  const ts = nowJp();
  if (useLocal()) {
    const db = await readLocal();
    const i = db.exams.findIndex((e) => e.id === exam.id);
    const cur = i === -1 ? null : db.exams[i];
    const next: MoshiExam = { ...exam, createdAt: cur?.createdAt || ts, createdBy: cur?.createdBy || user, updatedAt: ts, updatedBy: user };
    if (i === -1) db.exams.push(next); else db.exams[i] = next;
    await writeLocal(db);
    return { ok: true, exam: next };
  }
  const j = await callGas({ action: 'saveMoshiExam', user, exam: examToSheet({ ...exam, updatedBy: user }) });
  if (!j.ok || !j.item) return { ok: false, reason: j.reason || 'upstream_error' };
  return { ok: true, exam: examFromSheet(j.item as Record<string, unknown>) };
}

export async function deleteExam(id: string, user: string): Promise<{ ok: true } | Fail> {
  if (useLocal()) {
    const db = await readLocal();
    const e = db.exams.find((x) => x.id === id) as (MoshiExam & { deleted?: boolean }) | undefined;
    if (!e) return { ok: false, reason: 'not_found' };
    e.deleted = true;
    e.updatedAt = nowJp();
    e.updatedBy = user;
    await writeLocal(db);
    return { ok: true };
  }
  const j = await callGas({ action: 'deleteMoshiExam', id, user });
  return j.ok ? { ok: true } : { ok: false, reason: j.reason || 'upstream_error' };
}

export type SaveRow = { value: ResultInput; fields: ResultField[] | null }; // fields が null なら行まるごと

export async function saveResults(exam: MoshiExam, rows: SaveRow[], user: string): Promise<{ ok: true; items: MoshiResult[] } | Fail> {
  const ts = nowJp();
  if (useLocal()) {
    const db = await readLocal();
    const items: MoshiResult[] = [];
    for (const { value, fields } of rows) {
      const i = db.results.findIndex((r) => r.id === value.id);
      if (i !== -1 && db.results[i].deleted) continue;
      if (i === -1) {
        const next: MoshiResult = { ...value, createdAt: ts, createdBy: user, updatedAt: ts, updatedBy: user };
        db.results.push(next);
        items.push(next);
        continue;
      }
      const cur = db.results[i];
      const next: MoshiResult = { ...cur, scores: { ...cur.scores }, updatedAt: ts, updatedBy: user };
      for (const f of fields ?? RESULT_FIELDS) {
        if ((SUBJECT_KEYS as readonly string[]).includes(f)) next.scores[f as SubjectKey] = value.scores[f as SubjectKey];
        else (next as unknown as Record<string, unknown>)[f] = (value as unknown as Record<string, unknown>)[f];
      }
      db.results[i] = next;
      items.push(next);
    }
    await writeLocal(db);
    return { ok: true, items };
  }
  const payload = rows.map(({ value, fields }) => ({
    record: resultToSheet(value),
    fields: fields ? fields.flatMap((f) => FIELD_HEADERS[f] ?? []) : null,
  }));
  const j = await callGas({ action: 'saveMoshiResults', user, rows: payload });
  if (!j.ok || !Array.isArray(j.items)) return { ok: false, reason: j.reason || 'upstream_error' };
  return { ok: true, items: (j.items as Record<string, unknown>[]).map((o) => resultFromSheet(o, exam)) };
}

export async function deleteResults(ids: string[], user: string): Promise<{ ok: true } | Fail> {
  if (useLocal()) {
    const db = await readLocal();
    for (const r of db.results) if (ids.includes(r.id)) { r.deleted = true; r.updatedAt = nowJp(); r.updatedBy = user; }
    await writeLocal(db);
    return { ok: true };
  }
  const j = await callGas({ action: 'deleteMoshiResults', ids, user });
  return j.ok ? { ok: true } : { ok: false, reason: j.reason || 'upstream_error' };
}
