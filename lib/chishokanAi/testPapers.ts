// 智翔館AI：中学校のテスト問題（定期テスト・実力テスト・入試問題）の保存と検索（2026-11-20）。ほかに依存しない（テストしやすいように）。
//
// - 保存（save_test_paper）：職員がチャットに添付した問題用紙・解答（PDF・画像）を、Apps Script が
//   ドライブ「15_AI利用データ/中学校テスト問題/<種類>」に保存し、会議サポートアプリログの「中学校テスト問題」シートに1件1行で残す
//   （apps_script/Code.gs の saveTestPaper_）。AI は保存の前に、読み取った中身（学校・学年・教科・年度・時期・単元）を職員に確かめる。
// - 検索（search_test_papers）：シートの一覧（listTestPapers_）を、ここで種類・学校・学年・教科・年度・言葉で絞る。
// ドライブの道具は PDF・画像の中身を読めないので、保存のときに「大問ごとの単元・出題内容」を書いておき、検索の手がかりにする。
// 生徒の名前・点数が書かれた答案は保存しない（白紙の問題・模範解答だけ）。共有の設定は変えない（フォルダの共有のまま）。

export const TEST_KINDS = ['定期テスト', '実力テスト', '入試問題'] as const;
export type TestKind = (typeof TEST_KINDS)[number];
export const TEST_SUBJECTS = ['国語', '数学', '英語', '理科', '社会', '5教科', 'その他'] as const;
export type TestSubject = (typeof TEST_SUBJECTS)[number];
export const TEST_GRADES = ['中1', '中2', '中3'] as const;
export type TestGrade = (typeof TEST_GRADES)[number];
export const FILE_ROLES = ['問題', '解答', '問題と解答', '解答用紙', 'その他'] as const;
export type FileRole = (typeof FILE_ROLES)[number];

/** 1回の保存で入れられるファイルの数（PDF・画像）。 */
export const TEST_MAX_FILES = 6;

export const SAVE_TEST_PAPER_TOOL = {
  name: 'save_test_paper',
  description:
    '中学校の定期テスト・実力テスト・入試問題（問題用紙・解答）を、職員が添付した PDF・画像（この質問の添付か、前の添付）から保存する。' +
    '職員が「保存して」「登録して」と頼んだときだけ使う。使う前に、添付を読んで 種類・年度・学校・学年・教科・時期・単元 を回答に書き、' +
    '職員に確かめる（選択肢「この内容で保存する」）。職員が確かめたら呼ぶ。' +
    'topics には大問ごとの単元・出題内容を書く（例：大問1 正負の数の計算／大問2 文字式の値／大問3 一次方程式の文章題）。あとで言葉で探す手がかりになる。' +
    '生徒の名前・点数・書き込みのある答案は保存しない（白紙の問題・模範解答だけ）。名前が写っていたら保存せず、名前の無いものを添付し直すよう頼む。',
  input_schema: {
    type: 'object' as const,
    properties: {
      files: {
        type: 'array',
        description: `保存する添付ファイル（${TEST_MAX_FILES}つまで）。name は添付のファイル名そのまま`,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '添付のファイル名' },
            role: { type: 'string', enum: FILE_ROLES, description: '問題・解答・問題と解答・解答用紙・その他' },
          },
          required: ['name'],
        },
      },
      kind: { type: 'string', enum: TEST_KINDS, description: '種類' },
      year: { type: 'number', description: '年度（西暦。例：2026）。入試問題は実施した年度' },
      school: { type: 'string', description: '学校（例：佐世保市立〇〇中学校。入試問題は「長崎県公立高校」や高校名）' },
      grade: { type: 'string', enum: TEST_GRADES, description: '学年（入試問題は中3）' },
      subject: { type: 'string', enum: TEST_SUBJECTS, description: '教科' },
      term: { type: 'string', description: '時期・回（例：1学期期末、2学期中間、学年末、第2回、一般入試）。定期テストは必須' },
      topics: { type: 'string', description: '大問ごとの単元・出題内容（500字まで）' },
      title: { type: 'string', description: '題名（省くと年度・学校・学年・教科・時期から作る）' },
      note: { type: 'string', description: 'メモ（平均点・範囲・気づいたことなど。300字まで）' },
    },
    required: ['files', 'kind', 'year', 'school', 'grade', 'subject', 'topics'],
  },
};

export const SEARCH_TEST_PAPERS_TOOL = {
  name: 'search_test_papers',
  description:
    '保存した中学校のテスト問題（定期テスト・実力テスト・入試問題）を探す。「〇〇中の中2数学の期末」「一次関数が出た定期テスト」「去年の県立入試の英語」などに使う。' +
    '分かっている条件だけ渡す（省いた条件では絞らない）。query は単元・題名・メモの言葉（空白で区切ると全部を含むもの）。' +
    '結果のファイルのリンクは、そのまま書く（作らない）。見つからなければ、条件をゆるめてもう一度探すか、「保存されていない」と伝える。',
  input_schema: {
    type: 'object' as const,
    properties: {
      kind: { type: 'string', enum: TEST_KINDS, description: '種類' },
      school: { type: 'string', description: '学校名（一部でよい。「中学校」「中」は無くてよい）' },
      grade: { type: 'string', enum: TEST_GRADES, description: '学年' },
      subject: { type: 'string', enum: TEST_SUBJECTS, description: '教科' },
      year: { type: 'number', description: '年度（西暦）' },
      term: { type: 'string', description: '時期・回（一部でよい。例：期末、2学期）' },
      query: { type: 'string', description: '単元・題名・メモの言葉（例：一次関数 文章題）' },
      limit: { type: 'number', description: '何件まで出すか（1〜30。既定 15）' },
    },
  },
};

export type TestFileIn = { name: string; role: FileRole };
export type TestMeta = {
  kind: TestKind;
  year: number;
  school: string;
  grade: TestGrade;
  subject: TestSubject;
  term: string;
  topics: string;
  title: string;
  note: string;
};
export type SaveInput = TestMeta & { files: TestFileIn[] };

const line = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const block = (v: unknown, n: number) =>
  typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, n) : '';
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | '' => ((list as readonly string[]).includes(String(v)) ? (v as T) : '');

/** 年度（西暦）。「2026」「2026年度」「令和8年度」を読む。読めなければ 0。 */
export function toYear(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v >= 2000 && v <= 2100 ? Math.floor(v) : 0;
  const s = String(v ?? '').normalize('NFKC');
  const r = /令和\s*(\d{1,2}|元)/.exec(s);
  if (r) return 2018 + (r[1] === '元' ? 1 : Number(r[1]));
  const m = /(20\d{2})/.exec(s);
  return m ? Number(m[1]) : 0;
}

/** 題名を作る（例：2026年度 佐世保市立〇〇中学校 中2 数学 1学期期末）。 */
export function defaultTitle(m: Pick<TestMeta, 'year' | 'school' | 'grade' | 'subject' | 'term' | 'kind'>): string {
  return [`${m.year}年度`, m.school, m.grade, m.subject, m.term || m.kind].filter(Boolean).join(' ');
}

/**
 * 保存の入力を確かめる。available は、この質問の添付と前の添付のうち保存できるもの（PDF・画像）のファイル名。
 * 足りない・合わないときは、AI に返す理由を返す。
 */
export function checkSaveInput(input: Record<string, unknown>, available: string[]): { ok: true; value: SaveInput } | { ok: false; message: string } {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (!available.length) return { ok: false, message: '保存できる添付（PDF・画像）がありません。問題用紙・解答の PDF か写真を添付してもらってください。' };
  const raw = Array.isArray(o.files) ? o.files : [];
  const files: TestFileIn[] = [];
  const missing: string[] = [];
  for (const f of raw.slice(0, TEST_MAX_FILES)) {
    const ff = (f && typeof f === 'object' ? f : { name: f }) as Record<string, unknown>;
    const name = String(ff.name ?? '').trim();
    if (!name) continue;
    if (!available.includes(name)) {
      missing.push(name);
      continue;
    }
    if (files.some((x) => x.name === name)) continue;
    files.push({ name, role: oneOf(FILE_ROLES, ff.role) || '問題' });
  }
  if (missing.length) return { ok: false, message: `添付に無いファイル名です：${missing.join('、')}。保存できる添付：${available.join('、')}` };
  if (!files.length) return { ok: false, message: `files に保存する添付のファイル名を入れてください。保存できる添付：${available.join('、')}` };
  const kind = oneOf(TEST_KINDS, o.kind);
  if (!kind) return { ok: false, message: `kind（種類）は ${TEST_KINDS.join('・')} のどれかです。` };
  const year = toYear(o.year);
  if (!year) return { ok: false, message: 'year（年度・西暦）が読めません。例：2026' };
  const school = line(o.school, 40);
  if (!school) return { ok: false, message: 'school（学校）がありません。分からなければ職員に聞く。' };
  const grade = oneOf(TEST_GRADES, o.grade) || (kind === '入試問題' ? '中3' : '');
  if (!grade) return { ok: false, message: `grade（学年）は ${TEST_GRADES.join('・')} のどれかです。` };
  const subject = oneOf(TEST_SUBJECTS, o.subject);
  if (!subject) return { ok: false, message: `subject（教科）は ${TEST_SUBJECTS.join('・')} のどれかです。` };
  const term = line(o.term, 30);
  if (kind === '定期テスト' && !term) return { ok: false, message: 'term（時期・回。例：1学期期末）がありません。定期テストは必須です。' };
  const topics = block(o.topics, 500);
  if (topics.length < 2) return { ok: false, message: 'topics（大問ごとの単元・出題内容）を書いてください。あとで探す手がかりになります。' };
  const base = { kind, year, school, grade, subject, term };
  return {
    ok: true,
    value: { ...base, topics, title: line(o.title, 80) || defaultTitle(base), note: block(o.note, 300), files },
  };
}

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic' };

/** ドライブに置くファイル名（例：2026年度_定期テスト_〇〇中学校_中2_数学_1学期期末_問題.pdf）。同じ役目が続くときは番号を付ける。 */
export function testFileName(m: TestMeta, role: FileRole, mime: string, n = 0): string {
  const ext = EXT[String(mime).toLowerCase()] ?? (String(mime).split('/')[1] || 'bin');
  const parts = [`${m.year}年度`, m.kind, m.school, m.grade, m.subject, m.term, `${role}${n > 0 ? n + 1 : ''}`].filter(Boolean);
  return `${parts.join('_').replace(/[\\/:*?"<>|\r\n]+/g, ' ')}.${ext}`;
}

// --- 検索 ---------------------------------------------------------------------------------
export type TestFileRec = { role: string; name: string; url: string };
export type TestPaperRec = {
  id: string;
  ts: string;
  user: string;
  campus: string;
  kind: string;
  year: string;
  school: string;
  grade: string;
  subject: string;
  term: string;
  title: string;
  topics: string;
  note: string;
  files: TestFileRec[];
};

/** シートの「ファイル」の欄（1行に「役目｜ファイル名｜URL」）を読む。 */
export function parseFilesCell(cell: string): TestFileRec[] {
  return String(cell ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [role = '', name = '', url = ''] = l.split('｜');
      return { role: role.trim(), name: name.trim(), url: url.trim() };
    })
    .filter((f) => /^https?:\/\//.test(f.url));
}

export type SearchQuery = { kind: string; school: string; grade: string; subject: string; year: number; term: string; query: string; limit: number };

export function checkSearchInput(input: Record<string, unknown>): SearchQuery {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const lim = Number(o.limit);
  return {
    kind: oneOf(TEST_KINDS, o.kind),
    school: line(o.school, 40),
    grade: oneOf(TEST_GRADES, o.grade),
    subject: oneOf(TEST_SUBJECTS, o.subject),
    year: o.year == null || o.year === '' ? 0 : toYear(o.year),
    term: line(o.term, 30),
    query: line(o.query, 60),
    limit: Number.isFinite(lim) && lim >= 1 ? Math.min(30, Math.floor(lim)) : 15,
  };
}

/** 学校名を比べやすくする（空白・「市立」などの前置きの違い、「中学校」「中学」「中」の書き方を寄せる）。 */
export function schoolKey(s: string): string {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/(高等学校|中学校|中学|高校|中)$/, '');
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
    .filter((r) => !q.term || r.term.includes(q.term))
    .filter((r) => !sk || schoolKey(r.school).includes(sk) || sk.includes(schoolKey(r.school)))
    .filter((r) => {
      if (!words.length) return true;
      const hay = [r.title, r.topics, r.note, r.school, r.term, r.subject].join(' ');
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => Number(b.year) - Number(a.year) || String(b.ts).localeCompare(String(a.ts)));
}

const clip = (s: string, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** 検索の結果を、AI に渡す文にする。 */
export function formatTestPapers(found: TestPaperRec[], total: number, q: SearchQuery): string {
  const cond = [q.kind, q.year ? `${q.year}年度` : '', q.school, q.grade, q.subject, q.term, q.query ? `「${q.query}」` : ''].filter(Boolean).join('・') || '条件なし';
  const head = `【保存したテスト問題（${cond}）：${found.length}件／保存は全部で${total}件】`;
  if (!found.length) {
    return `${head}\n（該当なし）\n答え方：「保存されていない」と伝える。条件（学校名の書き方・年度・時期）をゆるめて探し直すか、問題を添付して保存してもらう。`;
  }
  const out = [head];
  for (const r of found.slice(0, q.limit)) {
    out.push(
      `- 【${r.kind}】${r.year}年度 ${r.school} ${r.grade} ${r.subject}${r.term ? ` ${r.term}` : ''}（登録：${r.user} ${String(r.ts).slice(0, 10)}）`,
      `    単元・出題内容：${clip(r.topics, 200)}${r.note ? `／メモ：${clip(r.note, 80)}` : ''}`,
      ...r.files.map((f) => `    ${f.role || 'ファイル'}：${f.url}`),
    );
  }
  if (found.length > q.limit) out.push(`…ほか${found.length - q.limit}件（条件を足して絞る）`);
  out.push(
    '答え方：見つかったものを表か箇条書きで示し、ファイルのリンクはこの結果の URL をそのまま書く（作らない）。' +
      'ファイルはフォルダの共有のままなので、開けないときは「15_AI利用データ」の権限を持つ人に頼むよう伝える。',
  );
  return out.join('\n');
}
