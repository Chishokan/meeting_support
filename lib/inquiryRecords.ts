// 小中等部「問合せ管理」Web アプリ（/inquiry-board）のデータ定義。
// スプレッドシート「2026小中等部問合せ管理」（校舎ごとのシート）を 1件1行の台帳に置き換える。
//
// ★列を増やすときは、ここの InquiryRecord / RECORD_FIELDS と
//   apps_script/Code.gs の INQUIRY_DB_HEADERS を必ず合わせる（順番も同じにする）。
//
// このファイルはサーバ・ブラウザの両方から読む。個人情報は含むが、
// 会議DX（問い合わせQA）に渡すときは Apps Script 側でマスクされる（lib/inquiryBoard.ts）。

// ---- 選択肢（元シートのプルダウンをそのまま引き継ぐ） ---------------------

/** 校舎（元シートのタブ名。並びは会議で見る順）。 */
export const BOARD_CAMPUSES = ['日野校', '駅前校', '大野校', '日宇校', '県中対策', 'その他'] as const;

/** 学年（元シートは全角数字で入っているものが多いので、全角に揃える）。 */
export const GRADES = ['小１', '小２', '小３', '小４', '小５', '小６', '中１', '中２', '中３', '高１', '高２', '高３'] as const;

/** 媒体（各校舎のプルダウンの和集合）。 */
export const SOURCES = ['HP', '友人紹介', '保護者紹介', '兄弟生', '校舎を知っていた', 'チラシ', '講習会リピーター', '門配', 'その他'] as const;

/** 受講期（何をきっかけに問い合わせたか）。 */
export const TERMS = ['通常', '講習会', '模試', 'その他イベント'] as const;

/** 連絡（済＝連絡がついた、不通＝つながらなかった）。 */
export const CONTACTS = ['済', '不通'] as const;

/** 体験・本人OK・DM の 〇✕。 */
export const MARKS = ['〇', '✕'] as const;

/** 結果。空欄＝追客中（まだ決着していない）。 */
export const RESULTS = ['入塾', '講習会申込', '模試申込', '検討中', '見送り'] as const;

// ---- 型 ---------------------------------------------------------------

export type InquiryRecord = {
  id: string;            // 台帳の ID（UUID）。更新・削除のキー
  campus: string;        // 校舎
  no: number;            // 校舎内の通し番号（元シートの No.。会議で「日野校 #12」と呼ぶため残す）
  date: string;          // 問い合わせ日（YYYY-MM-DD。旧データは「5/21.6/29」のような文字列のこともある）
  studentName: string;   // 生徒氏名
  kana: string;          // ふりがな
  school: string;        // 学校名
  grade: string;         // 学年
  phone: string;         // 電話番号
  source: string;        // 媒体
  term: string;          // 受講期
  contacted: string;     // 連絡（済／不通／空）
  trialDate: string;     // 体験日
  trial: string;         // 体験（〇✕）
  meetingDate: string;   // 入塾提案面談日
  agreed: string;        // 本人OK（〇✕）
  closeDate: string;     // クローズ予定日
  result: string;        // 結果（空＝追客中）
  enrollDate: string;    // 入塾日 ★元シートに無かった列。「今月入会」を数えるために追加
  note: string;          // 備考（架電日時・検討中理由・見送り理由・その他補足事項）
  guardianName: string;  // 保護者名
  postal: string;        // 郵便番号
  address: string;       // 住所
  email: string;         // メールアドレス（HP フォームからの問い合わせ用）
  dm: string;            // DM（〇✕。DM 送付の目印）
  createdAt: string;     // 作成日時
  createdBy: string;     // 作成者
  updatedAt: string;     // 更新日時
  updatedBy: string;     // 更新者
};

/** 入力フォームで扱う項目（id・作成/更新情報を除く）。 */
export type InquiryInput = Omit<InquiryRecord, 'id' | 'no' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> & {
  no?: number; // 省略すると校舎内で採番する
};

/** 台帳シートの見出し（Apps Script の INQUIRY_DB_HEADERS と同じ順）。 */
export const RECORD_FIELDS: { key: keyof InquiryRecord; header: string }[] = [
  { key: 'id', header: 'ID' },
  { key: 'campus', header: '校舎' },
  { key: 'no', header: 'No.' },
  { key: 'date', header: '日付' },
  { key: 'studentName', header: '生徒氏名' },
  { key: 'kana', header: 'ふりがな' },
  { key: 'school', header: '学校名' },
  { key: 'grade', header: '学年' },
  { key: 'phone', header: '電話番号' },
  { key: 'source', header: '媒体' },
  { key: 'term', header: '受講期' },
  { key: 'contacted', header: '連絡' },
  { key: 'trialDate', header: '体験日' },
  { key: 'trial', header: '体験' },
  { key: 'meetingDate', header: '入塾提案面談日' },
  { key: 'agreed', header: '本人OK' },
  { key: 'closeDate', header: 'クローズ予定日' },
  { key: 'result', header: '結果' },
  { key: 'enrollDate', header: '入塾日' },
  { key: 'note', header: '備考' },
  { key: 'guardianName', header: '保護者名' },
  { key: 'postal', header: '郵便番号' },
  { key: 'address', header: '住所' },
  { key: 'email', header: 'メールアドレス' },
  { key: 'dm', header: 'DM' },
  { key: 'createdAt', header: '作成日時' },
  { key: 'createdBy', header: '作成者' },
  { key: 'updatedAt', header: '更新日時' },
  { key: 'updatedBy', header: '更新者' },
];

const TEXT_MAX: Partial<Record<keyof InquiryRecord, number>> = {
  studentName: 60, kana: 80, school: 60, phone: 40, note: 4000,
  guardianName: 60, postal: 12, address: 200, email: 120,
};

export function emptyInput(campus: string): InquiryInput {
  return {
    campus, date: '', studentName: '', kana: '', school: '', grade: '', phone: '',
    source: '', term: '', contacted: '', trialDate: '', trial: '', meetingDate: '',
    agreed: '', closeDate: '', result: '', enrollDate: '', note: '',
    guardianName: '', postal: '', address: '', email: '', dm: '',
  };
}

// ---- 正規化 -------------------------------------------------------------

const FULLWIDTH_DIGITS = '０１２３４５６７８９';

/** 「小6」「小 ６」→「小６」。学年の表記ゆれを揃える（元シートは半角・全角が混在）。 */
export function normalizeGrade(v: string): string {
  const s = (v || '').replace(/[\s　]/g, '');
  return s.replace(/[0-9]/g, (d) => FULLWIDTH_DIGITS[Number(d)]);
}

/** 〇○◯⚪︎ → 〇、×✕✖ → ✕。目印の表記ゆれを揃える。 */
export function normalizeMark(v: string): string {
  const s = (v || '').trim();
  if (!s) return '';
  if (/[〇○◯⚪◎]/.test(s)) return '〇';
  if (/[×✕✖]/.test(s)) return '✕';
  return s;
}

/**
 * 日付を YYYY-MM-DD に揃える。
 * 「2026/5/21」「5/21」「5月21日」「2026-05-21」を受け付け、年が無ければ fallbackYear（期の開始年）から補う。
 * 解釈できない文字列（「5/21.6/29」など複数日）はそのまま返す。件数が黙って消えないよう捨てない。
 */
export function normalizeDate(v: string, fallbackYear: number): string {
  const s = (v || '').trim();
  if (!s) return '';
  const full = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/.exec(s);
  if (full) return isoDate(Number(full[1]), Number(full[2]), Number(full[3])) ?? s;
  const md = /^(\d{1,2})[/\-.月](\d{1,2})日?$/.exec(s);
  if (md) {
    const m = Number(md[1]);
    // 期は5月始まり。5〜12月は開始年、1〜4月は翌年。
    const y = m >= 5 ? fallbackYear : fallbackYear + 1;
    return isoDate(y, m, Number(md[2])) ?? s;
  }
  return s;
}

function isoDate(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** YYYY-MM-DD なら {y,m,d}。それ以外は null（旧データの複数日表記など）。 */
export function parseIso(v: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** 画面用「5/21」。YYYY-MM-DD 以外はそのまま。 */
export function shortDate(v: string): string {
  const p = parseIso(v);
  return p ? `${p.m}/${p.d}` : v || '';
}

/** 「2026-09」。月でまとめるためのキー。 */
export function ymOf(v: string): string | null {
  const p = parseIso(v);
  return p ? `${p.y}-${String(p.m).padStart(2, '0')}` : null;
}

// ---- 検証 -------------------------------------------------------------

export type ValidationResult = { ok: true; value: InquiryInput } | { ok: false; errors: string[] };

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/**
 * 画面・API から受け取った入力を検証して整える。
 * 選択肢に無い値は弾くのではなく「その他」扱いにせず、そのまま通す（旧データの移行値を壊さないため）。
 * ただし校舎・生徒氏名（または保護者名）・日付は必須。
 */
export function validateInput(raw: unknown, fallbackYear: number): ValidationResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const errors: string[] = [];

  const campus = str(r.campus);
  if (!campus) errors.push('校舎を選んでください。');

  const studentName = str(r.studentName);
  const guardianName = str(r.guardianName);
  if (!studentName && !guardianName) errors.push('生徒氏名（または保護者名）を入力してください。');

  const date = normalizeDate(str(r.date), fallbackYear);
  if (!date) errors.push('問い合わせ日を入力してください。');

  const value: InquiryInput = {
    campus,
    date,
    studentName,
    kana: str(r.kana),
    school: str(r.school),
    grade: normalizeGrade(str(r.grade)),
    phone: str(r.phone),
    source: str(r.source),
    term: str(r.term),
    contacted: str(r.contacted),
    trialDate: normalizeDate(str(r.trialDate), fallbackYear),
    trial: normalizeMark(str(r.trial)),
    meetingDate: normalizeDate(str(r.meetingDate), fallbackYear),
    agreed: normalizeMark(str(r.agreed)),
    closeDate: normalizeDate(str(r.closeDate), fallbackYear),
    result: str(r.result),
    enrollDate: normalizeDate(str(r.enrollDate), fallbackYear),
    note: str(r.note),
    guardianName,
    postal: str(r.postal),
    address: str(r.address),
    email: str(r.email),
    dm: normalizeMark(str(r.dm)),
  };
  if (r.no != null && str(r.no) !== '') {
    const n = Number(r.no);
    if (!Number.isInteger(n) || n < 0) errors.push('No. は 0 以上の整数で入力してください。');
    else value.no = n;
  }

  // 結果＝入塾なのに入塾日が無いのは記入漏れになりやすい。エラーにはせず画面側で注意を出す。
  for (const [k, max] of Object.entries(TEXT_MAX) as [keyof InquiryInput, number][]) {
    const v = value[k];
    if (typeof v === 'string' && v.length > max) errors.push(`${labelOf(k)}が長すぎます（${max}文字まで）。`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export function labelOf(key: keyof InquiryRecord): string {
  return RECORD_FIELDS.find((f) => f.key === key)?.header ?? String(key);
}

// ---- 状態の判定（画面の色分け・集計で共通に使う） ----------------------------

export type RecordStatus = 'joined' | 'applied' | 'declined' | 'considering' | 'open' | 'other';

/** 結果の区分。空欄は追客中（open）。想定外の値は other として分け、黙って追客中に混ぜない。 */
export function statusOf(result: string): RecordStatus {
  const r = (result || '').trim();
  if (!r) return 'open';
  if (r.includes('入塾') || r.includes('入会')) return 'joined';
  if (r.includes('申込')) return 'applied';
  if (r.includes('見送')) return 'declined';
  if (r.includes('検討')) return 'considering';
  return 'other';
}

export const STATUS_LABEL: Record<RecordStatus, string> = {
  joined: '入塾',
  applied: '申込',
  declined: '見送り',
  considering: '検討中',
  open: '追客中',
  other: 'その他',
};

/** 連絡も結果も未記入＝まだ着手できていない。 */
export function isUntouched(r: Pick<InquiryRecord, 'contacted' | 'result'>): boolean {
  return !r.contacted && !r.result;
}

/** クローズ予定日を過ぎているのに結果が未記入＝滞留。today は YYYY-MM-DD。 */
export function isOverdue(r: Pick<InquiryRecord, 'closeDate' | 'result'>, today: string): boolean {
  if (r.result) return false;
  const p = parseIso(r.closeDate);
  return !!p && r.closeDate.slice(0, 10) < today;
}

// ---- 集計 ---------------------------------------------------------------
//
// 元シート右側の「問合・入面・問入率・体験・入体率」の表を、学年ごとに再現する。
// シートの式は一部 #REF! で壊れていたため、ここでは次の定義で数える。
//   問合：行数 ／ 面談：入塾提案面談日あり ／ 体験：体験=〇 ／ 入塾：結果=入塾 ／
//   申込：結果=講習会申込・模試申込 ／ 見送り ／ 追客中：結果が空

export type GradeStat = {
  grade: string;
  total: number;
  meeting: number;
  trial: number;
  joined: number;
  applied: number;
  declined: number;
  open: number;
};

const GRADE_GROUPS: { label: string; grades: readonly string[] }[] = [
  { label: '小学生', grades: GRADES.filter((g) => g.startsWith('小')) },
  { label: '中学生', grades: GRADES.filter((g) => g.startsWith('中')) },
  { label: '高校生', grades: GRADES.filter((g) => g.startsWith('高')) },
];

function blank(grade: string): GradeStat {
  return { grade, total: 0, meeting: 0, trial: 0, joined: 0, applied: 0, declined: 0, open: 0 };
}

function add(s: GradeStat, r: InquiryRecord) {
  s.total++;
  if (r.meetingDate) s.meeting++;
  if (normalizeMark(r.trial) === '〇') s.trial++;
  const st = statusOf(r.result);
  if (st === 'joined') s.joined++;
  else if (st === 'applied') s.applied++;
  else if (st === 'declined') s.declined++;
  else if (st === 'open') s.open++;
}

/** 学年別の集計。学年が未記入の行は「未記入」として別に出す（記入漏れを見える化）。 */
export function statsByGrade(rows: InquiryRecord[]): { grades: GradeStat[]; groups: GradeStat[]; total: GradeStat } {
  const map = new Map<string, GradeStat>();
  for (const g of GRADES) map.set(g, blank(g));
  const unknown = blank('未記入');
  const total = blank('合計');
  for (const r of rows) {
    const g = normalizeGrade(r.grade);
    const s = map.get(g) ?? unknown;
    add(s, r);
    add(total, r);
  }
  const grades = [...map.values()].filter((s) => s.total > 0);
  if (unknown.total > 0) grades.push(unknown);
  const groups = GRADE_GROUPS.map((gr) => {
    const s = blank(gr.label);
    for (const g of gr.grades) {
      const x = map.get(g);
      if (!x) continue;
      s.total += x.total; s.meeting += x.meeting; s.trial += x.trial;
      s.joined += x.joined; s.applied += x.applied; s.declined += x.declined; s.open += x.open;
    }
    return s;
  }).filter((s) => s.total > 0);
  return { grades, groups, total };
}

/** 割合の表示（分母0なら「—」）。 */
export function pct(n: number, d: number): string {
  if (!d) return '—';
  return `${Math.round((n / d) * 1000) / 10}%`;
}

// ---- CSV ---------------------------------------------------------------

/** 台帳を CSV（BOM 付き・Excel で開ける）にする。画面の「CSV」ボタンで使う。 */
export function toCsv(rows: InquiryRecord[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = RECORD_FIELDS.map((f) => f.header).join(',');
  const body = rows.map((r) => RECORD_FIELDS.map((f) => esc(r[f.key])).join(','));
  return '﻿' + [head, ...body].join('\r\n');
}
