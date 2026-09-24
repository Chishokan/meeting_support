// HP（WordPress）の問い合わせフォームから台帳へ直接取り込むための変換。
//
// これまでは「フォーム → 通知メール → Apps Script がメールを読んで旧シートへ転記」だったが、
// フォームの送信先（Webhook）にこのアプリの /api/inquiry-board/intake を指定すれば、
// メールを介さず台帳に1件登録される（受け口は app/api/inquiry-board/intake/route.ts）。
//
// このファイルは「フォームの項目 → 台帳の項目」の対応と、校舎・学年・受講期の読み替え、
// 同じ人からの再送信の扱い（新規にせず備考へ追記）を持つ。フォームの項目名を変えたら FIELD_ALIASES を直す。

import {
  BOARD_CAMPUSES, UNASSIGNED_CAMPUS, emptyInput, normalizeGrade,
  type InquiryInput, type InquiryRecord,
} from './inquiryRecords';

// ---- フォーム項目の読み取り ----------------------------------------------------

/** フォームから来る値。CF7 の Webhook プラグインは項目名＝キーの JSON か form-urlencoded で送る。 */
export type IntakePayload = Record<string, unknown>;

export type IntakeFields = {
  studentName: string;
  kana: string;
  guardianName: string;
  guardianKana: string;
  postal: string;
  address: string;
  phone: string;
  email: string;
  school: string;
  grade: string;
  course: string;   // 希望コース（模試・講習会・体験 など）
  campus: string;   // 受講校舎（希望校舎）。「オンライン」を含めばオンライン、「県中」「県立中」を含めば県中
  referrer: string; // 紹介者
  consult: string;  // 相談事項
  message: string;  // お問い合わせ内容
  submissionId: string; // フォーム側の送信ID（あれば二重登録防止に使う）
};

/**
 * 項目名の候補。左から順に探し、最初に値があるものを使う。
 * 通知メールの項目名（お子様名 …）と、Contact Form 7 で付けやすい英語名の両方を受け付ける。
 * ★WordPress 側でフォームの項目名を変えたらここに足す。
 */
export const FIELD_ALIASES: Record<keyof IntakeFields, string[]> = {
  // 実際の CF7 フォーム（例：「●中学生向け定期テスト対策」）のタグは
  //   your-name（お子様名）/ your-parent（保護者名）/ your-school / your-class（学年）/ your-tel / your-email / your-message
  studentName: ['student_name', 'お子様名', 'お子さま名', '生徒氏名', '生徒名', 'your-name', 'name'],
  kana: ['student_kana', 'ふりがな', 'フリガナ', 'お子様名ふりがな', 'your-kana', 'your-furigana', 'kana'],
  guardianName: ['guardian_name', '保護者名', '保護者氏名', 'your-parent', 'parent', 'parent_name'],
  guardianKana: ['guardian_kana', '保護者名ふりがな', '保護者ふりがな', 'your-parent-kana', 'parent_kana'],
  postal: ['postal', 'zip', '郵便番号', 'your-zip', 'your-postal'],
  address: ['address', '住所', 'your-address'],
  phone: ['phone', 'tel', '電話番号', 'your-tel', 'your-phone'],
  email: ['email', 'メールアドレス', 'your-email', 'mail'],
  school: ['school', '学校名', '学校', 'your-school'],
  grade: ['grade', '学年', 'your-grade', 'your-class', 'class'],
  // 講座ごとのフォームには希望コースの項目が無いことが多い。その場合はフォームに
  // [hidden your-course "定期テスト対策"] を置くか、Webhook が送る _post_title（フォームを置いたページ名）を使う
  course: ['course', '希望コース', 'コース', '希望講座', 'your-course', 'form_title', '_form_title', '_post_title'],
  campus: ['campus', '受講校舎', '希望校舎', '校舎', 'your-campus', 'your-school-campus'],
  referrer: ['referrer', '紹介者', 'ご紹介者', '紹介者名', 'your-referrer'],
  consult: ['consult', '相談事項', 'ご相談事項', 'your-consult'],
  message: ['message', 'お問い合わせ内容', 'お問合せ内容', 'お問い合わせ', 'your-message', 'content'],
  submissionId: ['submission_id', 'submissionId', 'id', 'entry_id', 'form_id_entry', '受付ID'],
};

function text(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join('、');
  if (typeof v === 'object') return '';
  return String(v).trim();
}

/** キーの表記ゆれ（大小・空白・ハイフン/アンダースコア）を吸収して引く。 */
function normKey(k: string): string {
  return k.toLowerCase().replace(/[\s　_\-]/g, '');
}

export function readFields(payload: IntakePayload): IntakeFields {
  const lookup = new Map<string, unknown>();
  for (const [k, v] of Object.entries(payload)) {
    const nk = normKey(k);
    if (!lookup.has(nk)) lookup.set(nk, v);
  }
  const pick = (aliases: string[]) => {
    for (const a of aliases) {
      const v = text(lookup.get(normKey(a)));
      if (v) return v;
    }
    return '';
  };
  const out = {} as IntakeFields;
  for (const key of Object.keys(FIELD_ALIASES) as (keyof IntakeFields)[]) out[key] = pick(FIELD_ALIASES[key]);
  return out;
}

// ---- 読み替え ------------------------------------------------------------------

/**
 * 受講校舎の文言 → 台帳の校舎。「佐世保駅前校」→「駅前校」など部分一致で寄せる。
 * 分からなければ '' を返し、呼び出し側が「未分類」に入れて備考に【校舎不明】と書く。
 */
export function matchCampus(raw: string): string {
  const s = (raw || '').replace(/[\s　]/g, '');
  if (!s) return '';
  if (s.includes('日野')) return '日野校';
  if (s.includes('駅前')) return '駅前校';
  if (s.includes('大野')) return '大野校';
  if (s.includes('日宇')) return '日宇校';
  if (s.includes('オンライン')) return 'オンライン';
  if (s.includes('県中') || s.includes('県立中')) return '県中';
  for (const c of BOARD_CAMPUSES) if (s.includes(c)) return c;
  return '';
}

/** 「中学3年生」「小学6年生」「高校1年生」「中3」→ 台帳の学年（小１〜高３）。読めなければそのまま。 */
export function matchGrade(raw: string): string {
  const s = (raw || '').replace(/[\s　]/g, '');
  const m = /^(小学|中学|高校|小|中|高)(?:校)?([0-9０-９])(?:年生?|年)?$/.exec(s);
  if (m) {
    const head = m[1].charAt(0);
    return normalizeGrade(`${head}${m[2]}`);
  }
  return normalizeGrade(s);
}

/** 希望コースの文言 → 受講期。 */
export function matchTerm(course: string): string {
  const s = course || '';
  if (!s) return '';
  if (s.includes('模試')) return '模試';
  if (/講習|夏期|冬期|春期|秋期/.test(s)) return '講習会';
  if (/体験|イベント|説明会|合宿|セミナー/.test(s)) return 'その他イベント';
  return '通常';
}

/** 通知メールの定型文（個人情報保護方針・フッター）を落とす。 */
export function stripFormBoilerplate(s: string): string {
  let t = (s || '').replace(/\r\n?/g, '\n');
  for (const cut of ['個人情報保護方針：', '個人情報保護方針:', '-- このメールは', '--　このメールは']) {
    const at = t.indexOf(cut);
    if (at !== -1) t = t.slice(0, at);
  }
  return t.trim();
}

function digits(s: string): string {
  return (s || '').replace(/[^0-9]/g, '');
}

function nameKey(s: string): string {
  return (s || '').replace(/[\s　]/g, '');
}

// ---- 台帳への当てはめ ------------------------------------------------------------

export type IntakeDecision =
  | { action: 'create'; input: InquiryInput }
  | { action: 'append'; target: InquiryRecord; input: InquiryInput; chunk: string }
  | { action: 'skip'; reason: 'duplicate_submission' | 'already_noted' | 'empty' };

/** 備考に追記する1行。「[9/18 HPフォーム] 希望コース:… ／ 相談事項:… ／ 内容:…」 */
export function buildNoteChunk(f: IntakeFields, todayIso: string): string {
  const [, m, d] = todayIso.split('-').map(Number);
  const parts = [
    f.course ? `希望コース:${f.course}` : '',
    f.consult ? `相談事項:${stripFormBoilerplate(f.consult)}` : '',
    f.message ? `内容:${stripFormBoilerplate(f.message)}` : '',
  ].filter(Boolean);
  return `[${m}/${d} HPフォーム] ${parts.join(' ／ ') || '（本文なし）'}`;
}

/**
 * フォームの内容を、新規登録にするか既存の行への追記にするか決める。
 *
 * - 送信ID が既に台帳にあれば skip（WordPress 側の再送・二重送信）
 * - 同じ校舎に同じ氏名の行（氏名が無ければ同じ電話番号の行）があれば、その行の備考に追記する
 *   （旧メール転記の「既存行のため備考に追記（他列は変更なし）」と同じ扱い。
 *     見送り済みでも新規行にはせず追記する。担当者が結果を見直せばよい）
 * - 高校生は小中等部の対象外だが、捨てずに「その他」に入れて備考に【高校生】と書く
 * - 校舎が読めなければ「未分類」に入れて備考に【校舎不明】と書く（担当者が校舎を振り分ける）
 */
export function decideIntake(f: IntakeFields, existing: InquiryRecord[], todayIso: string): IntakeDecision {
  if (!f.studentName && !f.guardianName && !f.phone && !f.email) return { action: 'skip', reason: 'empty' };
  if (f.submissionId && existing.some((r) => r.intakeId && r.intakeId === f.submissionId)) {
    return { action: 'skip', reason: 'duplicate_submission' };
  }

  const grade = matchGrade(f.grade);
  const isHighSchool = grade.startsWith('高');
  let campus = matchCampus(f.campus);
  const markers: string[] = [];
  if (isHighSchool) markers.push('【高校生】高等部へ引き継ぎ');
  if (!campus) {
    markers.push(f.campus ? `【校舎不明】受講校舎の入力:${f.campus}` : '【校舎不明】受講校舎の入力なし');
    campus = UNASSIGNED_CAMPUS;
  }

  const chunk = buildNoteChunk(f, todayIso);
  const key = nameKey(f.studentName);
  const tel = digits(f.phone);
  // 氏名があれば氏名で探す。電話番号だけで寄せると兄弟（同じ番号）の行に追記してしまうので、
  // 電話番号で探すのは氏名が無いときだけ。
  const target = existing.find((r) => {
    if (r.campus !== campus) return false;
    if (key) return nameKey(r.studentName) === key;
    return tel.length >= 10 && digits(r.phone) === tel;
  });

  if (target) {
    if (target.note.includes(chunk)) return { action: 'skip', reason: 'already_noted' };
    const input: InquiryInput = {
      ...emptyInput(target.campus),
      ...pickInput(target),
      // 空欄だった項目だけ埋める（担当者が直した値は上書きしない）
      kana: target.kana || f.kana,
      guardianName: target.guardianName || f.guardianName,
      postal: target.postal || f.postal,
      address: target.address || f.address,
      phone: target.phone || f.phone,
      email: target.email || f.email,
      school: target.school || f.school,
      grade: target.grade || grade,
      referrer: target.referrer || f.referrer,
      note: [chunk, ...markers, target.note].filter(Boolean).join('\n'),
    };
    return { action: 'append', target, input, chunk };
  }

  const input: InquiryInput = {
    ...emptyInput(campus),
    date: todayIso,
    studentName: f.studentName,
    kana: f.kana,
    school: f.school,
    grade,
    phone: f.phone,
    source: 'HP',
    referrer: f.referrer,
    term: matchTerm(f.course),
    note: [chunk, ...markers].join('\n'),
    guardianName: f.guardianKana && f.guardianName ? `${f.guardianName}（${f.guardianKana}）` : f.guardianName,
    postal: f.postal,
    address: f.address,
    email: f.email,
    intakeId: f.submissionId,
  };
  return { action: 'create', input };
}

/** 台帳の行から、フォームで扱う項目（入力値）だけを取り出す。 */
function pickInput(r: InquiryRecord): InquiryInput {
  const out = emptyInput(r.campus);
  for (const k of Object.keys(out) as (keyof InquiryInput)[]) {
    if (k === 'no') continue;
    (out as Record<string, unknown>)[k] = r[k];
  }
  out.no = r.no;
  return out;
}
