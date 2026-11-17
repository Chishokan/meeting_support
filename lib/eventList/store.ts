// イベント申込管理（/event）の読み込みと保存。サーバ専用（API ルートからだけ使う）。
// ★画面と API は、このファイルの公開 API（loadAll・saveTracks）だけを使う。
//
// 保存先は次の順で選ぶ：
//   1. イベント申込管理専用の Apps Script（EVENT_SCRIPT_URL / EVENT_SCRIPT_TOKEN）… apps_script/event.gs
//      - 名簿           … 名簿のスプレッドシート（「中等部名簿」）の、見出しに「生徒名」がある全部のタブ。読むだけ
//      - 声掛けの記録   … 同じファイルのタブ「イベント声掛け記録」（生徒1人につき1行。変えた項目だけ書く）
//      - 申込           … Google フォームの回答のスプレッドシート。読むだけ
//   2. 手元の開発だけ：.data/event.json（git には入れない）。無ければ架空の名簿で始まる。
//      Vercel でスクリプト未設定なら not_configured を返し、画面に「未設定」と出す

import { promises as fs } from 'fs';
import path from 'path';
import { EVENT, NO_CAMPUS, ROSTER_COLUMNS } from './event';
import {
  TRACK_HEADERS, parseApplications, parseRoster, trackFromSheet,
  type Application, type Student, type Track, type TrackField,
} from './model';

export type Fail = { ok: false; reason: string };
// formStatus：ok＝回答を読めた／not_set＝フォームの回答のスプレッドシートが未設定／error＝開けなかった
export type EventData = {
  ok: true;
  students: Student[];
  tracks: Track[];
  applications: Application[];
  formStatus: 'ok' | 'not_set' | 'error';
  fetchedAt: string;
  backend: 'sheet' | 'local';
};
export type TrackSave = { key: string; campus: string; name: string; fields: Partial<Record<TrackField, string>> };
export type SaveResult = { ok: true; tracks: Track[] } | Fail;

type SheetRow = Record<string, unknown>;
type FormSheet = { headers: string[]; rows: unknown[][] };

export function nowJp(): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}/${g('month')}/${g('day')} ${g('hour')}:${g('minute')}`;
}

function useLocal(): boolean {
  return !process.env.EVENT_SCRIPT_URL && process.env.NODE_ENV !== 'production';
}

// ---- Apps Script ----------------------------------------------------------

type Gas = Record<string, unknown> & { ok?: boolean; reason?: string; saved?: string };

async function callGas(payload: Record<string, unknown>): Promise<Gas> {
  const url = process.env.EVENT_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 50_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: process.env.EVENT_SCRIPT_TOKEN || '', eventId: EVENT.id, ...payload }),
      cache: 'no-store',
      signal: ctl.signal,
    });
    const j = (await res.json().catch(() => null)) as Gas | null;
    if (!res.ok || !j) return { ok: false, reason: 'upstream_error' };
    if (j.reason === 'invalid_token') return { ok: false, reason: 'invalid_token' };
    // 別の Apps Script（会議DX・成績管理のもの）を指している・古いコードのままのときは、印（saved:'event…'）が無い
    if (j.reason === 'unknown_action' || (j.ok && !String(j.saved ?? '').startsWith('event'))) return { ok: false, reason: 'not_deployed' };
    return j;
  } catch {
    return { ok: false, reason: ctl.signal.aborted ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

// ---- 手元の開発用 ----------------------------------------------------------

const LOCAL_FILE = path.join(process.cwd(), '.data', 'event.json');
type LocalData = { roster: SheetRow[]; tracks: SheetRow[]; form: FormSheet | null };

// 架空の名簿（手元で画面を確かめるためだけのもの。実在の生徒ではない）
function sampleData(): LocalData {
  const C = ROSTER_COLUMNS;
  const row = (i: number, campus: string, school: string, grade: string, name: string, dream: string, hope: string): SheetRow => ({
    [C.no]: String(i), [C.campus]: campus, [C.school]: school, [C.grade]: grade, [C.name]: name, [C.dream]: dream, [C.hope]: hope,
    [C.studentId]: `X${String(i).padStart(3, '0')}`,
  });
  const src: [string, string, string, string, string, string][] = [
    ['駅前校', '山澄', '中１', '見本 あおい', '薬剤師', '佐世保北'], ['駅前校', '祇園', '中１', '見本 はると', '医者', '佐世保北'],
    ['駅前校', '清水', '中２', '見本 ゆい', '小学校の先生', '佐世保南'], ['駅前校', '福石', '中２', '見本 そうた', '工学系', '佐世保高専'],
    ['駅前校', '崎辺', '中３', '見本 りお', 'ＣＡまたは薬剤師', '佐世保北'], ['駅前校', '山澄', '中３', '見本 かいと', '未定', '佐世保工業'],
    ['駅前校', '祇園', '中３', '見本 みお', '看護師', '九文（衛生看護）'],
    ['日野校', '日野', '中１', '例示 ひなた', '救急救命士', '佐世保西'], ['日野校', '相浦', '中２', '例示 れん', 'サッカーに携わる仕事', '国見'],
    ['日野校', '愛宕', '中３', '例示 さき', '薬剤師、医療系', '佐世保西'], ['日野校', '日野', '中３', '例示 だいち', '数学の教師', '佐世保西'],
    ['日野校', '日野', '中３', '例示 まほ', 'イラストレーター', '佐世保西'],
    ['大野校', '大野', '中１', '架空 こはる', '研究者', '佐世保北'], ['大野校', '中里', '中３', '架空 ゆうと', '薬剤師', '佐世保西'],
    ['大野校', '世知原', '中３', '架空 りん', '内科医', '西高・北高'], ['大野校', '大野', '中３', '架空 しょう', 'ゲーム業界', '佐世保工業'],
    ['日宇校', '日宇', '中１', '仮名 つむぎ', 'パン屋さん', '佐世保南'], ['日宇校', '日宇', '中２', '仮名 あさひ', '理学療法士', '佐世保南'],
    ['日宇校', '日宇', '中２', '仮名 めい', '看護師', '南か九文看護'], ['日宇校', '日宇', '中３', '仮名 そら', 'ラーメン屋', '鹿町'],
    ['県中', '佐世保北', '中１', '試作 かりん', '薬剤師', '九大　薬'], ['県中', '佐世保北', '中１', '試作 とき', '決まっていない', '決まっていない'],
    ['県中', '佐世保北', '中１', '試作 うた', '作曲家', '決まっていない'],
  ];
  return {
    roster: src.map((x, i) => row(i + 1, ...x)),
    tracks: [],
    form: {
      headers: ['タイムスタンプ', '生徒氏名', 'ふりがな', '学年', '校舎', '保護者の参加人数', '保護者氏名', '電話番号'],
      rows: [
        ['2026/11/16 20:15:02', '見本　あおい', 'みほん あおい', '中１', '佐世保駅前校', '1', '見本 保護者', '000-0000-0000'],
        ['2026/11/17 08:02:44', '例示 さき', 'れいじ さき', '中３', '日野校', '0', '', '000-0000-0001'],
        ['2026/11/17 12:30:10', '外部 たろう', 'がいぶ たろう', '高１', '', '0', '', '000-0000-0002'],
      ],
    },
  };
}

async function readLocal(): Promise<LocalData> {
  try {
    const j = JSON.parse(await fs.readFile(LOCAL_FILE, 'utf8')) as Partial<LocalData>;
    return { roster: j.roster ?? [], tracks: j.tracks ?? [], form: j.form ?? null };
  } catch {
    return sampleData();
  }
}

async function writeLocal(d: LocalData): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(d, null, 2), 'utf8');
}

// ---- 公開 API -------------------------------------------------------------

function build(roster: SheetRow[], tracks: SheetRow[], form: FormSheet | null, formStatus: EventData['formStatus'], backend: EventData['backend']): EventData {
  return {
    ok: true,
    students: parseRoster(roster, ROSTER_COLUMNS, NO_CAMPUS),
    tracks: tracks.map(trackFromSheet).filter((t) => t.key),
    applications: form ? parseApplications(form.headers.map(String), form.rows) : [],
    formStatus,
    fetchedAt: nowJp(),
    backend,
  };
}

/** 名簿・声掛けの記録・申込フォームの回答をまとめて読む。 */
export async function loadAll(): Promise<EventData | Fail> {
  if (useLocal()) {
    const d = await readLocal();
    return build(d.roster, d.tracks, d.form, d.form ? 'ok' : 'not_set', 'local');
  }
  const j = await callGas({ action: 'listEvent', columns: Object.values(ROSTER_COLUMNS) });
  if (!j.ok) return { ok: false, reason: j.reason || 'upstream_error' };
  const form = j.form && typeof j.form === 'object' ? (j.form as FormSheet) : null;
  const okForm = !!form && Array.isArray(form.headers) && Array.isArray(form.rows);
  const formStatus: EventData['formStatus'] = okForm ? 'ok' : j.formReason === 'form_not_set' ? 'not_set' : 'error';
  return build(
    Array.isArray(j.roster) ? (j.roster as SheetRow[]) : [],
    Array.isArray(j.tracks) ? (j.tracks as SheetRow[]) : [],
    okForm ? form : null, formStatus, 'sheet',
  );
}

/** 声掛けの記録を保存する。変えた項目（fields）だけを書き、保存後の行を返す。 */
export async function saveTracks(items: TrackSave[], user: string): Promise<SaveResult> {
  const toSheet = (f: TrackSave['fields']) => {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) o[TRACK_HEADERS[k as TrackField]] = v ?? '';
    return o;
  };
  if (useLocal()) {
    const d = await readLocal();
    const ts = nowJp();
    const out: Track[] = [];
    for (const it of items) {
      let row = d.tracks.find((r) => String(r['生徒キー'] ?? '') === it.key);
      if (!row) {
        row = { イベントID: EVENT.id, 生徒キー: it.key };
        d.tracks.push(row);
      }
      Object.assign(row, { 校舎: it.campus, 氏名: it.name }, toSheet(it.fields), { 更新日時: ts, 更新者: user });
      out.push(trackFromSheet(row));
    }
    await writeLocal(d);
    return { ok: true, tracks: out };
  }
  const j = await callGas({
    action: 'saveEventTracks', user,
    items: items.map((it) => ({ key: it.key, campus: it.campus, name: it.name, fields: toSheet(it.fields) })),
  });
  if (!j.ok) return { ok: false, reason: j.reason || 'upstream_error' };
  const rows = Array.isArray(j.items) ? (j.items as SheetRow[]) : [];
  const tracks = rows.map(trackFromSheet).filter((t) => t.key);
  return { ok: true, tracks };
}
