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

// 使える部門は ./access.ts（総合メニューのカード・成績管理のレイアウトからも読むので、計算とは分けている）。

// ---- 校舎 -----------------------------------------------------------------

export type MoshiCampus = {
  name: string;   // 記録に使う名前（入力シートのタブ名と同じ）
  label: string;  // 受験票・成績表に出す名前
  prefix: string; // 前の入力シートの受験番号（514410 など）の頭4桁。古い番号を読み替えるときだけ使う
  venue: string;  // 県一斉模試の会場名称に入っている言葉（例「智翔館　佐世保駅前校」→「佐世保駅前」）
};

// ★校舎を増やすときはここに足す。
// 受験番号は県一斉模試と同じ、校舎（会場）ごとの4桁（0001〜）。校舎が違えば同じ番号があるので、生徒は「校舎＋受験番号」で見分ける。
export const MOSHI_CAMPUSES: MoshiCampus[] = [
  { name: '日野校', label: '日野校', prefix: '5140', venue: '日野' },
  { name: '大野校', label: '大野校', prefix: '5142', venue: '大野' },
  { name: '日宇校', label: '日宇校', prefix: '5144', venue: '日宇' },
  { name: '駅前校', label: '佐世保駅前校', prefix: '5145', venue: '駅前' },
];

export const CAMPUS_NAMES = MOSHI_CAMPUSES.map((c) => c.name);

export function campusInfo(name: string): MoshiCampus | undefined {
  return MOSHI_CAMPUSES.find((c) => c.name === name);
}

/** 前の入力シートの6桁の受験番号（514410 など）から校舎を当てる。4桁の番号（県一斉模試）は校舎が分からないので ''。 */
export function campusOfExamNo(no: string): string {
  const c = MOSHI_CAMPUSES.find((x) => /^\d{6}$/.test(no) && no.startsWith(x.prefix));
  return c?.name ?? '';
}

/** 県一斉模試の会場名称（「智翔館　佐世保駅前校」など）→ 校舎。智翔館の中等部の会場でなければ ''（RED・ネクスタの教室は入れない）。 */
export function campusOfVenue(venue: string): string {
  const v = String(venue ?? '').replace(/[\s　]/g, '');
  if (!v.includes('智翔館')) return '';
  return MOSHI_CAMPUSES.find((c) => v.includes(c.venue))?.name ?? '';
}

/**
 * 受験番号をそろえる：数字だけにして、4桁より短ければ前に 0 を足す（「10」→「0010」）。
 * 前の入力シートの6桁（514410）は、県一斉模試の番号（下2桁 → 0010）に読み替える。
 */
export function normalizeExamNo(v: unknown): string {
  const s = toHalf(String(v ?? '')).replace(/\D/g, '');
  if (!s) return '';
  if (/^514[0245]\d{2}$/.test(s)) return `00${s.slice(4)}`;
  return s.length < 4 ? s.padStart(4, '0') : s.slice(0, 10);
}

// ---- 教科 -----------------------------------------------------------------

export const SUBJECT_KEYS = ['ja', 'en', 'ma', 'so', 'sc'] as const;
export type SubjectKey = (typeof SUBJECT_KEYS)[number];
export const SUBJECT_NAMES: Record<SubjectKey, string> = { ja: '国語', en: '英語', ma: '数学', so: '社会', sc: '理科' };
export const SUBJECT_SHORT: Record<SubjectKey, string> = { ja: '国', en: '英', ma: '数', so: '社', sc: '理' };

export type Question = { max: number; topic: string };
export type ExamSubject = { key: SubjectKey; questions: Question[] };
export type ScheduleRow = { label: string; time: string };

// 成績表の列（5教科・三教科（国英数）・五教科）
export const STAT_KEYS = ['ja', 'en', 'ma', 'so', 'sc', 'k3', 'k5'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const STAT_NAMES: Record<StatKey, string> = { ...SUBJECT_NAMES, k3: '三教科', k5: '五教科' };
export const K3_KEYS: SubjectKey[] = ['ja', 'en', 'ma'];

/**
 * 偏差値の換算に使う平均点・標準偏差（任意）。本番レベル模試は智翔館の塾生だけが受けるので、
 * 県全体の模試（例：長崎県一斉模試の「得点ー偏差値 換算表」）の値を参考に入れて、県内での位置に換算する。
 * 入れた項目だけ、成績表の平均点・偏差値・母数をこの値で出す（偏差値は平均点と標準偏差の両方があるとき）。
 * 無ければ智翔館の受験者で計算する。偏差値は換算表と同じく 25.0〜75.0 に収める。
 */
export type OutsideStats = {
  source: string;   // 出典（例「第2回 長崎県一斉模試 2026年10月」）。成績表の下に出す
  n: number | null; // 母数（受験者数）
  mean: Partial<Record<StatKey, number | null>>;
  sd: Partial<Record<StatKey, number | null>>;
};

/**
 * 志望校の判定基準（県全体の模試の「志望校別判定基準得点一覧」を参考に入れる）。
 * 判定教科（傾斜配点）で計算した得点を、B判定基準得点と比べて A〜E を出す。
 * 定員を入れると、入学後のおよその順位（仮想順位）も出す。
 */
export type JudgeLine = {
  code: string;            // 志望校コード（入力シートのコード。例 40200）か学校名
  ref: string;             // 判定基準の学校コード（例 518-01）
  refName: string;         // 判定基準の学校名（例 県立佐世保北 普通科）
  rule: string;            // 判定教科（例 5科合計・3科合計・国数英1.5倍・英数2倍、国理1.5倍・国数のみ）
  bDev: number | null;     // B判定基準偏差値
  bScore: number | null;   // B判定基準得点（判定教科の配点で）
  capacity: number | null; // 定員（仮想順位に使う）
};
export type JudgeGrade = 'A' | 'B' | 'C' | 'D' | 'E';

/**
 * 判定と仮想順位の決まり。
 *   step   … 判定のあいだの偏差値の幅。B判定基準から +step で A、-step で C、-2×step で D、それより下が E
 *   spread … 入学する生徒の偏差値のばらつき（標準偏差）。B判定基準偏差値を入学者の真ん中とみて、定員の中の順位に換算する
 */
export type JudgeOptions = { step: number; spread: number };
export const DEFAULT_JUDGE_OPTIONS: JudgeOptions = { step: 3, spread: 5 };
export const DEV_MIN = 25;
export const DEV_MAX = 75;

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
  outside: OutsideStats;      // 偏差値の換算に使う平均点・標準偏差（任意）
  judges: JudgeLine[];        // 志望校の判定基準（任意）
  judgeOptions: JudgeOptions; // 判定・仮想順位の決まり
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
};

export const MAX_JUDGES = 120;

export function emptyOutside(): OutsideStats {
  return { source: '', n: null, mean: {}, sd: {} };
}

export function cloneOutside(o: OutsideStats | null | undefined): OutsideStats {
  return { source: o?.source ?? '', n: o?.n ?? null, mean: { ...(o?.mean ?? {}) }, sd: { ...(o?.sd ?? {}) } };
}

function numOrNull(v: unknown): number | null {
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 保存してある設定（JSON）から、換算の基準・判定基準・判定の決まりを読む（古い形や欠けた項目があっても壊れない）。 */
export function readExamExtras(cfg: Record<string, unknown> | null | undefined): Pick<MoshiExam, 'outside' | 'judges' | 'judgeOptions'> {
  const o = (cfg?.outside ?? {}) as Record<string, unknown>;
  const outside: OutsideStats = {
    source: String(o.source ?? ''),
    n: numOrNull(o.n),
    mean: { ...((o.mean as OutsideStats['mean']) ?? {}) },
    sd: { ...((o.sd as OutsideStats['sd']) ?? {}) },
  };
  const judges: JudgeLine[] = (Array.isArray(cfg?.judges) ? (cfg!.judges as Record<string, unknown>[]) : [])
    .map((j) => ({
      code: String(j?.code ?? ''), ref: String(j?.ref ?? ''), refName: String(j?.refName ?? ''), rule: String(j?.rule ?? ''),
      bDev: numOrNull(j?.bDev), bScore: numOrNull(j?.bScore), capacity: numOrNull(j?.capacity),
    }))
    .filter((j) => j.code);
  const jo = (cfg?.judgeOptions ?? {}) as Record<string, unknown>;
  return {
    outside, judges,
    judgeOptions: { step: numOrNull(jo.step) ?? DEFAULT_JUDGE_OPTIONS.step, spread: numOrNull(jo.spread) ?? DEFAULT_JUDGE_OPTIONS.spread },
  };
}

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
    // 換算の基準（県一斉模試などの参考データ）と判定基準は、新しい参考データが出るまで同じものを使うので写す
    outside: cloneOutside(base?.outside),
    judges: (base?.judges ?? []).map((j) => ({ ...j })),
    judgeOptions: { ...DEFAULT_JUDGE_OPTIONS, ...(base?.judgeOptions ?? {}) },
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

/**
 * 志望校の欄：県一斉模試の志望校コード（518-01）にそろえる。「51801」「518ー01」も 518-01 にする。
 * 前の入力シートの5桁のコード（40200）は、mapLegacy（lib/moshi/schools.ts の toKenCode）があれば県一斉のコードに読み替える
 * （読み替えられなければ5桁のまま残す）。それ以外は学校名として前後の空白だけ落とす。
 */
export function normalizeChoice(v: unknown, mapLegacy?: (code: string) => string): string {
  const raw = String(v ?? '').trim();
  const half = toHalf(raw).replace(/\s/g, '');
  const ken = /^(\d{3})[-‐ー−]?(\d{2})$/.exec(half);
  if (ken && !/^\d{5}$/.test(half)) return `${ken[1]}-${ken[2]}`;
  // 5桁は、前の入力シートのコード（40200）か、県一斉のコードを「-」を抜いて打ったもの（51801）。どちらかは mapLegacy が決める
  if (/^\d{5}$/.test(half)) return mapLegacy?.(half) || half;
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
  const rawNo = toHalf(String(r.examNo ?? '')).replace(/\s/g, '');
  if (rawNo && !/^\d{1,10}$/.test(rawNo)) return { ok: false, reason: 'bad_exam_no', detail: rawNo };
  const examNo = normalizeExamNo(rawNo);
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
  const outside = cleanOutside(r.outside);
  if (!outside) return { ok: false, reason: 'bad_outside' };
  const judges: JudgeLine[] = [];
  for (const j of (Array.isArray(r.judges) ? (r.judges as Record<string, unknown>[]) : []).slice(0, MAX_JUDGES)) {
    const code = normalizeChoice(j?.code);
    if (!code) continue;
    const rule = String(j?.rule ?? '').trim().slice(0, 30);
    if (rule && !parseRule(rule)) return { ok: false, reason: 'bad_rule', detail: `${code} ${rule}` };
    const bDev = optNumber(j?.bDev, 0, 100);
    const bScore = optNumber(j?.bScore, 0, 2000);
    const capacity = optNumber(j?.capacity, 1, 5000, true);
    if (bDev === undefined || bScore === undefined || capacity === undefined) return { ok: false, reason: 'bad_judge', detail: code };
    judges.push({
      code, rule, bDev, bScore, capacity,
      ref: toHalf(String(j?.ref ?? '')).trim().slice(0, 12),
      refName: String(j?.refName ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
    });
  }
  const jo = (r.judgeOptions ?? {}) as Record<string, unknown>;
  const step = optNumber(jo.step, 0.5, 20);
  const spread = optNumber(jo.spread, 0.5, 30);
  if (step === undefined || spread === undefined) return { ok: false, reason: 'bad_judge_options' };
  return {
    ok: true,
    value: {
      name, grade, date, subjects, schedule,
      belongings: String(r.belongings ?? '').trim().slice(0, MAX_TEXT),
      notes: String(r.notes ?? '').trim().slice(0, MAX_TEXT),
      venues, outside, judges,
      judgeOptions: { step: step ?? DEFAULT_JUDGE_OPTIONS.step, spread: spread ?? DEFAULT_JUDGE_OPTIONS.spread },
    },
  };
}

/** 空なら null、範囲内の数なら数、読めなければ undefined。 */
function optNumber(v: unknown, min: number, max: number, int = false): number | null | undefined {
  const s = toHalf(String(v ?? '')).trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) return undefined;
  return n;
}

function cleanOutside(raw: unknown): OutsideStats | null {
  const o = (raw ?? {}) as { source?: unknown; n?: unknown; mean?: Record<string, unknown>; sd?: Record<string, unknown> };
  const n = optNumber(o.n, 0, 1_000_000, true);
  if (n === undefined) return null;
  const out: OutsideStats = { source: String(o.source ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), n, mean: {}, sd: {} };
  for (const k of STAT_KEYS) {
    const m = optNumber(o.mean?.[k], 0, 1000);
    const d = optNumber(o.sd?.[k], 0, 1000);
    if (m === undefined || d === undefined) return null;
    if (m != null) out.mean[k] = m;
    if (d != null) out.sd[k] = d;
  }
  return out;
}

// ---- 受験番号 -------------------------------------------------------------

/** その校舎の次の受験番号（校舎の中の4桁の番号の最大＋1）。used はその校舎の受験番号だけを渡す。 */
export function nextExamNo(campus: string, used: string[]): string {
  if (!campusInfo(campus)) return '';
  let max = 0;
  for (const no of used) {
    if (!/^\d{1,4}$/.test(no)) continue;
    const n = Number(no);
    if (n > max) max = n;
  }
  return String(max + 1).padStart(4, '0');
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
  total3: number | null; // 三教科（国英数）。3教科とも受けた人だけ
  rank3: number | null;
  dev3: number | null;
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
  total3: Stat | null;
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

function groupStats(exam: MoshiExam, rows: { r: MoshiResult; sub: Record<SubjectKey, number | null>; total: number | null; total3: number | null }[]): GroupStats {
  const sub = {} as Record<SubjectKey, Stat | null>;
  const questionMean = {} as Record<SubjectKey, number[]>;
  for (const k of SUBJECT_KEYS) {
    const takers = rows.filter((x) => x.sub[k] != null);
    sub[k] = statOf(takers.map((x) => x.sub[k] as number));
    const qn = subjectOf(exam, k).questions.length;
    questionMean[k] = Array.from({ length: qn }, (_, i) =>
      takers.length ? takers.reduce((a, x) => a + (x.r.scores[k]?.[i] ?? 0), 0) / takers.length : 0);
  }
  return {
    total: statOf(rows.filter((x) => x.total != null).map((x) => x.total as number)),
    total3: statOf(rows.filter((x) => x.total3 != null).map((x) => x.total3 as number)),
    sub, questionMean,
  };
}

/** 1回分の集計。results はその回の行だけでも、全部の回の行でもよい（examId で絞る）。 */
export function computeStats(exam: MoshiExam, results: MoshiResult[]): ExamStats {
  const mine = results.filter((r) => r.examId === exam.id);
  const base = mine.map((r) => {
    const sub = {} as Record<SubjectKey, number | null>;
    for (const k of SUBJECT_KEYS) sub[k] = subjectTotal(r, k);
    const complete = SUBJECT_KEYS.every((k) => sub[k] != null);
    const total = complete ? SUBJECT_KEYS.reduce((a, k) => a + (sub[k] as number), 0) : null;
    const total3 = K3_KEYS.every((k) => sub[k] != null) ? K3_KEYS.reduce((a, k) => a + (sub[k] as number), 0) : null;
    return { r, sub, total, total3, complete };
  });
  const overall = groupStats(exam, base);
  const byCampus: Record<string, GroupStats> = {};
  for (const c of new Set(base.map((x) => x.r.campus))) byCampus[c] = groupStats(exam, base.filter((x) => x.r.campus === c));

  const totals = base.filter((x) => x.total != null).map((x) => x.total as number);
  const totals3 = base.filter((x) => x.total3 != null).map((x) => x.total3 as number);
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
      rank3: x.total3 == null ? null : rankIn(totals3, x.total3),
      dev3: x.total3 == null ? null : deviation(x.total3, overall.total3),
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

export type HistoryPoint = { exam: MoshiExam; row: RowStat; n: number };

/** その回の中で、target と同じ生徒の行（氏名が同じで、受験番号か校舎が同じ）。 */
export function sameStudent(stats: ExamStats, target: Pick<MoshiResult, 'name' | 'examNo' | 'campus'>): RowStat | null {
  const key = nameKey(target.name);
  if (!key) return null;
  return stats.rows.find((x) => nameKey(x.r.name) === key && ((target.examNo && x.r.examNo === target.examNo) || x.r.campus === target.campus)) ?? null;
}

/**
 * 同じ生徒のこれまでの回（古い順）。氏名（空白・★を除いて）が同じで、受験番号か校舎が同じ行を同じ人とみなす
 * （受験番号は回をまたいで同じことが多いが、付け直したときにも追えるように校舎でも拾う）。
 */
export function historyOf(statsList: ExamStats[], target: MoshiResult): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const s of statsList) {
    const row = sameStudent(s, target);
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
export function parsePaste(text: string, exam: MoshiExam, mapLegacy?: (code: string) => string): PasteResult {
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
    // A列（通し番号 1〜3桁）から選んだときは1つずらす（次の列が受験番号＝4桁以上の数字）
    if (/^\d{1,3}$/.test(toHalf(cells[0] ?? '')) && /^\d{4,}$/.test(toHalf(cells[1] ?? ''))) cells = cells.slice(1);
    const first = toHalf(cells[0] ?? '').replace(/\s/g, '');
    let examNo = '';
    // 受験番号（県一斉模試の4桁。「10」のように0を省いても、前の入力シートの 514410 でもよい）。
    // 受験番号の列が空の行（番号をまだ振っていない人）も、列の並びは同じとみなす
    if (/^\d{1,10}$/.test(first)) { examNo = normalizeExamNo(first); cells = cells.slice(1); } else if (first === '' && cells.length > 1) cells = cells.slice(1);
    const name = normalizeName(cells[0] ?? '');
    const gender = normalizeGender(cells[1]);
    const choices = [2, 3, 4, 5].map((i) => normalizeChoice(cells[i], mapLegacy));
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
        let shifted = '';
        SUBJECT_KEYS.forEach((k, si) => {
          const qs = subjectOf(exam, k).questions;
          sc[k] = [];
          for (let i = 0; i < qCounts[si]; i++) {
            const v = parseScore(cols[p++], qs[i].max);
            if (!v.ok) { bad ||= `${SUBJECT_NAMES[k]}${i + 1}`; sc[k].push(null); } else sc[k].push(v.value);
          }
          // 「計」の列。数字が入っていて大問の合計と合わなければ、列の並び（大問の数）が今回の回と違う
          //（例：数学の大問が6つの前の回の形の行を、大問5つの回に貼った）。ずれたまま読まない
          const total = toHalf(String(cols[p++] ?? '')).trim();
          const sum = sc[k].reduce<number>((a, v) => a + (v ?? 0), 0);
          if (/^\d+$/.test(total) && Number(total) !== sum && sc[k].some((v) => v != null)) shifted ||= SUBJECT_NAMES[k];
        });
        if (shifted) {
          warnings.push(`${lineNo}行目：${shifted}の「計」が大問の合計と合いません。大問の数が今回の回と違う形の行のようなので、得点は読まずに名簿だけ読みました`);
          scores = null;
        } else {
          if (bad) warnings.push(`${lineNo}行目：${bad} の得点が読めないか配点を超えているので、空欄にしました`);
          // 入力シートの式（計＝0）だけで中身が無い行は、得点なしとして扱う
          scores = SUBJECT_KEYS.some((k) => sc[k].some((v) => v != null)) ? sc : null;
        }
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
      ...r.choices.map((c) => (/^\d{3}-\d{2}$|^\d{5}$/.test(c) ? c : '')),
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

// ---- 成績表（元の帳票「公立高校・高専本番レベル模試」の形） ----------------------

export type Figure = {
  key: StatKey; label: string; max: number;
  score: number | null;
  mean: number | null;   // 平均点（業者の集計があればその値）
  dev: number | null;    // 偏差値（業者の平均点と標準偏差があればその値で計算）
  rank: number | null;   // 順位（智翔館の受験者の中で）
  rankN: number;         // 順位の母数（智翔館）
  n: number;             // 母数（業者の集計があればその値）
  outside: boolean;      // 平均点を業者の集計で出したか
};

/** 成績表の得点表の7列（国・英・数・社・理・三教科・五教科）。 */
export function reportFigures(stats: ExamStats, row: RowStat): Figure[] {
  const { exam } = stats;
  const o = exam.outside ?? emptyOutside();
  return STAT_KEYS.map((key) => {
    let score: number | null, inside: Stat | null, rank: number | null, dev: number | null, max: number;
    if (key === 'k5') {
      score = row.total; inside = stats.overall.total; rank = row.rank; dev = row.dev; max = examMax(exam);
    } else if (key === 'k3') {
      score = row.total3; inside = stats.overall.total3; rank = row.rank3; dev = row.dev3;
      max = K3_KEYS.reduce((a, k) => a + subjectMax(exam, k), 0);
    } else {
      score = row.sub[key]; inside = stats.overall.sub[key]; rank = row.subRank[key]; dev = row.subDev[key]; max = subjectMax(exam, key);
    }
    const om = o.mean?.[key] ?? null;
    const osd = o.sd?.[key] ?? null;
    if (score != null && om != null && osd != null && osd > 0) dev = 50 + (10 * (score - om)) / osd;
    if (dev != null) dev = clampDev(dev);
    return {
      key, label: STAT_NAMES[key], max, score,
      mean: om ?? inside?.mean ?? null,
      dev, rank, rankN: inside?.n ?? 0,
      n: o.n ?? inside?.n ?? 0,
      outside: om != null,
    };
  });
}

/** 偏差値を換算表と同じく 25.0〜75.0 に収める。 */
export function clampDev(d: number): number {
  return Math.min(DEV_MAX, Math.max(DEV_MIN, d));
}

// ---- 志望校判定・仮想順位 -------------------------------------------------------

const RULE_CHARS: Record<string, SubjectKey> = { 国: 'ja', 英: 'en', 数: 'ma', 社: 'so', 理: 'sc' };

/**
 * 判定教科の文字 → 教科ごとの倍率。判定基準得点一覧の書き方に合わせる。
 *   5科合計 → 5教科×1 ／ 3科合計 → 国英数×1 ／ 国数のみ → 国数×1
 *   国数英1.5倍 → 国数英×1.5・社理×1 ／ 英数2倍、国理1.5倍 → 英数×2・国理×1.5・社×1 ／ 英語2倍、数国1.5倍 など
 * 読めなければ null。
 */
export function parseRule(rule: string): Record<SubjectKey, number> | null {
  const s = toHalf(String(rule ?? '')).replace(/[\s　]/g, '');
  if (!s) return null;
  const w = { ja: 1, en: 1, ma: 1, so: 1, sc: 1 } as Record<SubjectKey, number>;
  if (/^5科(合計)?$/.test(s)) return w;
  if (/^3科(合計)?$/.test(s)) return { ja: 1, en: 1, ma: 1, so: 0, sc: 0 };
  const only = /^([国英数社理語]+)のみ$/.exec(s);
  if (only) {
    const o = { ja: 0, en: 0, ma: 0, so: 0, sc: 0 } as Record<SubjectKey, number>;
    for (const c of only[1]) if (RULE_CHARS[c]) o[RULE_CHARS[c]] = 1;
    return Object.values(o).some((v) => v > 0) ? o : null;
  }
  const re = /([国英数社理語]+)(\d+(?:\.\d+)?)倍/g;
  let m: RegExpExecArray | null;
  let any = false;
  let rest = s;
  while ((m = re.exec(s))) {
    any = true;
    for (const c of m[1]) if (RULE_CHARS[c]) w[RULE_CHARS[c]] = Number(m[2]);
    rest = rest.replace(m[0], '');
  }
  if (!any || rest.replace(/[、,，・]/g, '') !== '') return null;
  return w;
}

/** 判定教科の配点（満点）。 */
export function ruleMax(exam: MoshiExam, weights: Record<SubjectKey, number>): number {
  return SUBJECT_KEYS.reduce((a, k) => a + weights[k] * subjectMax(exam, k), 0);
}

/** 標準正規分布の累積（Φ）。erf の近似（誤差 1.5e-7）。 */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export type Judgement = {
  line: JudgeLine | null;
  score: number | null;   // 判定用の得点（判定教科の傾斜をかけたもの）
  max: number | null;     // 判定用の満点
  dev: number | null;     // 判定用の得点の偏差値（換算）
  lines: Record<'A' | 'B' | 'C' | 'D', number> | null; // 判定ライン（判定用の得点で）
  grade: JudgeGrade | null;
  next: { grade: JudgeGrade; gap: number } | null; // あと何点で次の判定か
  rank: { rank: number; capacity: number } | null; // 仮想順位（入学後のおよその順位）
};

const GRADE_ORDER: JudgeGrade[] = ['A', 'B', 'C', 'D', 'E'];
const LINE_OFFSET: Record<'A' | 'B' | 'C' | 'D', number> = { A: 1, B: 0, C: -1, D: -2 };

/** 志望校の判定基準。志望校コード（県一斉の 518-01）で引く。前の5桁のコードで作った行は、基準の学校（ref）でも引ける。 */
export function judgeLineFor(exam: MoshiExam, choice: string): JudgeLine | null {
  const key = choiceKey(choice);
  if (!key) return null;
  const js = exam.judges ?? [];
  return js.find((j) => choiceKey(j.code) === key) ?? js.find((j) => j.ref && choiceKey(j.ref) === key) ?? null;
}

/**
 * 志望校の判定と仮想順位。
 *  1. 判定用の得点：判定教科の倍率をかけた合計（倍率のかかる教科がそろっていなければ出さない）
 *  2. 判定用の平均：教科ごとの平均点（換算の基準があればその値）に同じ倍率をかけた合計
 *  3. 偏差値1あたりの点：B判定基準得点と B判定基準偏差値から（基準得点 − 平均）÷（基準偏差値 − 50）。
 *     偏差値が 50 ちょうどなどで出せないときは、五教科の標準偏差を満点の比で広げた値を使う
 *  4. 判定ライン：B判定基準得点を B。そこから偏差値 step ずつ上が A、下が C・D（judgeOptions.step）。D より下は E
 *  5. 仮想順位：判定用の偏差値と B判定基準偏差値の差を、入学者の偏差値のばらつき（judgeOptions.spread）で割り、
 *     B判定基準偏差値を入学者の真ん中とみて、定員の中で上から何番目にあたるかに換算する
 * いずれも県全体の模試の基準を参考にした目安。
 */
export function judgeOf(stats: ExamStats, row: RowStat, choice: string): Judgement {
  const { exam } = stats;
  const line = judgeLineFor(exam, choice);
  const empty: Judgement = { line, score: null, max: null, dev: null, lines: null, grade: null, next: null, rank: null };
  if (!line) return empty;
  const weights = parseRule(line.rule || '5科合計');
  if (!weights) return empty;
  const max = ruleMax(exam, weights);
  const keys = SUBJECT_KEYS.filter((k) => weights[k] > 0);
  const score = keys.every((k) => row.sub[k] != null) ? keys.reduce((a, k) => a + weights[k] * (row.sub[k] as number), 0) : null;
  const meanOf = (k: SubjectKey) => exam.outside?.mean?.[k] ?? stats.overall.sub[k]?.mean ?? null;
  const means = keys.map(meanOf);
  const meanW = means.every((v) => v != null) ? keys.reduce((a, k, i) => a + weights[k] * (means[i] as number), 0) : null;
  const sd5 = exam.outside?.sd?.k5 ?? stats.overall.total?.sd ?? 90;
  const fallbackUnit = (sd5 * (max / Math.max(1, examMax(exam)))) / 10;
  let unit = fallbackUnit;
  if (line.bScore != null && line.bDev != null && meanW != null && Math.abs(line.bDev - 50) >= 0.5) {
    const u = (line.bScore - meanW) / (line.bDev - 50);
    if (u > 0) unit = u;
  }
  const bScore = line.bScore ?? (line.bDev != null && meanW != null ? meanW + (line.bDev - 50) * unit : null);
  const bDev = line.bDev ?? (line.bScore != null && meanW != null ? 50 + (line.bScore - meanW) / unit : null);
  const dev = score != null && meanW != null ? 50 + (score - meanW) / unit : null;
  const step = exam.judgeOptions?.step ?? DEFAULT_JUDGE_OPTIONS.step;
  const spread = exam.judgeOptions?.spread ?? DEFAULT_JUDGE_OPTIONS.spread;
  const lines = bScore == null ? null : (Object.fromEntries((['A', 'B', 'C', 'D'] as const).map((g) => [
    g, Math.max(0, Math.min(max, Math.ceil(bScore + LINE_OFFSET[g] * step * unit - 1e-9))),
  ])) as Record<'A' | 'B' | 'C' | 'D', number>);
  if (score == null || !lines) return { ...empty, score, max, dev, lines };
  let grade: JudgeGrade = 'E';
  for (const g of ['A', 'B', 'C', 'D'] as const) if (score >= lines[g]) { grade = g; break; }
  let next: Judgement['next'] = null;
  const gi = GRADE_ORDER.indexOf(grade);
  if (gi > 0) {
    const g = GRADE_ORDER[gi - 1] as 'A' | 'B' | 'C' | 'D';
    next = { grade: g, gap: Math.max(1, Math.ceil(lines[g] - score - 1e-9)) };
  }
  let rank: Judgement['rank'] = null;
  if (line.capacity && dev != null && bDev != null && spread > 0) {
    const above = 1 - normCdf((dev - bDev) / spread); // 入学者のうち、自分より上にいる人の割合
    rank = { rank: Math.min(line.capacity, Math.max(1, Math.ceil(line.capacity * above))), capacity: line.capacity };
  }
  return { line, score, max, dev, lines, grade, next, rank };
}

export type Bin = { label: string; count: number; mine: boolean };

/** 五教科の得点の分布（高い点から。元の帳票と同じく25点きざみ「476～500」…「0～25」）。 */
export function scoreBins(stats: ExamStats, row: RowStat | null, size = 25): Bin[] {
  const totals = stats.rows.filter((x) => x.total != null).map((x) => x.total as number);
  return scoreBinsOf(totals, row?.total ?? null, examMax(stats.exam), size);
}

/** 得点の分布（高い点から size 点きざみ）。totals＝全員の得点、mine＝本人の得点。 */
export function scoreBinsOf(totals: number[], mine: number | null, max: number, size = 25): Bin[] {
  const nb = Math.max(1, Math.ceil(max / size));
  const out: Bin[] = [];
  for (let i = nb - 1; i >= 0; i--) {
    const lo = i === 0 ? 0 : i * size + 1;
    const hi = Math.min(max, (i + 1) * size);
    out.push({
      label: `${lo}～${hi}`,
      count: totals.filter((t) => t >= lo && t <= hi).length,
      mine: mine != null && mine >= lo && mine <= hi,
    });
  }
  return out;
}

/** 五教科の偏差値（業者の平均点・標準偏差があればその値で計算。成績表の得点表と同じ）。 */
export function dev5Of(exam: MoshiExam, row: RowStat): number | null {
  if (row.total == null) return null;
  const om = exam.outside?.mean?.k5;
  const osd = exam.outside?.sd?.k5;
  if (om != null && osd != null && osd > 0) return clampDev(50 + (10 * (row.total - om)) / osd);
  return row.dev == null ? null : clampDev(row.dev);
}

/** 五教科の偏差値の分布（高いほうから。2.5 きざみで、75 以上・25 未満はまとめる）。 */
export function devBins(stats: ExamStats, row: RowStat | null, width = 2.5, lo = 25, hi = 75): Bin[] {
  const devs = stats.rows.map((x) => dev5Of(stats.exam, x)).filter((d): d is number => d != null);
  return devBinsOf(devs, row ? dev5Of(stats.exam, row) : null, width, lo, hi);
}

/** 偏差値の分布（高いほうから width きざみ。hi 以上・lo 未満はまとめる）。devs＝全員、mine＝本人。 */
export function devBinsOf(devs: number[], mine: number | null, width = 2.5, lo = 25, hi = 75): Bin[] {
  const inBin = (d: number, a: number, b: number) => d >= a && d < b;
  const out: Bin[] = [{ label: `${hi.toFixed(1)}以上`, count: devs.filter((d) => d >= hi).length, mine: mine != null && mine >= hi }];
  for (let b = hi - width; b >= lo - 1e-9; b -= width) {
    out.push({ label: b.toFixed(1), count: devs.filter((d) => inBin(d, b, b + width)).length, mine: mine != null && inBin(mine, b, b + width) });
  }
  out.push({ label: `${lo.toFixed(1)}未満`, count: devs.filter((d) => d < lo).length, mine: mine != null && mine < lo });
  return out;
}

/** 年度（4月はじまり）。日付が無ければ null。 */
export function schoolYear(date: string): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(date || '');
  if (!m) return null;
  return +m[2] >= 4 ? +m[1] : +m[1] - 1;
}

/** 同じ年度・同じ学年の回（実施日の古い順）。成績表の「教科別偏差値推移」の行になる（まだ受けていない回も入る）。 */
export function yearExams(exams: MoshiExam[], exam: Pick<MoshiExam, 'id' | 'date' | 'grade'>): MoshiExam[] {
  const fy = schoolYear(exam.date);
  if (fy == null) return exams.filter((e) => e.id === exam.id);
  return exams
    .filter((e) => e.id === exam.id || (e.grade === exam.grade && schoolYear(e.date) === fy))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

export type TrendRow = {
  key: string;
  kind: 'honban' | 'ken'; // 本番レベル模試 ／ 県一斉模試
  label: string;          // 「11月」など
  date: string;
  current: boolean;       // この成績表の回
  dev: Record<StatKey, number | null>;
};

function monthOf(name: string, date: string): string {
  const m = /(\d{1,2})月/.exec(name);
  if (m) return `${+m[1]}月`;
  const d = /^\d{4}-(\d{2})/.exec(date || '');
  return d ? `${+d[1]}月` : name.slice(0, 6);
}

/**
 * 教科別偏差値推移：その年度の回ごとに、7列の偏差値（受けていない回は空）。
 * exam は本番レベル模試の回か、県一斉模試の回（{ id: 'ken-…', name, date, grade: '中3' }）。その回の行が current になる。
 * 本番レベル模試の回に、取り込んだ県一斉模試の回（ken）も実施日の順に並べる。県一斉模試の偏差値は業者の値をそのまま使い、
 * 生徒は「校舎＋受験番号」で結び付ける（氏名は使わない）。
 */
export function trendRows(
  statsList: ExamStats[],
  exam: Pick<MoshiExam, 'id' | 'name' | 'date' | 'grade'>,
  target: Pick<MoshiResult, 'name' | 'examNo' | 'campus'> & { id?: string },
  ken: KenitsuResult[] = [],
): TrendRow[] {
  const out: TrendRow[] = yearExams(statsList.map((s) => s.exam), exam).map((e) => {
    const s = statsList.find((x) => x.exam.id === e.id);
    const row = !s ? null : (target.id ? s.rows.find((x) => x.r.id === target.id) : undefined) ?? sameStudent(s, target);
    const figs = s && row ? reportFigures(s, row) : null;
    const dev = {} as Record<StatKey, number | null>;
    for (const k of STAT_KEYS) dev[k] = figs?.find((f) => f.key === k)?.dev ?? null;
    return { key: e.id, kind: 'honban', label: monthOf(e.name, e.date), date: e.date, current: e.id === exam.id, dev };
  });
  const fy = schoolYear(exam.date);
  if (fy != null) {
    for (const ke of kenExams(ken)) {
      if (schoolYear(ke.date) !== fy) continue;
      const me = target.examNo
        ? ken.find((x) => x.examId === ke.id && x.campus === target.campus && x.examNo === target.examNo)
        : undefined;
      const dev = {} as Record<StatKey, number | null>;
      for (const k of STAT_KEYS) dev[k] = me?.stats[k]?.dev ?? null;
      out.push({ key: ke.id, kind: 'ken', label: monthOf(ke.name, ke.date), date: ke.date, current: ke.id === exam.id, dev });
    }
  }
  return out.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.kind === b.kind ? 0 : a.kind === 'ken' ? -1 : 1));
}

// ---- 県一斉模試の取り込み ------------------------------------------------------
// 県一斉模試（長崎県一斉模試）の集計結果 CSV から、智翔館の中等部の生徒の分を取り込む。
// ★氏名と成績は一緒に扱わない。
//   ・成績（kenScores）：会場名称・受験番号（無ければ ID → 氏名対応表の受験番号）・成績の列だけを読む。氏名の列は読まない
//   ・名簿（kenRoster）：会場名称・受験番号・氏名の列だけを読む。成績の列は読まない
//   ・ID → 受験番号（kenIdMap）：氏名対応表の ID・会場名称・受験番号の列だけを読む。氏名の列は読まない
// 2つは「校舎＋受験番号」で結び付く（受験番号は会場ごとの4桁）。

export const KEN_SLOTS = ['公立第1', '公立第2', '国・私立第1', '国・私立第2'] as const;
export const KEN_STAT_HEAD: Record<StatKey, string> = { ja: '国語', en: '英語', ma: '数学', so: '社会', sc: '理科', k3: '3科合計', k5: '5科合計' };

export type KenStat = { score: number | null; dev: number | null; rank: number | null };
export type KenChoice = { code: string; name: string; judge: string; prob: string };
export type KenitsuResult = {
  examId: string;   // 取り込んだ回（例 ken-2026-10-18）
  examName: string; // 例「長崎県一斉模試 2026年10月」
  date: string;     // YYYY-MM-DD
  campus: string;
  examNo: string;
  gender: Gender;
  naishin: string;  // 内申点（入っていれば）
  stats: Record<StatKey, KenStat>;
  choices: KenChoice[]; // 公立第1・公立第2・国私立第1・国私立第2
};
export type KenitsuExam = { id: string; name: string; date: string; count: number; byCampus: Record<string, number> };

/** CSV（ダブルクォート・改行入りのセル・BOM に対応）→ 行の配列。セルの前後の空白は落とす。 */
export function parseCsv(text: string): string[][] {
  const s = String(text ?? '').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

export type KenTable = { head: string[]; rows: string[][] };

export function kenTable(text: string): KenTable {
  const all = parseCsv(text);
  return { head: (all[0] ?? []).map((h) => h.replace(/[\s　]+/g, ' ').trim()), rows: all.slice(1) };
}

function col(t: KenTable, ...names: string[]): number {
  for (const n of names) {
    const i = t.head.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

function numOrNullCell(v: string | undefined): number | null {
  const s = toHalf(String(v ?? '')).replace(/[,，%％]/g, '').trim();
  if (s === '' || s === '-' || s === '－') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 氏名対応表 → ID から校舎・受験番号を引く表（氏名の列は読まない）。中等部の会場の行だけ。 */
export function kenIdMap(t: KenTable): Map<string, { campus: string; examNo: string }> {
  const iId = col(t, 'ID');
  const iVenue = col(t, '会場名称', '会場');
  const iNo = col(t, '受験番号');
  const out = new Map<string, { campus: string; examNo: string }>();
  if (iId === -1 || iVenue === -1 || iNo === -1) return out;
  for (const r of t.rows) {
    const campus = campusOfVenue(r[iVenue] ?? '');
    const examNo = normalizeExamNo(r[iNo]);
    if (campus && examNo && r[iId]) out.set(r[iId], { campus, examNo });
  }
  return out;
}

export type KenScoresResult = {
  items: KenitsuResult[];
  other: number;     // 中等部の会場ではない行（RED・ネクスタなど）
  noNumber: number;  // 受験番号が分からない行
  missing: string[]; // 足りない列
  needMap: boolean;  // 受験番号の列が無く、ID はある（氏名対応表を一緒に選べば引ける）
};

/**
 * 成績の CSV（集計結果、または成績表_氏名なし）→ 中等部の生徒の成績。氏名の列は読まない。
 * 受験番号の列が無いファイル（成績表_氏名なし）は、idMap（氏名対応表の ID → 受験番号）で受験番号を引く。
 */
export function kenScores(t: KenTable, meta: { examId: string; examName: string; date: string }, idMap?: Map<string, { campus: string; examNo: string }>): KenScoresResult {
  const missing: string[] = [];
  const iVenue = col(t, '会場名称', '会場');
  const iNo = col(t, '受験番号');
  const iId = col(t, 'ID');
  if (iVenue === -1 && !idMap) missing.push('会場名称');
  const needMap = iNo === -1 && iId !== -1 && !idMap;
  if (iNo === -1 && !(iId !== -1 && idMap)) missing.push('受験番号');
  const statCols = {} as Record<StatKey, { s: number; d: number; r: number }>;
  for (const k of STAT_KEYS) {
    const h = KEN_STAT_HEAD[k];
    statCols[k] = { s: col(t, `${h} 得点`), d: col(t, `${h} 偏差値`), r: col(t, `${h} 順位`) };
  }
  if (statCols.k5.s === -1) missing.push('5科合計 得点');
  const iGender = col(t, '性別');
  const iNaishin = col(t, '内申点');
  const out: KenScoresResult = { items: [], other: 0, noNumber: 0, missing, needMap };
  if (missing.length) return out;
  for (const r of t.rows) {
    let campus = iVenue === -1 ? '' : campusOfVenue(r[iVenue] ?? '');
    let examNo = iNo === -1 ? '' : normalizeExamNo(r[iNo]);
    if ((!campus || !examNo) && idMap && iId !== -1) {
      const m = idMap.get(r[iId] ?? '');
      if (m) { campus = campus || m.campus; examNo = examNo || m.examNo; }
    }
    if (!campus) { out.other++; continue; }
    if (!examNo) { out.noNumber++; continue; }
    const stats = {} as Record<StatKey, KenStat>;
    for (const k of STAT_KEYS) {
      const c = statCols[k];
      stats[k] = { score: numOrNullCell(r[c.s]), dev: numOrNullCell(r[c.d]), rank: numOrNullCell(r[c.r]) };
    }
    const choices: KenChoice[] = KEN_SLOTS.map((slot) => ({
      code: normalizeChoice(r[col(t, `${slot} コード`)] ?? ''),
      name: String(r[col(t, `${slot} 志望校名称`)] ?? '').replace(/[\s　]+/g, ' ').trim(),
      judge: String(r[col(t, `${slot} 判定`)] ?? '').trim(),
      prob: String(r[col(t, `${slot} 合格確率`)] ?? '').trim(),
    }));
    out.items.push({
      ...meta, campus, examNo,
      gender: iGender === -1 ? '' : normalizeGender(r[iGender]),
      naishin: iNaishin === -1 ? '' : String(r[iNaishin] ?? '').trim(),
      stats, choices,
    });
  }
  return out;
}

export type KenRosterRow = { campus: string; examNo: string; name: string };

/** 名簿（氏名対応表、または集計結果）→ 中等部の生徒の校舎・受験番号・氏名。成績の列は読まない。 */
export function kenRoster(t: KenTable): { rows: KenRosterRow[]; other: number; missing: string[] } {
  const iVenue = col(t, '会場名称', '会場');
  const iNo = col(t, '受験番号');
  const iName = col(t, '氏名', '生徒氏名');
  const missing = [iVenue === -1 && '会場名称', iNo === -1 && '受験番号', iName === -1 && '氏名'].filter((x): x is string => !!x);
  const out = { rows: [] as KenRosterRow[], other: 0, missing };
  if (missing.length) return out;
  for (const r of t.rows) {
    const campus = campusOfVenue(r[iVenue] ?? '');
    if (!campus) { out.other++; continue; }
    const examNo = normalizeExamNo(r[iNo]);
    const name = normalizeName(r[iName] ?? '');
    if (examNo && name) out.rows.push({ campus, examNo, name });
  }
  return out;
}

/** 取り込んだ県一斉模試の回の一覧（新しい順）。 */
export function kenExams(items: KenitsuResult[]): KenitsuExam[] {
  const m = new Map<string, KenitsuExam>();
  for (const x of items) {
    const e = m.get(x.examId) ?? { id: x.examId, name: x.examName, date: x.date, count: 0, byCampus: {} };
    e.count++;
    e.byCampus[x.campus] = (e.byCampus[x.campus] ?? 0) + 1;
    m.set(x.examId, e);
  }
  return [...m.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// ---- 県一斉模試の成績表・面談 ----------------------------------------------------
// 取り込んだ県一斉模試の成績だけで、個人成績表と面談の画面を出す。
//   ・偏差値・県内順位・判定・合格確率：業者の値（県全体）をそのまま
//   ・塾内順位・塾内平均・分布：その回を受けた智翔館 中等部の生徒（取り込んだ行）の中で計算
//   ・氏名：本番レベル模試の名簿（成績入力の行）から「校舎＋受験番号」で引く（県一斉の行は氏名を持たない）

/** 県一斉模試の教科の満点（国英数社理は各100点）。 */
export const KEN_MAX: Record<StatKey, number> = { ja: 100, en: 100, ma: 100, so: 100, sc: 100, k3: 300, k5: 500 };

export function kenKey(campus: string, examNo: string): string {
  return `${campus}|${examNo}`;
}

/** 名簿（本番レベル模試の回の行）から「校舎＋受験番号 → 氏名」。同じ人が何回にもいれば、新しい回の氏名を使う。 */
export function kenNames(results: Pick<MoshiResult, 'examId' | 'campus' | 'examNo' | 'name'>[], exams: Pick<MoshiExam, 'id' | 'date'>[]): Map<string, string> {
  const dateOf = new Map(exams.map((e) => [e.id, e.date || '']));
  const sorted = [...results].sort((a, b) => (dateOf.get(a.examId) ?? '').localeCompare(dateOf.get(b.examId) ?? ''));
  const out = new Map<string, string>();
  for (const r of sorted) if (r.examNo && r.name) out.set(kenKey(r.campus, r.examNo), r.name);
  return out;
}

export type KenRow = {
  k: KenitsuResult;
  name: string;                            // 名簿に無ければ ''
  inside: Record<StatKey, number | null>;  // 塾内順位（その教科の得点がある人の中。同点は同じ順位）
};
export type KenStats = {
  exam: KenitsuExam;
  rows: KenRow[];
  n: Record<StatKey, number>;              // 塾内の受験者
  mean: Record<StatKey, number | null>;    // 塾内平均
};

/** 県一斉模試の1回分を、成績表・面談用にまとめる（塾内順位・塾内平均）。 */
export function kenStatsOf(items: KenitsuResult[], examId: string, names: Map<string, string>): KenStats | null {
  const exam = kenExams(items).find((e) => e.id === examId);
  if (!exam) return null;
  const mine = items.filter((x) => x.examId === examId);
  const n = {} as Record<StatKey, number>;
  const mean = {} as Record<StatKey, number | null>;
  const vals = {} as Record<StatKey, number[]>;
  for (const key of STAT_KEYS) {
    vals[key] = mine.map((x) => x.stats[key]?.score).filter((v): v is number => v != null);
    n[key] = vals[key].length;
    mean[key] = vals[key].length ? vals[key].reduce((a, b) => a + b, 0) / vals[key].length : null;
  }
  const rows = mine.map((k) => {
    const inside = {} as Record<StatKey, number | null>;
    for (const key of STAT_KEYS) {
      const sc = k.stats[key]?.score;
      inside[key] = sc == null ? null : rankIn(vals[key], sc);
    }
    return { k, name: names.get(kenKey(k.campus, k.examNo)) ?? '', inside };
  });
  return { exam, rows, n, mean };
}

/** その学校を（4つのどれかに）書いた塾内の生徒の中での、5科の順位。書いた人がいなければ null。 */
export function kenChoiceRank(ks: KenStats, row: KenRow, code: string): { n: number; rank: number } | null {
  const me = row.k.stats.k5?.score;
  if (!code || me == null) return null;
  const others = ks.rows.filter((x) => x.k.choices.some((c) => c.code === code)).map((x) => x.k.stats.k5?.score).filter((v): v is number => v != null);
  return others.length ? { n: others.length, rank: rankIn(others, me) } : null;
}

/** 県一斉模試の回を、推移（trendRows）の「この回」として渡す形。 */
export function kenExamRef(e: Pick<KenitsuExam, 'id' | 'name' | 'date'>): Pick<MoshiExam, 'id' | 'name' | 'date' | 'grade'> {
  return { id: e.id, name: e.name, date: e.date, grade: '中3' };
}

// ---- 県一斉模試の面談（詳細） ---------------------------------------------------------
// 業者の成績の画面に近い形で、教科ごとの県平均・偏差値・県内順位、志望校ごとの判定の中身、これまでの回を出す。

export type KenFit = { mean: number; sd: number; n: number };

/**
 * 県全体の平均点・標準偏差を、取り込んだ行の「得点と偏差値」から求める
 * （偏差値＝50＋10×(得点−平均点)÷標準偏差 を最小二乗で当てはめる。25〜75 の外の偏差値は使わない）。
 * 2026年10月の回では、換算表の平均点・標準偏差と一致する。行が5つ未満なら null。
 */
export function kenFitOf(items: KenitsuResult[], examId: string, key: StatKey): KenFit | null {
  const pts = items
    .filter((x) => x.examId === examId)
    .map((x) => x.stats[key])
    .filter((v): v is KenStat => !!v && v.score != null && v.dev != null && v.dev > 25 && v.dev < 75)
    .map((v) => [v.score as number, v.dev as number]);
  const n = pts.length;
  if (n < 5) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  if (!sxx) return null;
  const b = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx;
  if (!(b > 0)) return null;
  const a = my - b * mx;
  return { mean: (50 - a) / b, sd: 10 / b, n };
}

export function kenFits(items: KenitsuResult[], examId: string): Record<StatKey, KenFit | null> {
  const out = {} as Record<StatKey, KenFit | null>;
  for (const key of STAT_KEYS) out[key] = kenFitOf(items, examId, key);
  return out;
}

/** 志望校の判定基準（参考データの1校分：判定教科・B判定基準偏差値・B判定基準得点・満点）。 */
export type KenJudgeBase = { rule: string; bDev: number; bScore: number; max: number };

export type KenJudgeDetail = {
  rule: string;
  max: number;
  score: number | null;  // 判定得点（判定教科の倍率をかけた合計）
  dev: number | null;    // 判定偏差値（基準の資料がこの回のものでないときは null）
  bDev: number;          // 基準偏差値（B判定基準偏差値）
  bScore: number | null; // 基準得点（B判定基準得点。この回の資料のときだけ）
  toB: number | null;    // 基準得点まであと何点（届いていれば 0 以下）
};

/**
 * 志望校の判定の中身。判定得点は判定教科の倍率をかけた合計。
 * 判定偏差値は、判定用の平均（教科の県平均に同じ倍率をかけた合計）と「偏差値1あたりの点＝(基準得点−判定用の平均)÷(基準偏差値−50)」から出す
 * （業者の判定偏差値と同じ。基準の資料がその回のもの＝sameExam のときだけ）。
 */
export function kenJudgeDetail(k: KenitsuResult, base: KenJudgeBase, fits: Record<StatKey, KenFit | null>, sameExam: boolean): KenJudgeDetail | null {
  const w = parseRule(base.rule);
  if (!w) return null;
  let score: number | null = 0;
  let wMean: number | null = 0;
  for (const key of SUBJECT_KEYS) {
    if (!w[key]) continue;
    const sc = k.stats[key]?.score;
    const m = fits[key]?.mean;
    score = score == null || sc == null ? null : score + w[key] * sc;
    wMean = wMean == null || m == null ? null : wMean + w[key] * m;
  }
  const out: KenJudgeDetail = { rule: base.rule, max: base.max, score: score == null ? null : round1(score), dev: null, bDev: base.bDev, bScore: null, toB: null };
  if (!sameExam) return out;
  out.bScore = base.bScore;
  if (score != null) out.toB = Math.ceil(round1(base.bScore - score));
  if (score != null && wMean != null && base.bDev !== 50) {
    const ppd = (base.bScore - wMean) / (base.bDev - 50);
    if (ppd > 0) out.dev = round1(50 + (score - wMean) / ppd);
  }
  return out;
}

/** その学校を（4つのどれかに）書いた塾内の生徒：人数・本人の順位（判定得点、無ければ5科）・判定偏差値（無ければ5科偏差値）の平均。 */
export function kenSchoolGroup(
  ks: KenStats, row: KenRow, code: string,
  base: KenJudgeBase | null, fits: Record<StatKey, KenFit | null>, sameExam: boolean,
): { n: number; rank: number | null; avgDev: number | null } | null {
  if (!code) return null;
  const group = ks.rows.filter((x) => x.k.choices.some((c) => c.code === code));
  if (!group.length) return null;
  const detail = (x: KenRow) => (base ? kenJudgeDetail(x.k, base, fits, sameExam) : null);
  const scoreOf = (x: KenRow) => detail(x)?.score ?? x.k.stats.k5?.score ?? null;
  const devOf = (x: KenRow) => detail(x)?.dev ?? x.k.stats.k5?.dev ?? null;
  const scores = group.map(scoreOf).filter((v): v is number => v != null);
  const mine = scoreOf(row);
  const devs = group.map(devOf).filter((v): v is number => v != null);
  return {
    n: group.length,
    rank: mine == null || !group.some((x) => x === row || (x.k.campus === row.k.campus && x.k.examNo === row.k.examNo)) ? null : rankIn(scores, mine),
    avgDev: devs.length ? round1(devs.reduce((a, b) => a + b, 0) / devs.length) : null,
  };
}

/** その学校を第1志望（公立第1か国・私立第1）にした塾内の生徒の、教科ごとの平均点。 */
export function kenFirstChoiceMean(ks: KenStats, code: string): { n: number; mean: Record<SubjectKey, number | null> } {
  const group = ks.rows.filter((x) => code && (x.k.choices[0]?.code === code || x.k.choices[2]?.code === code));
  const mean = {} as Record<SubjectKey, number | null>;
  for (const key of SUBJECT_KEYS) {
    const v = group.map((x) => x.k.stats[key]?.score).filter((s): s is number => s != null);
    mean[key] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  return { n: group.length, mean };
}

/** 同じ生徒（校舎＋受験番号）の、取り込んだ県一斉模試の全部の回（古い順）。 */
export function kenHistory(items: KenitsuResult[], campus: string, examNo: string): KenitsuResult[] {
  return items.filter((x) => x.campus === campus && x.examNo === examNo).sort((a, b) => a.date.localeCompare(b.date));
}

/** ファイル名（「…_2026年10月_…」）から回名と実施日の見当をつける（日は分からないので1日）。 */
export function kenGuessFromFileName(fileName: string): { name: string; date: string } {
  const m = /(\d{4})年(\d{1,2})月/.exec(fileName ?? '');
  if (!m) return { name: '長崎県一斉模試', date: '' };
  return { name: `長崎県一斉模試 ${m[1]}年${+m[2]}月`, date: `${m[1]}-${String(+m[2]).padStart(2, '0')}-01` };
}

export const MAX_KEN_ROWS = 400;

/** API で受け取った県一斉模試の1行を確かめて整える（氏名の項目は持たない）。 */
export function cleanKenItem(raw: unknown, meta: { examId: string; examName: string; date: string }): KenitsuResult | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const campus = String(r.campus ?? '');
  if (!CAMPUS_NAMES.includes(campus)) return null;
  const examNo = normalizeExamNo(r.examNo);
  if (!examNo) return null;
  const st = (r.stats ?? {}) as Record<string, Record<string, unknown>>;
  const num = (v: unknown, max: number) => {
    const n = v == null || v === '' ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
  };
  const stats = {} as Record<StatKey, KenStat>;
  for (const k of STAT_KEYS) stats[k] = { score: num(st[k]?.score, 1000), dev: num(st[k]?.dev, 100), rank: num(st[k]?.rank, 1_000_000) };
  const ch = Array.isArray(r.choices) ? (r.choices as Record<string, unknown>[]) : [];
  return {
    ...meta, campus, examNo,
    gender: normalizeGender(r.gender),
    naishin: String(r.naishin ?? '').slice(0, 10),
    stats,
    choices: KEN_SLOTS.map((_, i) => ({
      code: normalizeChoice(ch[i]?.code ?? ''), name: String(ch[i]?.name ?? '').slice(0, 40),
      judge: String(ch[i]?.judge ?? '').slice(0, 4), prob: String(ch[i]?.prob ?? '').slice(0, 6),
    })),
  };
}
