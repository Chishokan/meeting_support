// 智翔館AI：中学校のテスト問題（定期テスト・実力テスト・入試問題）の保存と検索（2026-11-20）。ほかに依存しない（画面・API・テストのどこからでも読める）。
//
// - 保存：チャットの［🗄 テスト問題を保存］で開く小窓（components/TestPaperDialog.tsx）から行う（AI は保存しない）。
//   種類をプルダウンで選び、定期テスト・実力テストは「年度・実施回（1〜4）・中学校・学年・科目」、入試問題は「年度・科目・公立／私立（私立は学校名）」を選ぶ。
//   中学校は表記の揺れを無くすため、下の一覧（SCHOOL_GROUPS）から選ぶ。
//   ファイルは1つずつ送り（app/api/chishokan-ai/test-papers の step:'file'。アプリの受け取れる大きさに上限があるため）、
//   全部送れたら1件として記録する（step:'entry'）。保存先はドライブ「15_AI利用データ/中学校テスト問題/<種類>」と、
//   会議サポートアプリログの「中学校テスト問題」シート（apps_script/Code.gs の saveTestPaperFile_・saveTestPaperEntry_）。
// - 検索：AI の search_test_papers。シートの一覧（listTestPapers_）を、ここで絞る。
// 生徒の名前・点数のある答案は保存しない。共有の設定は変えない（フォルダの共有のまま）。

export const TEST_KINDS = ['定期テスト', '実力テスト', '入試問題'] as const;
export type TestKind = (typeof TEST_KINDS)[number];
export const TEST_SUBJECTS = ['国語', '数学', '英語', '理科', '社会', '5教科'] as const;
export type TestSubject = (typeof TEST_SUBJECTS)[number];
export const TEST_GRADES = ['中1', '中2', '中3'] as const;
export type TestGrade = (typeof TEST_GRADES)[number];
export const TEST_ROUNDS = [1, 2, 3, 4] as const;
export const ENTRANCE_TYPES = ['公立', '私立'] as const;
export type EntranceType = (typeof ENTRANCE_TYPES)[number];
/** 入試問題の「公立」の学校欄。 */
export const PUBLIC_HIGH_SCHOOL = '長崎県公立高校';

/**
 * 選べる中学校（表記の揺れを無くすため、名前はここに決めておく）。2026-11-20 作成。
 * 出典：ナレッジ「15_地域・市場/佐世保の学校と校区.md」（校舎の対象校）と、学校情報サイト・検索結果。
 * 〔要確認：佐世保市・西海市の教育委員会の学校一覧と照らし合わせる（2026-11-20 は市のサイトを開けなかった）〕
 * 学校が足りないときは、ここに足す（並びがそのまま画面の選択肢になる）。
 */
export const SCHOOL_GROUPS: { label: string; schools: string[] }[] = [
  {
    label: '佐世保市立 中学校',
    schools: [
      '佐世保市立祇園中学校', '佐世保市立山澄中学校', '佐世保市立光海中学校', '佐世保市立清水中学校', '佐世保市立福石中学校',
      '佐世保市立愛宕中学校', '佐世保市立崎辺中学校', '佐世保市立日宇中学校', '佐世保市立早岐中学校', '佐世保市立広田中学校',
      '佐世保市立東明中学校', '佐世保市立三川内中学校', '佐世保市立宮中学校', '佐世保市立日野中学校', '佐世保市立相浦中学校',
      '佐世保市立大野中学校', '佐世保市立中里中学校', '佐世保市立柚木中学校', '佐世保市立小佐々中学校', '佐世保市立吉井中学校',
      '佐世保市立世知原中学校', '佐世保市立江迎中学校', '佐世保市立鹿町中学校', '佐世保市立宇久中学校',
    ],
  },
  { label: '佐世保市立 義務教育学校（小中学校）', schools: ['佐世保市立浅子小中学校', '佐世保市立黒島小中学校'] },
  { label: '佐世保市 県立・私立', schools: ['長崎県立佐世保北中学校', '聖和女子学院中学校', '九州文化学園中学校'] },
  { label: '西海市立 中学校', schools: ['西海市立西海中学校', '西海市立西彼中学校', '西海市立大瀬戸中学校', '西海市立大崎中学校', '西海市立江島中学校'] },
  { label: '近隣（智翔館の対象校）', schools: ['佐々町立佐々中学校'] },
];
export const ALL_SCHOOLS: string[] = SCHOOL_GROUPS.flatMap((g) => g.schools);
/** 一覧に無い学校を入れるときの選択肢の値。 */
export const OTHER_SCHOOL = '__other__';

/** 1件に入れられるファイルの数。 */
export const TEST_MAX_FILES = 10;
/** 1つのファイルの大きさの上限（base64 の文字数。元の大きさで約3MB。アプリが受け取れる大きさの上限 4.5MB に収めるため）。 */
export const TEST_FILE_MAX_CHARS = 4_200_000;
/** 画面で選べるファイル（元の大きさの上限。画像は画面で縮めてから送るので、この上限はかからない）。 */
export const TEST_FILE_MAX_BYTES = 3_100_000;
export const TEST_FILE_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/** 今の年度（4月始まり）。 */
export function currentSchoolYear(now = new Date()): number {
  const t = new Date(now.getTime() + 9 * 3_600_000);
  return t.getUTCMonth() + 1 >= 4 ? t.getUTCFullYear() : t.getUTCFullYear() - 1;
}

export type TestMeta = {
  kind: TestKind;
  year: number;
  school: string;
  /** 一覧から選んだ学校か（一覧に無い学校を入れたときは false） */
  listed: boolean;
  entranceType: EntranceType | '';
  grade: TestGrade;
  subject: TestSubject;
  /** 実施回（定期テスト・実力テスト。入試問題は 0） */
  round: number;
  memo: string;
};
export type SavedFile = { name: string; url: string; id: string };

const line = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | '' => ((list as readonly string[]).includes(String(v)) ? (v as T) : '');

/** 小窓で選んだ内容を確かめて整える（ファイルは別）。足りなければ、職員に見せる理由を返す。 */
export function checkMeta(raw: unknown): { ok: true; value: TestMeta } | { ok: false; message: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = oneOf(TEST_KINDS, o.kind);
  if (!kind) return { ok: false, message: '種類（定期テスト・実力テスト・入試問題）を選んでください。' };
  const year = Number(o.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { ok: false, message: '年度を選んでください。' };
  const subject = oneOf(TEST_SUBJECTS, o.subject);
  if (!subject) return { ok: false, message: '科目を選んでください。' };
  const memo = typeof o.memo === 'string' ? o.memo.replace(/\r\n?/g, '\n').trim().slice(0, 300) : '';
  if (kind === '入試問題') {
    const entranceType = oneOf(ENTRANCE_TYPES, o.entranceType);
    if (!entranceType) return { ok: false, message: '公立か私立かを選んでください。' };
    const school = entranceType === '公立' ? PUBLIC_HIGH_SCHOOL : line(o.school, 40);
    if (!school) return { ok: false, message: '私立の学校名を入れてください。' };
    return { ok: true, value: { kind, year, school, listed: entranceType === '公立', entranceType, grade: '中3', subject, round: 0, memo } };
  }
  const round = Number(o.round);
  if (!(TEST_ROUNDS as readonly number[]).includes(round)) return { ok: false, message: '実施回（1〜4）を選んでください。' };
  const picked = String(o.school ?? '');
  const listed = ALL_SCHOOLS.includes(picked);
  const school = listed ? picked : picked === OTHER_SCHOOL ? line(o.otherSchool, 40) : '';
  if (!school) return { ok: false, message: picked === OTHER_SCHOOL ? '一覧に無い学校の名前を入れてください。' : '中学校を選んでください。' };
  const grade = oneOf(TEST_GRADES, o.grade);
  if (!grade) return { ok: false, message: '学年を選んでください。' };
  return { ok: true, value: { kind, year, school, listed, entranceType: '', grade, subject, round, memo } };
}

/** 実施回・公立私立の書き方（第1回／公立）。 */
export function termLabel(m: Pick<TestMeta, 'kind' | 'round' | 'entranceType'>): string {
  return m.kind === '入試問題' ? m.entranceType : m.round ? `第${m.round}回` : '';
}

/** 1件の見出し（例：2026年度 佐世保市立日宇中学校 中2 数学 第2回定期テスト）。 */
export function testLabel(m: Pick<TestMeta, 'kind' | 'year' | 'school' | 'grade' | 'subject' | 'round' | 'entranceType'>): string {
  if (m.kind === '入試問題') return `${m.year}年度 入試問題（${m.entranceType}）${m.entranceType === '私立' ? ` ${m.school}` : ''} ${m.subject}`;
  return `${m.year}年度 ${m.school} ${m.grade} ${m.subject} ${termLabel(m)}${m.kind}`;
}

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/** ドライブに置くファイル名（例：2026年度_定期テスト_佐世保市立日宇中学校_中2_数学_第2回_1_問題.pdf）。元の名前を後ろに残す。 */
export function testFileName(m: TestMeta, original: string, mime: string, index: number): string {
  const ext = EXT[String(mime).toLowerCase()] ?? 'bin';
  const base = String(original ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const school = m.kind === '入試問題' && m.entranceType === '公立' ? '公立' : m.school;
  const parts = [`${m.year}年度`, m.kind, school, m.kind === '入試問題' ? '' : m.grade, m.subject, m.kind === '入試問題' ? '' : termLabel(m), String(index + 1), base];
  return `${parts.filter(Boolean).join('_').replace(/[\\/:*?"<>|\r\n]+/g, ' ')}.${ext}`;
}

/** 1つのファイルを確かめる（種類・大きさ）。 */
export function checkFile(raw: unknown): { ok: true; value: { name: string; mime: string; data: string } } | { ok: false; message: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = line(o.name, 120) || 'ファイル';
  const mime = String(o.mime ?? '').toLowerCase();
  const data = typeof o.data === 'string' ? o.data : '';
  if (!(TEST_FILE_MIMES as readonly string[]).includes(mime)) return { ok: false, message: `${name}：PDF・画像（JPEG・PNG）・Word だけ保存できます。` };
  if (!data) return { ok: false, message: `${name}：ファイルの中身がありません。` };
  if (data.length > TEST_FILE_MAX_CHARS) return { ok: false, message: `${name}：大きすぎます（1つ3MBまで）。ページを分けて保存してください。` };
  return { ok: true, value: { name, mime, data } };
}

/** 記録するファイルの一覧を確かめる（保存の返事の URL・ID だけを通す）。 */
export function checkSavedFiles(raw: unknown): SavedFile[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: SavedFile[] = [];
  for (const f of list.slice(0, TEST_MAX_FILES)) {
    const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    const url = String(o.url ?? '');
    const id = String(o.id ?? '');
    if (!/^https:\/\/(drive|docs)\.google\.com\//.test(url) || !/^[\w-]{10,}$/.test(id)) continue;
    out.push({ name: line(o.name, 200), url, id });
  }
  return out;
}

// --- 検索（AI の search_test_papers） ----------------------------------------------------
export const SEARCH_TEST_PAPERS_TOOL = {
  name: 'search_test_papers',
  description:
    '保存した中学校のテスト問題（定期テスト・実力テスト・入試問題）を探す。「日宇中の中2数学の第2回定期テスト」「去年の公立入試の英語」などに使う。' +
    '分かっている条件だけ渡す（省いた条件では絞らない）。結果のファイルのリンクは、そのまま書く（作らない）。' +
    '保存は AI ではできない。「保存して」と頼まれたら、画面の［🗄 テスト問題を保存］から保存するよう案内する。',
  input_schema: {
    type: 'object' as const,
    properties: {
      kind: { type: 'string', enum: TEST_KINDS, description: '種類' },
      school: { type: 'string', description: '学校名（一部でよい。「中学校」「中」は無くてよい）' },
      grade: { type: 'string', enum: TEST_GRADES, description: '学年' },
      subject: { type: 'string', enum: TEST_SUBJECTS, description: '科目' },
      year: { type: 'number', description: '年度（西暦。4月始まり）' },
      round: { type: 'number', description: '実施回（1〜4。定期テスト・実力テスト）' },
      entrance_type: { type: 'string', enum: ENTRANCE_TYPES, description: '入試問題の公立・私立' },
      query: { type: 'string', description: 'メモ・ファイル名の言葉' },
      limit: { type: 'number', description: '何件まで出すか（1〜30。既定 15）' },
    },
  },
};

export type TestFileRec = { name: string; url: string };
export type TestPaperRec = {
  id: string;
  ts: string;
  user: string;
  campus: string;
  kind: string;
  year: string;
  school: string;
  entranceType: string;
  grade: string;
  subject: string;
  round: string;
  memo: string;
  files: TestFileRec[];
};

/** シートの「ファイル」の欄（1行に「ファイル名｜URL」）を読む。 */
export function parseFilesCell(cell: string): TestFileRec[] {
  return String(cell ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.lastIndexOf('｜');
      return { name: (i >= 0 ? l.slice(0, i) : '').trim(), url: (i >= 0 ? l.slice(i + 1) : l).trim() };
    })
    .filter((f) => /^https?:\/\//.test(f.url));
}

export type SearchQuery = {
  kind: string;
  school: string;
  grade: string;
  subject: string;
  year: number;
  round: number;
  entranceType: string;
  query: string;
  limit: number;
};

export function checkSearchInput(input: Record<string, unknown>): SearchQuery {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const lim = Number(o.limit);
  const y = Number(String(o.year ?? '').replace(/[^\d]/g, ''));
  const r = Number(o.round);
  return {
    kind: oneOf(TEST_KINDS, o.kind),
    school: line(o.school, 40),
    grade: oneOf(TEST_GRADES, o.grade),
    subject: oneOf(TEST_SUBJECTS, o.subject),
    year: y >= 2000 && y <= 2100 ? y : 0,
    round: (TEST_ROUNDS as readonly number[]).includes(r) ? r : 0,
    entranceType: oneOf(ENTRANCE_TYPES, o.entrance_type ?? o.entranceType),
    query: line(o.query, 60),
    limit: Number.isFinite(lim) && lim >= 1 ? Math.min(30, Math.floor(lim)) : 15,
  };
}

/** 学校名を比べやすくする（空白、「〇〇市立」「〇〇県立」の前置き、「中学校」「中学」「中」の書き方を寄せる）。 */
export function schoolKey(s: string): string {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/^(.{1,4}?(市|町|県)立)/, '')
    .replace(/(小中学校|高等学校|中学校|中学|高校|中)$/, '');
}

/** 条件で絞り、新しい年度・新しい登録から並べる。 */
export function filterTestPapers(rows: TestPaperRec[], q: SearchQuery): TestPaperRec[] {
  const sk = schoolKey(q.school);
  const words = q.query.split(/\s+/).filter(Boolean);
  return rows
    .filter((r) => !q.kind || r.kind === q.kind)
    .filter((r) => !q.grade || r.grade === q.grade)
    .filter((r) => !q.subject || r.subject === q.subject || (q.subject !== '5教科' && r.subject === '5教科'))
    .filter((r) => !q.year || Number(r.year) === q.year)
    .filter((r) => !q.round || Number(r.round) === q.round)
    .filter((r) => !q.entranceType || r.entranceType === q.entranceType)
    .filter((r) => !sk || schoolKey(r.school).includes(sk) || (schoolKey(r.school) !== '' && sk.includes(schoolKey(r.school))))
    .filter((r) => {
      if (!words.length) return true;
      const hay = [r.memo, r.school, ...r.files.map((f) => f.name)].join(' ');
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => Number(b.year) - Number(a.year) || String(b.ts).localeCompare(String(a.ts)));
}

const clip = (s: string, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

const recLabel = (r: TestPaperRec) =>
  testLabel({
    kind: (oneOf(TEST_KINDS, r.kind) || '定期テスト') as TestKind,
    year: Number(r.year),
    school: r.school,
    grade: (oneOf(TEST_GRADES, r.grade) || '中1') as TestGrade,
    subject: (oneOf(TEST_SUBJECTS, r.subject) || '5教科') as TestSubject,
    round: Number(r.round) || 0,
    entranceType: oneOf(ENTRANCE_TYPES, r.entranceType),
  });

/** 検索の結果を、AI に渡す文にする。 */
export function formatTestPapers(found: TestPaperRec[], total: number, q: SearchQuery): string {
  const cond =
    [q.kind, q.year ? `${q.year}年度` : '', q.school, q.grade, q.subject, q.round ? `第${q.round}回` : '', q.entranceType, q.query ? `「${q.query}」` : '']
      .filter(Boolean)
      .join('・') || '条件なし';
  const head = `【保存したテスト問題（${cond}）：${found.length}件／保存は全部で${total}件】`;
  if (!found.length) {
    return `${head}\n（該当なし）\n答え方：「保存されていない」と伝える。条件（学校名の書き方・年度・実施回）をゆるめて探し直すか、画面の［🗄 テスト問題を保存］から保存してもらう。`;
  }
  const out = [head];
  for (const r of found.slice(0, q.limit)) {
    out.push(`- ${recLabel(r)}（登録：${r.user} ${String(r.ts).slice(0, 10)}）${r.memo ? `／メモ：${clip(r.memo, 100)}` : ''}`, ...r.files.map((f) => `    ${f.name || 'ファイル'}：${f.url}`));
  }
  if (found.length > q.limit) out.push(`…ほか${found.length - q.limit}件（条件を足して絞る）`);
  out.push(
    '答え方：見つかったものを表か箇条書きで示し、ファイルのリンクはこの結果の URL をそのまま書く（作らない）。' +
      'ファイルはフォルダの共有のままなので、開けないときは「15_AI利用データ」の権限を持つ人に頼むよう伝える。',
  );
  return out.join('\n');
}
