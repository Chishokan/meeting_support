// 適性検査の型と定数（画面・API・保存で共通。サーバ／ブラウザどちらからも使う）。
//
// 設問は100問・10尺度（設問番号の一の位で尺度が決まる）。設問・尺度・判定基準は「版」ごとに持ち、
// 受検はどの版で受けたかを記録する。判定基準は職種（講師／事務／社員）ごとに持つ。
// 採点の計算は lib/aptitude/scoring.ts、初期の版（v1）の中身は lib/aptitude/seed.ts。
//
// ★このファイルは scoring.ts・seed.ts から型だけ読まれる。テスト（node --test）で動かすため、
//   scoring.ts・seed.ts からは「import type」以外で読み込まないこと。

// ---- 職種・拠点 -------------------------------------------------------------

export const ROLES = ['講師', '事務', '社員'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  講師: '講師（学生パート）',
  事務: '事務スタッフ',
  社員: '社員',
};

// ★拠点を増やすときはここに足す。
export const BASES = ['智翔館', 'NEP', 'JEO'] as const;

export const GENDERS = ['男性', '女性', 'その他', '回答しない'] as const;

export const HIRE_STATUSES = ['選考中', '採用', '不採用', '辞退'] as const;
export type HireStatus = (typeof HIRE_STATUSES)[number];

// ---- 保存期間 ---------------------------------------------------------------
// 不採用・辞退になってから deniedDays 日で、受検者・受検・回答・結果を完全に削除する。
// 画面で「削除」した受検者は deletedDays 日後に完全に削除する（それまでは一覧から消えるだけ）。
// ★受検画面の同意文（components/ExamUI.tsx）にも日数を出しているので、変えたら文面も確かめる。
export const RETENTION = { deniedDays: 365, deletedDays: 30 };

// 受検URLの有効期限（日）。延長するときも同じ日数だけ延ばす。
export const TOKEN_DAYS = 7;

// ---- 尺度 -------------------------------------------------------------------

export const SCALE_CODES = ['L', 'CP', 'NP', 'A', 'FC', 'AC', 'ST', 'EM', 'AV', 'IM'] as const;
export type ScaleCode = (typeof SCALE_CODES)[number];

/** エゴグラム（交流分析）の5尺度。結果画面では折れ線で出す。 */
export const EGOGRAM: ScaleCode[] = ['CP', 'NP', 'A', 'FC', 'AC'];

export const SCALE_KINDS = ['信頼性', 'エゴグラム', '適性', 'リスク'] as const;
export type ScaleKind = (typeof SCALE_KINDS)[number];

export type Scale = {
  code: ScaleCode;
  name: string;
  kind: ScaleKind;
  description: string;
  order: number;
};

export type Question = {
  no: number; // 1〜100
  text: string;
  scale: ScaleCode;
  reverse: boolean; // true なら「いいえ」で1点
  active: boolean; // false なら採点に使わない（受検画面にも出さない）
  note: string; // 担当者向けの備考（受検者には出さない）
};

// ---- 判定基準（職種ごと） ----------------------------------------------------

export type ScaleRule = {
  weight: number; // 適性スコアへの重み（0 なら使わない）
  caution: number | null; // この点数以上で「注意」（判定はBまで）
  alert: number | null; // この点数以上で「要注意」（判定はC）
  highNote: string; // 高いときの面接での確認ポイント
  lowNote: string; // 低いときの面接での確認ポイント
};

export type RoleRule = {
  gradeA: number; // 適性スコア（0〜100）がこれ以上で A
  gradeB: number; // これ以上で B、未満は C
  lieAt: number; // 虚偽尺度がこれ以上なら「参考値」
  minAvgSec: number; // 平均回答秒数がこれ未満なら「参考値」（Web受検のみ）
  highAt: number; // 尺度得点がこれ以上を「高い」とみる（確認ポイントを出す）
  lowAt: number; // これ以下を「低い」とみる
  scales: Record<ScaleCode, ScaleRule>;
};

// ---- 版 ---------------------------------------------------------------------

export const VERSION_STATUSES = ['下書き', '公開', '終了'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export type Version = {
  id: string;
  name: string;
  status: VersionStatus;
  note: string;
  publishedAt: string; // ISO（未公開は ''）
  createdAt: string;
  createdBy: string;
};

export type VersionDetail = Version & {
  scales: Scale[];
  questions: Question[];
  rules: Record<Role, RoleRule>;
};

// ---- 受検者・受検・結果 ------------------------------------------------------

export type Candidate = {
  id: string;
  name: string;
  kana: string;
  gender: string;
  birthDate: string; // YYYY-MM-DD（未入力は ''）
  phone: string;
  email: string;
  role: Role;
  base: string;
  hireStatus: HireStatus;
  hireStatusAt: string; // ISO。採用結果を最後に変えた日時（保存期間の起点）
  postEval: number | null; // 入社後の評価（1〜5）。校正用
  postEvalNote: string;
  memo: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type CandidateInput = Pick<
  Candidate,
  'name' | 'kana' | 'gender' | 'birthDate' | 'phone' | 'email' | 'role' | 'base' | 'hireStatus' | 'postEval' | 'postEvalNote' | 'memo'
>;

export const METHODS = ['Web', '紙'] as const;
export type Method = (typeof METHODS)[number];

export const SESSION_STATUSES = ['未受検', '受検中', '完了', '取消'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
/** 画面に出す状態。期限を過ぎた未完了の受検は「期限切れ」。 */
export type SessionState = SessionStatus | '期限切れ';

export type Session = {
  id: string;
  candidateId: string;
  versionId: string;
  role: Role;
  base: string;
  token: string;
  expiresAt: string; // ISO
  method: Method;
  status: SessionStatus;
  questionOrder: number[]; // 受検画面に出す順（設問番号）
  consentAt: string;
  startedAt: string;
  completedAt: string;
  createdAt: string;
  createdBy: string;
};

export type AnswerValue = 'Y' | 'N';
export type Answer = { no: number; answer: AnswerValue; seconds: number | null };

export type Grade = 'A' | 'B' | 'C';

export const GRADE_LABEL: Record<Grade, string> = {
  A: '適性が高い',
  B: '標準',
  C: '面接で慎重に確認',
};

export type ScaleScore = {
  raw: number; // 加点した設問の数
  max: number; // 採点に使った設問の数
  score: number | null; // 10点満点に換算（使う設問が無ければ null）
};

export type FlagKind = 'alert' | 'caution' | 'lie' | 'speed';
export type Flag = { kind: FlagKind; scale?: ScaleCode; text: string };

export type Checkpoint = { scale: ScaleCode; level: '高' | '低'; text: string };

export type Judgment = {
  role: Role;
  aptitude: number; // 適性スコア 0〜100
  baseGrade: Grade; // リスクを見る前の判定
  grade: Grade;
  reliable: boolean; // false なら「参考値」
  flags: Flag[];
  reasons: string[];
  checkpoints: Checkpoint[];
};

export type Result = {
  sessionId: string;
  versionId: string;
  scores: Record<ScaleCode, ScaleScore>;
  avgSeconds: number | null;
  judgment: Judgment;
  computedAt: string;
};

// ---- 画面向けの小さな計算 ----------------------------------------------------

/** 期限切れを含めた、画面に出す受検の状態。 */
export function sessionState(s: Pick<Session, 'status' | 'expiresAt'>, now = new Date()): SessionState {
  if (s.status === '完了' || s.status === '取消') return s.status;
  if (s.expiresAt && new Date(s.expiresAt).getTime() < now.getTime()) return '期限切れ';
  return s.status;
}

/** 満年齢（生年月日が無い・読めないときは null）。today は YYYY-MM-DD。 */
export function ageOf(birthDate: string, today: string): number | null {
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!b || !t) return null;
  let age = Number(t[1]) - Number(b[1]);
  if (t[2] + t[3] < b[2] + b[3]) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** 今日（日本時間）の YYYY-MM-DD。 */
export function todayJst(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);
}

// ---- 入力チェック -----------------------------------------------------------

type Valid<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** YYYY-MM-DD で、実在する日付か（2000-02-30 などは通さない。Supabase の date 列で弾かれるため）。 */
export function isRealDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const str = (v: unknown, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

export function validateCandidate(b: Record<string, unknown>): Valid<CandidateInput> {
  const errors: string[] = [];
  const name = str(b.name, 60);
  if (!name) errors.push('氏名を入れてください。');
  const role = b.role;
  if (!oneOf(ROLES, role)) errors.push('職種を選んでください。');
  const base = str(b.base, 30);
  if (!oneOf(BASES, base)) errors.push('拠点を選んでください。');
  const gender = str(b.gender, 10);
  if (gender && !oneOf(GENDERS, gender)) errors.push('性別の値が正しくありません。');
  const birthDate = str(b.birthDate, 10);
  if (birthDate && !isRealDate(birthDate)) errors.push('生年月日は日付で入れてください。');
  const email = str(b.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) errors.push('メールアドレスの形が正しくありません。');
  const hire = validateHire(b);
  if (!hire.ok) errors.push(...hire.errors);
  if (errors.length || !hire.ok) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      kana: str(b.kana, 60),
      gender,
      birthDate,
      phone: str(b.phone, 30),
      email,
      role: role as Role,
      base,
      ...hire.value,
      memo: str(b.memo, 2000),
    },
  };
}

export type HireInput = Pick<Candidate, 'hireStatus' | 'postEval' | 'postEvalNote'>;

/** 採用結果・入社後の評価（採用結果が空なら「選考中」）。 */
export function validateHire(b: Record<string, unknown>): Valid<HireInput> {
  const errors: string[] = [];
  const hireStatus = b.hireStatus == null || b.hireStatus === '' ? '選考中' : b.hireStatus;
  if (!oneOf(HIRE_STATUSES, hireStatus)) errors.push('採用結果の値が正しくありません。');
  const pe = b.postEval == null || b.postEval === '' ? null : Number(b.postEval);
  if (pe != null && !(Number.isInteger(pe) && pe >= 1 && pe <= 5)) errors.push('入社後の評価は1〜5で入れてください。');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { hireStatus: hireStatus as HireStatus, postEval: pe, postEvalNote: str(b.postEvalNote, 1000) } };
}

/** 受検者が受検画面で入れるプロフィール（フリガナは必須）。 */
export type ExamProfile = Pick<Candidate, 'kana' | 'birthDate' | 'phone' | 'email'>;

export function validateExamProfile(b: Record<string, unknown>): Valid<ExamProfile> {
  const errors: string[] = [];
  const kana = str(b.kana, 60);
  if (!kana) errors.push('フリガナを入れてください。');
  const birthDate = str(b.birthDate, 10);
  if (birthDate && !isRealDate(birthDate)) errors.push('生年月日は日付で入れてください。');
  const email = str(b.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) errors.push('メールアドレスの形が正しくありません。');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { kana, birthDate, phone: str(b.phone, 30), email } };
}

const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));

export function validateRule(b: unknown): Valid<RoleRule> {
  const r = (b ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const num = (k: string, lo: number, hi: number) => {
    const n = Number(r[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) errors.push(`${k} は ${lo}〜${hi} で入れてください。`);
    return n;
  };
  const gradeA = num('gradeA', 0, 100);
  const gradeB = num('gradeB', 0, 100);
  if (gradeB > gradeA) errors.push('B の基準は A の基準以下にしてください。');
  const lieAt = num('lieAt', 0, 10);
  const minAvgSec = num('minAvgSec', 0, 60);
  const highAt = num('highAt', 0, 10);
  const lowAt = num('lowAt', 0, 10);
  const src = (r.scales ?? {}) as Record<string, Record<string, unknown>>;
  const scales = {} as Record<ScaleCode, ScaleRule>;
  for (const code of SCALE_CODES) {
    const x = src[code] ?? {};
    const weight = Number(x.weight ?? 0);
    const caution = numOrNull(x.caution);
    const alert = numOrNull(x.alert);
    if (!Number.isFinite(weight) || weight < 0 || weight > 10) errors.push(`${code} の重みは 0〜10 で入れてください。`);
    for (const [label, v] of [['注意', caution], ['要注意', alert]] as const) {
      if (v != null && !(Number.isFinite(v) && v >= 0 && v <= 10)) errors.push(`${code} の${label}は 0〜10 で入れてください。`);
    }
    if (caution != null && alert != null && alert < caution) errors.push(`${code} の要注意は注意以上にしてください。`);
    scales[code] = { weight, caution, alert, highNote: str(x.highNote, 500), lowNote: str(x.lowNote, 500) };
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { gradeA, gradeB, lieAt, minAvgSec, highAt, lowAt, scales } };
}

export function validateQuestions(list: unknown): Valid<Question[]> {
  const errors: string[] = [];
  if (!Array.isArray(list)) return { ok: false, errors: ['設問の一覧が読めません。'] };
  const out: Question[] = [];
  const seen = new Set<number>();
  for (const q of list as Record<string, unknown>[]) {
    const no = Number(q.no);
    if (!Number.isInteger(no) || no < 1 || no > 999 || seen.has(no)) {
      errors.push(`設問番号 ${String(q.no)} が正しくありません（重複も不可）。`);
      continue;
    }
    seen.add(no);
    const text = str(q.text, 300);
    if (!text) errors.push(`設問 ${no} の本文が空です。`);
    if (!oneOf(SCALE_CODES, q.scale)) errors.push(`設問 ${no} の尺度が正しくありません。`);
    out.push({ no, text, scale: q.scale as ScaleCode, reverse: !!q.reverse, active: q.active !== false, note: str(q.note, 300) });
  }
  if (!out.some((q) => q.active)) errors.push('使う設問が1問もありません。');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out.sort((a, b) => a.no - b.no) };
}

export function validateScales(list: unknown): Valid<Scale[]> {
  if (!Array.isArray(list)) return { ok: false, errors: ['尺度の一覧が読めません。'] };
  const errors: string[] = [];
  const out: Scale[] = [];
  for (const code of SCALE_CODES) {
    const x = (list as Record<string, unknown>[]).find((s) => s.code === code);
    if (!x) { errors.push(`尺度 ${code} がありません。`); continue; }
    const name = str(x.name, 40);
    if (!name) errors.push(`尺度 ${code} の名前が空です。`);
    const kind = x.kind;
    if (!oneOf(SCALE_KINDS, kind)) errors.push(`尺度 ${code} の種別が正しくありません。`);
    out.push({ code, name, kind: kind as ScaleKind, description: str(x.description, 300), order: Number(x.order) || 0 });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out };
}
