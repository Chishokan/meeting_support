// 小中等部「問合せ管理」シートの読み取りと集計（問い合わせQA用）。
// Apps Script の listInquiryBoard がマスク・除外を済ませて返すため、
// このファイルに個人情報（実名・電話・住所・保護者名・メール）は入ってこない。
// ★列が増減したときは INQUIRY_COLUMNS（apps_script/Code.gs）と下の型を合わせる。

import { fiscalPeriod } from './companyKnowledge';

export type InquiryRow = {
  campus: string;   // 校舎（シート名）
  no: string;       // シート上の No.（元データを引くための番号）
  date: string;     // 問い合わせ日
  name: string;     // 生徒氏名（1文字目＋○ にマスク済み）
  school: string;   // 学校名
  grade: string;    // 学年
  source: string;   // 媒体（友人紹介・兄弟生・HP・校舎を知っていた 等）
  term: string;     // 受講期（講習会・模試・その他イベント 等）
  contacted: string;// 連絡（済 等）
  trialDate: string;// 体験日
  trial: string;    // 体験（〇✕）
  meetingDate: string; // 入塾提案面談日
  agreed: string;   // 本人OK
  closeDate: string;// クローズ予定日
  result: string;   // 結果（入塾・講習会申込・見送り・空＝未決）
  note: string;     // 備考（架電日時・検討中理由・見送り理由 等。200字で切ってある）
};

export type BoardResult =
  | { ok: true; rows: InquiryRow[]; campuses: string[]; fetchedAt: string }
  | { ok: false; reason: string };

function pick(r: Record<string, unknown>, key: string): string {
  const v = r?.[key];
  return v == null ? '' : String(v).trim();
}

/** Apps Script から問合せ管理の行を取得する。個人情報は向こう側で落とされている。 */
export async function listInquiryBoard(): Promise<BoardResult> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'listInquiryBoard', token: process.env.APPS_SCRIPT_TOKEN || '' }),
      cache: 'no-store',
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.ok !== true || !Array.isArray(j.items)) {
      return { ok: false, reason: (j && j.reason) || 'upstream_error' };
    }
    const rows: InquiryRow[] = j.items.map((r: Record<string, unknown>) => ({
      campus: pick(r, '校舎'),
      no: pick(r, 'No.'),
      date: pick(r, '日付'),
      name: pick(r, '生徒氏名'),
      school: pick(r, '学校名'),
      grade: pick(r, '学年'),
      source: pick(r, '媒体'),
      term: pick(r, '受講期'),
      contacted: pick(r, '連絡'),
      trialDate: pick(r, '体験日'),
      trial: pick(r, '体験'),
      meetingDate: pick(r, '入塾提案面談日'),
      agreed: pick(r, '本人OK'),
      closeDate: pick(r, 'クローズ予定日'),
      result: pick(r, '結果'),
      note: pick(r, '備考'),
    }));
    return {
      ok: true,
      rows,
      campuses: Array.isArray(j.campuses) ? j.campuses.map(String) : [],
      fetchedAt: String(j.fetchedAt ?? ''),
    };
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

// ---- 集計 -------------------------------------------------------------

export type CampusStat = {
  campus: string;
  total: number;       // 問い合わせ件数
  joined: number;      // 結果＝入塾
  applied: number;     // 結果＝講習会申込
  declined: number;    // 結果＝見送り
  open: number;        // 結果が未記入（＝追客中）
  other: number;       // 上記以外の結果が入っている（想定外の値。黙って追客中に混ぜない）
  trialDone: number;   // 体験を実施した件数
  noContact: number;   // 連絡も結果も未記入（＝着手できていない）
  bySource: Record<string, number>; // 媒体別の件数
};

function isJoined(r: InquiryRow) {
  return r.result.includes('入塾');
}
function isApplied(r: InquiryRow) {
  return r.result.includes('申込');
}
function isDeclined(r: InquiryRow) {
  return r.result.includes('見送');
}

export function statsByCampus(rows: InquiryRow[]): CampusStat[] {
  const map = new Map<string, CampusStat>();
  for (const r of rows) {
    const key = r.campus || '（校舎不明）';
    let s = map.get(key);
    if (!s) {
      s = {
        campus: key, total: 0, joined: 0, applied: 0, declined: 0,
        open: 0, other: 0, trialDone: 0, noContact: 0, bySource: {},
      };
      map.set(key, s);
    }
    s.total++;
    // 「結果が空＝追客中」で統一する（openRows と同じ判定）。
    // 想定外の値を追客中に混ぜると、集計を正としているAIの回答ごと狂うため other に分ける。
    if (!r.result) s.open++;
    else if (isJoined(r)) s.joined++;
    else if (isApplied(r)) s.applied++;
    else if (isDeclined(r)) s.declined++;
    else s.other++;
    if (r.trialDate || r.trial) s.trialDone++;
    if (!r.contacted && !r.result) s.noContact++;
    const src = r.source || '（未記入）';
    s.bySource[src] = (s.bySource[src] ?? 0) + 1;
  }
  return [...map.values()];
}

/** 追客中（結果が未記入）の行。滞留の確認に使う。 */
export function openRows(rows: InquiryRow[]): InquiryRow[] {
  return rows.filter((r) => !r.result);
}

// ---- 日付の解釈 ---------------------------------------------------------
//
// シートの日付は書式が揃っていない（実データ348件の内訳）：
//   M/D        147件（5/22 など。最多）
//   M月D日      29件
//   M/D＋付加   約15件（「7/14.17」「6/15.29母」など複数日・メモ付き）
//   解釈不能    校舎名・「DMリスト」等が入った行
// いずれも年が無いので、期（5月始まり）から補う。
// 解釈できない行は捨てずに「日付不明」として数え、件数が黙って消えないようにする。

export type ParsedDate = { y: number; m: number; d: number };

/** 文字列から最初の日付を取り出す。年が無ければ期の開始年から補う。 */
export function parseRowDate(raw: string, startYear: number): ParsedDate | null {
  const s = (raw || '').trim();
  if (!s) return null;

  // 1. YYYY/M/D（Apps Script が Date 型セルをこの形に整形する）
  const full = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(s);
  if (full) {
    const y = Number(full[1]);
    const m = Number(full[2]);
    const d = Number(full[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d };
  }

  // 2. M/D または M月D日（先頭のものを採る。「7/14.17」は 7/14 とみなす）
  const md = /(?:^|[^\d])(\d{1,2})(?:\/|月)(\d{1,2})/.exec(s);
  if (md) {
    const m = Number(md[1]);
    const d = Number(md[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      // 期は5月始まり。5〜12月は期の開始年、1〜4月は翌年。
      return { y: m >= 5 ? startYear : startYear + 1, m, d };
    }
  }
  return null;
}

/** 「2026-09」形式。月でまとめるためのキー。 */
export function toYm(p: ParsedDate): string {
  return `${p.y}-${String(p.m).padStart(2, '0')}`;
}

/** 「2026年9月」形式。画面表示用。 */
export function ymLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
}

/** 当月と前月の ym を返す（Asia/Tokyo 基準）。 */
export function currentAndPreviousYm(now: Date = new Date()): { current: string; previous: string } {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const y = get('year');
  const m = get('month');
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return {
    current: `${y}-${String(m).padStart(2, '0')}`,
    previous: `${py}-${String(pm).padStart(2, '0')}`,
  };
}

export type MonthSplit = {
  current: InquiryRow[];
  previous: InquiryRow[];
  older: InquiryRow[];   // それ以前（画面には出さず、チャットで参照する）
  unknown: InquiryRow[]; // 日付を解釈できなかった行
};

/** 当月・前月・それ以前・日付不明に分ける。 */
export function splitByMonth(rows: InquiryRow[], now: Date = new Date()): MonthSplit {
  const { current, previous } = currentAndPreviousYm(now);
  const { startYear } = fiscalPeriod(now);
  const out: MonthSplit = { current: [], previous: [], older: [], unknown: [] };

  for (const r of rows) {
    const p = parseRowDate(r.date, startYear);
    if (!p) {
      out.unknown.push(r);
      continue;
    }
    const ym = toYm(p);
    if (ym === current) out.current.push(r);
    else if (ym === previous) out.previous.push(r);
    else out.older.push(r);
  }
  return out;
}

// ---- プロンプト用の整形 -------------------------------------------------

function field(label: string, v: string): string {
  return v ? `${label}:${v}` : '';
}

/** 1行1件のコンパクトな形に整える。表よりトークンが軽く、AIも読みやすい。 */
export function formatRows(rows: InquiryRow[]): string {
  return rows
    .map((r) => {
      const parts = [
        `${r.campus} #${r.no || '-'}`,
        field('日付', r.date),
        r.name,
        field('学年', r.grade),
        field('学校', r.school),
        field('媒体', r.source),
        field('受講期', r.term),
        field('連絡', r.contacted),
        field('体験日', r.trialDate),
        field('体験', r.trial),
        field('面談日', r.meetingDate),
        field('本人OK', r.agreed),
        field('クローズ予定', r.closeDate),
        `結果:${r.result || '未記入'}`,
        field('備考', r.note),
      ].filter(Boolean);
      return parts.join(' ｜ ');
    })
    .join('\n');
}

/** 集計サマリ。AIが件数を数え違えないよう、先に計算した数字を渡す。 */
export function formatStats(stats: CampusStat[]): string {
  if (!stats.length) return '（データなし）';
  const lines = stats.map((s) => {
    const src = Object.entries(s.bySource)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}${v}`)
      .join('・');
    const other = s.other > 0 ? `・その他${s.other}` : '';
    return [
      `${s.campus}：問い合わせ${s.total}件`,
      `入塾${s.joined}・講習会申込${s.applied}・見送り${s.declined}・追客中${s.open}${other}`,
      `体験実施${s.trialDone}・未着手${s.noContact}`,
      `媒体内訳 ${src}`,
    ].join(' ／ ');
  });
  const t = stats.reduce(
    (a, s) => ({
      total: a.total + s.total, joined: a.joined + s.joined,
      applied: a.applied + s.applied, declined: a.declined + s.declined,
      open: a.open + s.open, other: a.other + s.other, noContact: a.noContact + s.noContact,
    }),
    { total: 0, joined: 0, applied: 0, declined: 0, open: 0, other: 0, noContact: 0 },
  );
  lines.push(
    `小中等部 合計：問い合わせ${t.total}件 ／ 入塾${t.joined}・講習会申込${t.applied}・見送り${t.declined}・追客中${t.open}${t.other > 0 ? `・その他${t.other}` : ''} ／ 未着手${t.noContact}`,
  );
  return lines.join('\n');
}
