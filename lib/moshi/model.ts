// 本番レベル模試（中3）の型と計算。画面・API・保存で共通（サーバ／ブラウザどちらからも使う）。
//
// もとは校舎ごとのスプレッドシート「2026本番レベル模試11月入力シート」（日野校・大野校・日宇校・駅前校のタブ）に
// 受験番号・氏名・性別・志望校コード（第一〜第四）・5教科の大問ごとの得点を入れていた。その形をそのまま持つ。
//   - 1回の模試（回）ごとに、教科ごとの大問の配点と分野（出題範囲）が変わる → MoshiExam.subjects
//   - 受験者は 1回×1人で1行 → MoshiResult（得点は教科ごとに大問の数だけの配列。空欄は null）
//   - 受験番号は 6桁。「514」＋校舎の番号（日野0・大野2・日宇4・駅前5）＋校舎内の2桁（514401 など）
//
// 集計（平均・順位・偏差値・大問別の得点率・志望者内の順位）はここで計算する。AI には数えさせない。
// 順位・偏差値は智翔館の受験者の中でのもの（外部の模試業者の判定ではない）。
//
// ★テストからも読めるよう、ここには import を置かない（型と計算だけ）。志望校コード表は ./schools.ts。

// 使える部門（小中等部だけ）は ./access.ts（左メニューからも読むので、計算とは分けている）。

// ---- 校舎 -----------------------------------------------------------------

export type MoshiCampus = {
  name: string;   // 記録に使う名前（入力シートのタブ名と同じ）
  label: string;  // 受験票・成績表に出す名前
  prefix: string; // 受験番号の頭4桁
};

// ★校舎を増やすときはここに足す（受験番号の頭4桁は、入力シートの番号に合わせる）。
export const MOSHI_CAMPUSES: MoshiCampus[] = [
  { name: '日野校', label: '日野校', prefix: '5140' },
  { name: '大野校', label: '大野校', prefix: '5142' },
  { name: '日宇校', label: '日宇校', prefix: '5144' },
  { name: '駅前校', label: '佐世保駅前校', prefix: '5145' },
];

export const CAMPUS_NAMES = MOSHI_CAMPUSES.map((c) => c.name);

export function campusInfo(name: string): MoshiCampus | undefined {
  return MOSHI_CAMPUSES.find((c) => c.name === name);
}

/** 受験番号の頭4桁から校舎を当てる（貼り付けで校舎の列が無いとき）。 */
export function campusOfExamNo(no: string): string {
  const c = MOSHI_CAMPUSES.find((x) => no.length >= 6 && no.startsWith(x.prefix));
  return c?.name ?? '';
}

// ---- 教科 -----------------------------------------------------------------

export const SUBJECT_KEYS = ['ja', 'en', 'ma', 'so', 'sc'] as const;
export type SubjectKey = (typeof SUBJECT_KEYS)[number];
export const SUBJECT_NAMES: Record<SubjectKey, string> = { ja: '国語', en: '英語', ma: '数学', so: '社会', sc: '理科' };
export const SUBJECT_SHORT: Record<SubjectKey, string> = { ja: '国', en: '英', ma: '数', so: '社', sc: '理' };

export type Question = { max: number; topic: string };
export type ExamSubject = { key: SubjectKey; questions: Question[] };
export type ScheduleRow = { label: string; time: string };

export type MoshiExam = {
  id: string;
  name: string;        // 例「2026 本番レベル模試 11月」
  grade: string;       // 例「中3」
  date: string;        // 実施日 YYYY-MM-DD（未定なら空）
  subjects: ExamSubject[]; // いつも 国・英・数・社・理 の順で5つ
  schedule: ScheduleRow[]; // 受験票の時間割（教科・時刻）
  belongings: string;  // 受験票の持ち物
  notes: string;       // 受験票の注意事項
  venues: Record<string, string>; // 校舎 → 会場（空なら「智翔館 ○○校」）
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
};

export const MAX_QUESTIONS = 10;
export const MAX_SCHEDULE_ROWS = 12;
export const MAX_TEXT = 600;

// 2026年11月の回（入力シートの日宇校タブ）の配点と分野。新しい回を作るときの初期値。
// 前の回があるときは、画面で「前の回をもとに作る」を選べば、その回の配点・分野を写す。
export const DEFAULT_SUBJECTS: ExamSubject[] = [
  { key: 'ja', questions: [
    { max: 31, topic: '小説' }, { max: 17, topic: '古文' }, { max: 34, topic: '論説文' }, { max: 18, topic: '表現・作文' },
  ] },
  { key: 'en', questions: [
    { max: 27, topic: 'リスニング' }, { max: 30, topic: '会話文' }, { max: 11, topic: '英作文' }, { max: 32, topic: '長文総合' },
  ] },
  { key: 'ma', questions: [
    { max: 30, topic: '計算と作図' }, { max: 15, topic: 'データの活用' }, { max: 15, topic: '二次関数' },
    { max: 16, topic: '平面図形・空間図形' }, { max: 24, topic: '探究的な問題' },
  ] },
  { key: 'so', questions: [
    { max: 23, topic: '江戸時代までの歴史' }, { max: 19, topic: '明治以後の歴史' }, { max: 24, topic: '日本地理' },
    { max: 17, topic: '現代社会' }, { max: 17, topic: '憲法と人権' },
  ] },
  { key: 'sc', questions: [
    { max: 15, topic: '動物の特徴と分類' }, { max: 15, topic: '力による現象' }, { max: 19, topic: '化学変化①' },
    { max: 18, topic: '火山と火成岩' }, { max: 18, topic: '電流・磁界' }, { max: 15, topic: '化学変化②' },
  ] },
];

// 受験票の初期値（時刻は回ごとに入れる。空のままだと受験票の時刻の欄は空いたまま出る）。
export const DEFAULT_SCHEDULE: ScheduleRow[] = SUBJECT_KEYS.map((k) => ({ label: SUBJECT_NAMES[k], time: '' }));
export const DEFAULT_BELONGINGS = '受験票、筆記用具（鉛筆・シャープペンシル・消しゴム）、定規、コンパス、時計（計算機能のないもの）';
export const DEFAULT_NOTES = '開始10分前までに教室に入ってください。\n欠席・遅刻するときは、校舎に連絡してください。';

export function newExamDraft(base?: MoshiExam | null): Omit<MoshiExam, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> {
  return {
    name: '',
    grade: base?.grade || '中3',
    date: '',
    subjects: cloneSubjects(base?.subjects ?? DEFAULT_SUBJECTS),
    schedule: (base?.schedule ?? DEFAULT_SCHEDULE).map((s) => ({ label: s.label, time: base ? s.time : '' })),
    belongings: base?.belongings ?? DEFAULT_BELONGINGS,
    notes: base?.notes ?? DEFAULT_NOTES,
    venues: { ...(base?.venues ?? {}) },
  };
}

function cloneSubjects(s: ExamSubject[]): ExamSubject[] {
  return s.map((x) => ({ key: x.key, questions: x.questions.map((q) => ({ max: q.max, topic: q.topic })) }));
}

export function subjectOf(exam: MoshiExam, key: SubjectKey): ExamSubject {
  return exam.subjects.find((s) => s.key === key) ?? { key, questions: [] };
}

export function subjectMax(exam: MoshiExam, key: SubjectKey): number {
  return subjectOf(exam, key).questions.reduce((a, q) => a + q.max, 0);
}

export function examMax(exam: MoshiExam): number {
  return SUBJECT_KEYS.reduce((a, k) => a + subjectMax(exam, k), 0);
}

export function venueOf(exam: MoshiExam, campus: string): string {
  const v = exam.venues?.[campus]?.trim();
  return v || `智翔館 ${campusInfo(campus)?.label ?? campus}`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** "2026-11-22" → "2026年11月22日（日）"。空や形が違えば空。 */
export function jpDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${+m[1]}年${+m[2]}月${+m[3]}日（${WEEKDAYS[d.getUTCDay()]}）`;
}

/** 新しい順（実施日 → 作った日時）。 */
export function sortExams(exams: MoshiExam[]): MoshiExam[] {
  return [...exams].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// ---- 受験者（1回×1人で1行） ----------------------------------------------

export type Gender = '' | '男' | '女';
export type Scores = Record<SubjectKey, (number | null)[]>;

export type MoshiResult = {
  id: string;
  examId: string;
  campus: string;
  examNo: string;    // 受験番号
  name: string;
  gender: Gender;
  choices: string[]; // 第一〜第四志望（志望校コード5桁か、コードが分からないときは学校名）。いつも4つ
  scores: Scores;
  comment: string;   // 成績表に載せる先生からのひとこと
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
};

/** 画面から保存するときの形（作成・更新の記録はサーバが付ける）。 */
export type ResultInput = Omit<MoshiResult, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>;

export const MAX_NAME = 40;
export const MAX_COMMENT = 400;
export const MAX_CHOICE = 40;

export function emptyScores(exam?: MoshiExam | null): Scores {
  const out = {} as Scores;
  for (const k of SUBJECT_KEYS) out[k] = exam ? subjectOf(exam, k).questions.map(() => null) : [];
  return out;
}

/** 全角の数字・英字・記号を半角に（受験番号・得点・志望校コードの入力用）。 */
export function toHalf(s: string): string {
  return String(s ?? '')
    .replace(/[０-９Ａ-Ｚａ-ｚ．－，]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ー−‐]/g, '-');
}

/** 氏名：前後の空白を落とし、名字と名前の間の空白は全角1つにそろえる（入力シートの決まり）。 */
export function normalizeName(s: string): string {
  return String(s ?? '').replace(/[\s　]+/g, '　').trim().replace(/^　+|　+$/g, '').slice(0, MAX_NAME);
}

/** 同じ人かを見るときの氏名（空白・★を落とす）。 */
export function nameKey(s: string): string {
  return String(s ?? '').replace(/[\s　★☆*＊]/g, '');
}

export function normalizeGender(v: unknown): Gender {
  const s = toHalf(String(v ?? '')).trim();
  if (s === '0' || s === '男' || s === '男子' || s === 'M' || s === 'm') return '男';
  if (s === '1' || s === '女' || s === '女子' || s === 'F' || s === 'f') return '女';
  return '';
}

/** 志望校の欄：5桁の数字ならコード、それ以外は学校名として前後の空白だけ落とす。 */
export function normalizeChoice(v: unknown): string {
  const raw = String(v ?? '').trim();
  const half = toHalf(raw).replace(/\s/g, '');
  if (/^\d{5}$/.test(half)) return half;
  return raw.slice(0, MAX_CHOICE);
}

/** 同じ志望校かを見るときのキー（コードはそのまま、学校名は空白を落とす）。 */
export function choiceKey(v: string): string {
  return String(v ?? '').replace(/[\s　]/g, '');
}

/**
 * 得点のセル → 数値。空なら null。数字でない・0未満・配点を超える・小数は error。
 * 「29点」「２９」のような入力も受け付ける。
 */
export function parseScore(v: unknown, max: number): { ok: true; value: number | null } | { ok: false } {
  const s = toHalf(String(v ?? '')).replace(/点$/, '').trim();
  if (s === '') return { ok: true, value: null };
  if (!/^\d+$/.test(s)) return { ok: false };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > max) return { ok: false };
  return { ok: true, value: n };
}

/** シートのセル「29,15,32,18」（空欄は「29,,32,18」）→ 配列。 */
export function scoresFromCell(cell: unknown, count: number): (number | null)[] {
  const parts = String(cell ?? '').split(',');
  const out: (number | null)[] = [];
  for (let i = 0; i < count; i++) {
    const s = (parts[i] ?? '').trim();
    const n = s === '' ? NaN : Number(s);
    out.push(Number.isFinite(n) ? n : null);
  }
  return out;
}

export function scoresToCell(qs: (number | null)[]): string {
  if (!qs.some((v) => v != null)) return '';
  return qs.map((v) => (v == null ? '' : String(v))).join(',');
}

/** 大問の数が変わった回でも壊れないよう、得点の配列を今の大問の数にそろえる。 */
export function fitScores(exam: MoshiExam, scores: Partial<Scores> | null | undefined): Scores {
  const out = {} as Scores;
  for (const k of SUBJECT_KEYS) {
    const n = subjectOf(exam, k).questions.length;
    const src = (scores?.[k] ?? []) as (number | null)[];
    out[k] = Array.from({ length: n }, (_, i) => (typeof src[i] === 'number' && Number.isFinite(src[i]) ? (src[i] as number) : null));
  }
  return out;
}

export type CleanResult = { ok: true; value: ResultInput } | { ok: false; reason: string; detail?: string };

/** API で受け取った1行を確かめて整える（画面でも同じ決まりで止める）。 */
export function cleanResult(raw: unknown, exam: MoshiExam): CleanResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = String(r.id ?? '').trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return { ok: false, reason: 'bad_id' };
  const campus = String(r.campus ?? '').trim();
  if (!CAMPUS_NAMES.includes(campus)) return { ok: false, reason: 'bad_campus' };
  const examNo = toHalf(String(r.examNo ?? '')).replace(/\s/g, '');
  if (examNo && !/^\d{4,10}$/.test(examNo)) return { ok: false, reason: 'bad_exam_no', detail: examNo };
  const name = normalizeName(String(r.name ?? ''));
  const choicesRaw = Array.isArray(r.choices) ? r.choices : [];
  const choices = [0, 1, 2, 3].map((i) => normalizeChoice(choicesRaw[i]));
  const scoresRaw = (r.scores ?? {}) as Record<string, unknown>;
  const scores = {} as Scores;
  for (const k of SUBJECT_KEYS) {
    const qs = subjectOf(exam, k).questions;
    const src = Array.isArray(scoresRaw[k]) ? (scoresRaw[k] as unknown[]) : [];
    scores[k] = [];
    for (let i = 0; i < qs.length; i++) {
      const p = parseScore(src[i] == null ? '' : src[i], qs[i].max);
      if (!p.ok) return { ok: false, reason: 'bad_score', detail: `${SUBJECT_NAMES[k]}${i + 1}` };
      scores[k].push(p.value);
    }
  }
  return {
    ok: true,
    value: {
      id, examId: exam.id, campus, examNo, name,
      gender: normalizeGender(r.gender),
      choices, scores,
      comment: String(r.comment ?? '').slice(0, MAX_COMMENT),
    },
  };
}

export type CleanExam = { ok: true; value: Omit<MoshiExam, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> } | { ok: false; reason: string; detail?: string };

/** 回の設定を確かめて整える。 */
export function cleanExam(raw: unknown): CleanExam {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = String(r.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) return { ok: false, reason: 'no_name' };
  const date = String(r.date ?? '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: 'bad_date' };
  const grade = String(r.grade ?? '').trim().slice(0, 10) || '中3';
  const subjectsRaw = Array.isArray(r.subjects) ? (r.subjects as Record<string, unknown>[]) : [];
  const subjects: ExamSubject[] = [];
  for (const k of SUBJECT_KEYS) {
    const s = subjectsRaw.find((x) => x?.key === k);
    const qsRaw = Array.isArray(s?.questions) ? (s!.questions as Record<string, unknown>[]) : [];
    if (qsRaw.length < 1 || qsRaw.length > MAX_QUESTIONS) return { ok: false, reason: 'bad_questions', detail: SUBJECT_NAMES[k] };
    const questions: Question[] = [];
    for (const q of qsRaw) {
      const max = Number(toHalf(String(q?.max ?? '')));
      if (!Number.isInteger(max) || max < 1 || max > 100) return { ok: false, reason: 'bad_max', detail: SUBJECT_NAMES[k] };
      questions.push({ max, topic: String(q?.topic ?? '').replace(/\s+/g, ' ').trim().slice(0, 30) });
    }
    subjects.push({ key: k, questions });
  }
  const schedRaw = Array.isArray(r.schedule) ? (r.schedule as Record<string, unknown>[]) : [];
  const schedule = schedRaw
    .map((x) => ({ label: String(x?.label ?? '').trim().slice(0, 20), time: String(x?.time ?? '').trim().slice(0, 30) }))
    .filter((x) => x.label || x.time)
    .slice(0, MAX_SCHEDULE_ROWS);
  const venuesRaw = (r.venues ?? {}) as Record<string, unknown>;
  const venues: Record<string, string> = {};
  for (const c of CAMPUS_NAMES) {
    const v = String(venuesRaw[c] ?? '').trim().slice(0, 40);
    if (v) venues[c] = v;
  }
  return {
    ok: true,
    value: {
      name, grade, date, subjects, schedule,
      belongings: String(r.belongings ?? '').trim().slice(0, MAX_TEXT),
      notes: String(r.notes ?? '').trim().slice(0, MAX_TEXT),
      venues,
    },
  };
}

// ---- 受験番号 -------------------------------------------------------------

/** その校舎の次の受験番号（頭4桁＋校舎内の番号の最大＋1。2桁にそろえる）。 */
export function nextExamNo(campus: string, used: string[]): string {
  const info = campusInfo(campus);
  if (!info) return '';
  let max = 0;
  for (const no of used) {
    if (!no.startsWith(info.prefix) || no.length < 6) continue;
    const n = Number(no.slice(info.prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return info.prefix + String(max + 1).padStart(2, '0');
}

// ---- 集計 -----------------------------------------------------------------

export type Stat = { n: number; mean: number; sd: number; max: number; min: number };

export function statOf(values: number[]): Stat | null {
  const n = values.length;
  if (!n) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { n, mean, sd, max: Math.max(...values), min: Math.min(...values) };
}

/** 偏差値（母集団の標準偏差で計算。受験者が1人・全員同点なら 50）。 */
export function deviation(x: number, s: Stat | null): number | null {
  if (!s) return null;
  if (s.n < 2 || s.sd === 0) return 50;
  return 50 + (10 * (x - s.mean)) / s.sd;
}

/** 同点は同じ順位（1, 2, 2, 4 …）。 */
export function rankIn(values: number[], x: number): number {
  let higher = 0;
  for (const v of values) if (v > x) higher++;
  return higher + 1;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 教科の合計。1問も入っていなければ null（未受験・未入力）。空欄の大問は 0 点として足す（入力シートの SUM と同じ）。 */
export function subjectTotal(r: MoshiResult, key: SubjectKey): number | null {
  const qs = r.scores?.[key] ?? [];
  if (!qs.some((v) => v != null)) return null;
  return qs.reduce<number>((a, v) => a + (v ?? 0), 0);
}

/** 大問の一部だけ入っている教科（入力の途中か、入れ忘れ）。 */
export function isPartial(exam: MoshiExam, r: MoshiResult, key: SubjectKey): boolean {
  const n = subjectOf(exam, key).questions.length;
  const qs = r.scores?.[key] ?? [];
  const filled = Array.from({ length: n }, (_, i) => qs[i] != null).filter(Boolean).length;
  return filled > 0 && filled < n;
}

export type RowStat = {
  r: MoshiResult;
  sub: Record<SubjectKey, number | null>;
  total: number | null; // 5教科すべて受けた人だけ
  complete: boolean;
  rank: number | null;        // 全体（智翔館内）の順位
  campusRank: number | null;  // 校舎内の順位
  dev: number | null;         // 5教科の偏差値
  subRank: Record<SubjectKey, number | null>;
  subCampusRank: Record<SubjectKey, number | null>;
  subDev: Record<SubjectKey, number | null>;
};

export type GroupStats = {
  total: Stat | null;
  sub: Record<SubjectKey, Stat | null>;
  // 大問ごとの平均点（その教科を受けた人の中で。空欄は 0 点）
  questionMean: Record<SubjectKey, number[]>;
};

export type ExamStats = {
  exam: MoshiExam;
  rows: RowStat[];
  overall: GroupStats;
  byCampus: Record<string, GroupStats>;
  entered: number;   // 1教科でも入っている人
  complete: number;  // 5教科すべて入っている人
};

function groupStats(exam: MoshiExam, rows: { r: MoshiResult; sub: Record<SubjectKey, number | null>; total: number | null }[]): GroupStats {
  const sub = {} as Record<SubjectKey, Stat | null>;
  const questionMean = {} as Record<SubjectKey, number[]>;
  for (const k of SUBJECT_KEYS) {
    const takers = rows.filter((x) => x.sub[k] != null);
    sub[k] = statOf(takers.map((x) => x.sub[k] as number));
    const qn = subjectOf(exam, k).questions.length;
    questionMean[k] = Array.from({ length: qn }, (_, i) =>
      takers.length ? takers.reduce((a, x) => a + (x.r.scores[k]?.[i] ?? 0), 0) / takers.length : 0);
  }
  return { total: statOf(rows.filter((x) => x.total != null).map((x) => x.total as number)), sub, questionMean };
}

/** 1回分の集計。results はその回の行だけでも、全部の回の行でもよい（examId で絞る）。 */
export function computeStats(exam: MoshiExam, results: MoshiResult[]): ExamStats {
  const mine = results.filter((r) => r.examId === exam.id);
  const base = mine.map((r) => {
    const sub = {} as Record<SubjectKey, number | null>;
    for (const k of SUBJECT_KEYS) sub[k] = subjectTotal(r, k);
    const complete = SUBJECT_KEYS.every((k) => sub[k] != null);
    const total = complete ? SUBJECT_KEYS.reduce((a, k) => a + (sub[k] as number), 0) : null;
    return { r, sub, total, complete };
  });
  const overall = groupStats(exam, base);
  const byCampus: Record<string, GroupStats> = {};
  for (const c of new Set(base.map((x) => x.r.campus))) byCampus[c] = groupStats(exam, base.filter((x) => x.r.campus === c));

  const totals = base.filter((x) => x.total != null).map((x) => x.total as number);
  const subVals = {} as Record<SubjectKey, number[]>;
  for (const k of SUBJECT_KEYS) subVals[k] = base.filter((x) => x.sub[k] != null).map((x) => x.sub[k] as number);

  const rows: RowStat[] = base.map((x) => {
    const same = base.filter((y) => y.r.campus === x.r.campus);
    const subRank = {} as Record<SubjectKey, number | null>;
    const subCampusRank = {} as Record<SubjectKey, number | null>;
    const subDev = {} as Record<SubjectKey, number | null>;
    for (const k of SUBJECT_KEYS) {
      const v = x.sub[k];
      subRank[k] = v == null ? null : rankIn(subVals[k], v);
      subCampusRank[k] = v == null ? null : rankIn(same.filter((y) => y.sub[k] != null).map((y) => y.sub[k] as number), v);
      subDev[k] = v == null ? null : deviation(v, overall.sub[k]);
    }
    return {
      ...x,
      rank: x.total == null ? null : rankIn(totals, x.total),
      campusRank: x.total == null ? null : rankIn(same.filter((y) => y.total != null).map((y) => y.total as number), x.total),
      dev: x.total == null ? null : deviation(x.total, overall.total),
      subRank, subCampusRank, subDev,
    };
  });

  return {
    exam, rows, overall, byCampus,
    entered: base.filter((x) => SUBJECT_KEYS.some((k) => x.sub[k] != null)).length,
    complete: totals.length,
  };
}

/** 合計の高い順（未完了の人は後ろ。同点は受験番号順）。 */
export function rankedRows(stats: ExamStats, campus?: string): RowStat[] {
  return stats.rows
    .filter((x) => !campus || x.r.campus === campus)
    .sort((a, b) => {
      if (a.total != null && b.total != null && a.total !== b.total) return b.total - a.total;
      if ((a.total == null) !== (b.total == null)) return a.total == null ? 1 : -1;
      return a.r.examNo.localeCompare(b.r.examNo) || a.r.name.localeCompare(b.r.name, 'ja');
    });
}

/** 受験番号順（入力・受験票の並び）。番号が無い行は後ろ。 */
export function byExamNo<T extends { examNo: string; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (!a.examNo !== !b.examNo) return a.examNo ? -1 : 1;
    return a.examNo.localeCompare(b.examNo) || a.name.localeCompare(b.name, 'ja');
  });
}

export type ChoiceRank = {
  choice: string;
  first: { n: number; rank: number } | null; // この学校を第一志望にした人の中で
  any: { n: number; rank: number } | null;   // この学校を第一〜第四志望のどこかに書いた人の中で
};

/** 志望校ごとの「同じ学校を志望した人の中で何位か」（5教科すべて受けた人だけで数える）。 */
export function choiceRanks(stats: ExamStats, row: RowStat): ChoiceRank[] {
  const done = stats.rows.filter((x) => x.total != null);
  return row.r.choices.map((choice, i) => {
    const key = choiceKey(choice);
    if (!key) return { choice, first: null, any: null };
    const firsts = done.filter((x) => choiceKey(x.r.choices[0] ?? '') === key);
    const anys = done.filter((x) => x.r.choices.some((c) => choiceKey(c) === key));
    const t = row.total;
    return {
      choice,
      first: t == null || i !== 0 || !firsts.length ? null : { n: firsts.length, rank: rankIn(firsts.map((x) => x.total as number), t) },
      any: t == null || !anys.length ? null : { n: anys.length, rank: rankIn(anys.map((x) => x.total as number), t) },
    };
  });
}

export type TopicPoint = {
  key: SubjectKey; index: number; topic: string; max: number;
  score: number; rate: number; meanRate: number; diff: number; // 得点率と平均との差（0〜1）
};

/** 大問ごとの得点率と平均との差（その教科を受けていれば。空欄は 0 点）。 */
export function topicPoints(stats: ExamStats, row: RowStat): TopicPoint[] {
  const out: TopicPoint[] = [];
  for (const k of SUBJECT_KEYS) {
    if (row.sub[k] == null) continue;
    subjectOf(stats.exam, k).questions.forEach((q, i) => {
      const score = row.r.scores[k]?.[i] ?? 0;
      const meanRate = (stats.overall.questionMean[k][i] ?? 0) / q.max;
      const rate = score / q.max;
      out.push({ key: k, index: i, topic: q.topic || `大問${i + 1}`, max: q.max, score, rate, meanRate, diff: rate - meanRate });
    });
  }
  return out;
}

/** 面談で話す材料：平均より得点率が高い大問（得意）と低い大問（伸ばしたい）を3つずつ。 */
export function strengthsAndWeaknesses(points: TopicPoint[], n = 3): { strong: TopicPoint[]; weak: TopicPoint[] } {
  const strong = points.filter((p) => p.diff > 0.0001).sort((a, b) => b.diff - a.diff || b.rate - a.rate).slice(0, n);
  const weak = points.filter((p) => p.diff < -0.0001).sort((a, b) => a.diff - b.diff || a.rate - b.rate).slice(0, n);
  return { strong, weak };
}

export type HistoryPoint = { exam: MoshiExam; row: RowStat; n: number };

/**
 * 同じ生徒のこれまでの回（古い順）。氏名（空白・★を除いて）が同じで、受験番号か校舎が同じ行を同じ人とみなす
 * （受験番号は回をまたいで同じことが多いが、付け直したときにも追えるように校舎でも拾う）。
 */
export function historyOf(statsList: ExamStats[], target: MoshiResult): HistoryPoint[] {
  const key = nameKey(target.name);
  if (!key) return [];
  const out: HistoryPoint[] = [];
  for (const s of statsList) {
    const row = s.rows.find((x) => nameKey(x.r.name) === key && ((target.examNo && x.r.examNo === target.examNo) || x.r.campus === target.campus));
    if (row) out.push({ exam: s.exam, row, n: s.complete });
  }
  return out.sort((a, b) => (a.exam.date || '').localeCompare(b.exam.date || '') || (a.exam.createdAt || '').localeCompare(b.exam.createdAt || ''));
}

// ---- 貼り付け（スプレッドシートからの名簿・入力シートの行） -------------------

export type PastedRow = {
  examNo: string;
  name: string;
  gender: Gender;
  choices: string[];
  scores: Scores | null; // 得点の列が読めたときだけ
};

export type PasteResult = { rows: PastedRow[]; warnings: string[] };

/**
 * スプレッドシートからコピーした行を読む。次の形に対応する（タブ区切り・見出しの行は読み飛ばす）。
 *   1) 名簿：受験番号・氏名・性別・第一〜第四志望（性別より右は省いてよい）。受験番号を省いて「氏名…」から始めてもよい
 *   2) 入力シートの行（B列〜AT列。A列の通し番号から選んでもよい）：
 *      受験番号・氏名・性別・志望校コード×4・（非表示の4列）・志望校名×4・国1…国計・英1…英計・数…・社…・理…・合計
 *      ※非表示の列が入っていなくても読める。「計」の列は読み飛ばし、大問の得点だけを使う
 * 氏名も得点も無い行（入力シートの空き番号）は飛ばす。
 */
export function parsePaste(text: string, exam: MoshiExam): PasteResult {
  const warnings: string[] = [];
  const rows: PastedRow[] = [];
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const qCounts = SUBJECT_KEYS.map((k) => subjectOf(exam, k).questions.length);
  const needWithTotals = qCounts.reduce((a, n) => a + n + 1, 0);
  let lineNo = 0;
  for (const line of lines) {
    lineNo++;
    if (!line.trim()) continue;
    let cells = line.split('\t').map((c) => c.trim());
    if (cells.some((c) => c === '受験番号' || c === '氏名' || c === '配　点' || c === '配点')) continue;
    // A列（通し番号 1〜3桁）から選んだときは1つずらす
    if (/^\d{1,3}$/.test(toHalf(cells[0] ?? '')) && /^\d{6,}$/.test(toHalf(cells[1] ?? ''))) cells = cells.slice(1);
    const first = toHalf(cells[0] ?? '').replace(/\s/g, '');
    let examNo = '';
    // 受験番号の列が空の行（番号をまだ振っていない人）も、列の並びは同じとみなす
    if (/^\d{4,10}$/.test(first)) { examNo = first; cells = cells.slice(1); } else if (first === '' && cells.length > 1) cells = cells.slice(1);
    const name = normalizeName(cells[0] ?? '');
    const gender = normalizeGender(cells[1]);
    const choices = [2, 3, 4, 5].map((i) => normalizeChoice(cells[i]));
    const rest = cells.slice(6);

    let scores: Scores | null = null;
    if (rest.some((c) => c !== '')) {
      let skip = -1;
      if (rest.length >= needWithTotals + 8) skip = 8;
      else if (rest.length >= needWithTotals + 4) skip = 4;
      else if (rest.length >= needWithTotals) skip = 0;
      if (skip === -1) {
        // 志望校の列（非表示の4列・志望校名の4列）までしか無いのは名簿だけの貼り付け。それより多いのに足りないときだけ知らせる
        if ((examNo || name) && rest.length > 8) warnings.push(`${lineNo}行目：得点の列の数が今回の大問の数と合わないので、名簿だけ読みました`);
      } else {
        const cols = rest.slice(skip);
        const sc = {} as Scores;
        let p = 0;
        let bad = '';
        SUBJECT_KEYS.forEach((k, si) => {
          const qs = subjectOf(exam, k).questions;
          sc[k] = [];
          for (let i = 0; i < qCounts[si]; i++) {
            const v = parseScore(cols[p++], qs[i].max);
            if (!v.ok) { bad ||= `${SUBJECT_NAMES[k]}${i + 1}`; sc[k].push(null); } else sc[k].push(v.value);
          }
          p++; // 「計」の列
        });
        if (bad) warnings.push(`${lineNo}行目：${bad} の得点が読めないか配点を超えているので、空欄にしました`);
        // 入力シートの式（計＝0）だけで中身が無い行は、得点なしとして扱う
        scores = SUBJECT_KEYS.some((k) => sc[k].some((v) => v != null)) ? sc : null;
      }
    }
    if (!name && !scores) continue;
    rows.push({ examNo, name, gender, choices, scores });
  }
  return { rows, warnings };
}

export type PastePlan = {
  add: PastedRow[];
  update: { row: PastedRow; target: MoshiResult }[];
};

/** 貼り付けた行を、いまの名簿（その回・その校舎）に当てる。受験番号が同じ行 → 氏名が同じ行 の順で探す。 */
export function planPaste(pasted: PastedRow[], current: MoshiResult[]): PastePlan {
  const add: PastedRow[] = [];
  const update: { row: PastedRow; target: MoshiResult }[] = [];
  const taken = new Set<string>();
  for (const p of pasted) {
    const t = (p.examNo && current.find((r) => r.examNo === p.examNo && !taken.has(r.id)))
      || (p.name && current.find((r) => nameKey(r.name) === nameKey(p.name) && !taken.has(r.id)))
      || null;
    if (t) { taken.add(t.id); update.push({ row: p, target: t }); } else add.push(p);
  }
  return { add, update };
}

// ---- CSV ------------------------------------------------------------------

/** Excel で文字化けしないよう、先頭に BOM を付けた CSV。 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

/**
 * 入力シートと同じ列の並び（受験番号・氏名・性別0/1・志望校コード×4・志望校名×4・教科ごとの大問と計・合計）。
 * 外部の集計に入力シートの形で出すときに使う。schoolName は志望校コード → 学校名。
 */
export function inputSheetRows(exam: MoshiExam, results: MoshiResult[], schoolName: (v: string) => string): (string | number)[][] {
  const head: string[] = ['校舎', '受験番号', '氏名', '性別', '第一', '第二', '第三', '第四', '第一志望校名', '第二志望校名', '第三志望校名', '第四志望校名'];
  for (const k of SUBJECT_KEYS) {
    subjectOf(exam, k).questions.forEach((_, i) => head.push(`${SUBJECT_NAMES[k]}${i + 1}`));
    head.push(`${SUBJECT_NAMES[k]}計`);
  }
  head.push('合計');
  const body = byExamNo(results.filter((r) => r.examId === exam.id)).map((r) => {
    const row: (string | number)[] = [
      r.campus, r.examNo, r.name, r.gender === '男' ? 0 : r.gender === '女' ? 1 : '',
      ...r.choices.map((c) => (/^\d{5}$/.test(c) ? c : '')),
      ...r.choices.map((c) => schoolName(c)),
    ];
    let all = 0;
    for (const k of SUBJECT_KEYS) {
      const qs = r.scores[k] ?? [];
      subjectOf(exam, k).questions.forEach((_, i) => row.push(qs[i] ?? ''));
      const t = subjectTotal(r, k);
      row.push(t ?? '');
      all += t ?? 0;
    }
    row.push(all);
    return row;
  });
  return [head, ...body];
}
