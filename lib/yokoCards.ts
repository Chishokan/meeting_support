// 要項カード：確定済みの要項のうち「実施中」「まもなく実施」だけを画面上部に出す。
//
// 1つの要項に複数の講座・コースが入っていることが多い（中等部秋講座なら
// STEP01〜04＋模試＋定期テスト対策で6件）。現場で聞かれるのは
// 「どの講座が」「いくらで」「いつから始まるか」なので、要項をひとまとめにせず
// 講座ごとに1行、開始日の早い順に並べる。
//
// 設計の要点：
// - 期間の判定は要項本文の「日程：」から取る。front matter の updated は
//   「確定した日」であって実施日ではないため、期間の判定には使えない。
// - 料金は、要項が講座ごとに値段を分けているときだけ講座の行に出す。
//   要項全体で1つの値段しか書かれていないときは、カード上部に1回だけ出す。
//   全体の値段を各行にコピーすると、模試だけ別料金といった場合に嘘になる。
// - どの講座にも結び付かなかった料金（「全コース一括申込み」など）は捨てず、
//   「そのほかの料金」として書かれたまま出す。
// - 読み取れなかった項目は推測で埋めず「未定」「未記入」と出す。
//   カードに嘘の金額・日程が出ると、そのまま保護者に伝わる。

import type { KnowledgeDoc } from './knowledgeDocs';
import { jstDate } from './companyKnowledge';

/** 「まもなく実施」とみなす日数。開始がこの日数以内ならカードを出す。 */
export const SOON_DAYS = 30;

/**
 * テスト表示。ここに書いた題名の要項は、日程に関わらずカードに出る。
 *
 * 2026年9月の画面確認で、当時は確定要項がすべて実施済みでカードが0件だったため、
 * 夏期2件を一時的に出していた。秋講座の要項が入り実際の日程でカードが出るように
 * なったので空にしてある。
 *
 * ★通常はこの配列は空のままにする。画面確認のために一時的に使うときだけ題名を入れ、
 *   確認が終わったら必ず空に戻すこと。入れたままだと終わった講座が出続ける。
 */
export const TEST_PINNED_TITLES: string[] = [];

/** 料金1件。audience は「塾生」「一般生」のほか「模試のみの受検」など要項に書かれた区分。 */
export type YokoFee = { audience: string; text: string };

/** 要項の中の講座・コース1件。 */
export type YokoItem = {
  name: string;
  when: string;              // 「9/12〜10/17」「10/18」「未定」
  startYmd: string | null;
  fees: YokoFee[];           // 講座ごとに値段が分かれているときだけ入る
};

export type YokoCard = {
  file: string;
  title: string;      // カード用に短くした題名
  fullTitle: string;  // front matter の title そのまま
  grades: string;     // 「中1・中2・中3」／読めなければ「未記入」
  period: string;     // 「2026年7月30日〜8月30日」／読めなければ「未記入」
  startYmd: string | null;
  endYmd: string | null;
  items: YokoItem[];    // 講座・コース（開始日の早い順）
  wholeFees: YokoFee[]; // 講座ごとに分かれていない受講料（全体の値段・早割・一括申込みなど）
  kind: '実施中' | '開始間近' | 'テスト表示';
  daysUntilStart: number | null; // 開始間近のときだけ入る
};

// --- 小さな道具 -----------------------------------------------------------

/** 「## ＜対象＞」から次の「## 」までを取り出す。 */
function sectionOf(body: string, name: string): string {
  const re = new RegExp(`^##\\s*＜${name}[^＞]*＞.*$`, 'm');
  const m = re.exec(body);
  if (!m) return '';
  const from = m.index + m[0].length;
  const rest = body.slice(from);
  const next = /^##\s/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** YYYY-MM-DD を日数に。日付の前後比較だけに使う（時刻は持たない）。 */
function dayNumber(s: string): number {
  return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / 86400000;
}

// --- 学年 -----------------------------------------------------------------

const SCHOOLS: { key: string; short: string; base: number }[] = [
  { key: '小', short: '小', base: 0 },
  { key: '中', short: '中', base: 6 },
  { key: '高', short: '高', base: 9 },
];

const GRADE_RE = /(新)?(小学?|中学?|高校?)?\s*([1-6])\s*年生/g;

/**
 * ＜対象＞から学年を拾って「小4〜小6・中1」の形にまとめる。
 *
 * 「小学4年生〜6年生」のように2つ目に学校種が書かれないので直前を引き継ぐ。
 * 括弧の中は先に落とす。「小学6年生（新中学1年生）」の括弧は進学後の学年で、
 * そのまま拾うと対象学年が倍に増えてしまうため。
 */
export function docGrades(body: string): string {
  const sec = sectionOf(body, '対象');
  if (!sec) return '未記入';

  const codes = new Set<number>();
  let sawShin = 0;
  let sawPlain = 0;

  // 括弧の中は原則読まない。「小学6年生（新中学1年生）」の括弧は進学後の学年で、
  // そのまま拾うと対象学年が倍になる。ただし「佐世保北中 合格者（新中学1年生）」のように
  // 括弧の中にしか学年が無い行もあるので、括弧の外で何も取れなければ括弧の中も見る。
  const scan = (line: string) => {
    let school: string | null = null;
    let shin = false;
    let prevEnd = -1;
    let prevCode: number | null = null;
    let hit = 0;
    GRADE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = GRADE_RE.exec(line)) !== null) {
      if (m[1]) shin = true;
      if (m[2]) school = m[2][0];
      if (!school) continue;
      const sc = SCHOOLS.find((x) => x.key === school);
      if (!sc) continue;
      const code = sc.base + Number(m[3]);
      const between = prevEnd === -1 ? '' : line.slice(prevEnd, m.index);
      if (prevCode != null && /[〜～~\-−ー]/.test(between)) {
        for (let c = Math.min(prevCode, code); c <= Math.max(prevCode, code); c++) codes.add(c);
      } else {
        codes.add(code);
      }
      if (m[1] || shin) sawShin++;
      else sawPlain++;
      prevEnd = m.index + m[0].length;
      prevCode = code;
      hit++;
    }
    return hit;
  };

  for (const raw of sec.split('\n')) {
    // 「※小学5年生は通常授業で対応」のような注記は対象学年ではない。
    // 拾うと、対象外の学年がカードに載る。
    if (/^[\s　]*[※*＊]/.test(raw)) continue;
    if (scan(raw.replace(/[（(][^）)]*[）)]/g, ' ')) === 0) scan(raw);
  }

  if (!codes.size) return '未記入';
  const prefix = sawShin > 0 && sawPlain === 0 ? '新' : '';

  const name = (code: number) => {
    for (let i = SCHOOLS.length - 1; i >= 0; i--) {
      if (code > SCHOOLS[i].base) return `${prefix}${SCHOOLS[i].short}${code - SCHOOLS[i].base}`;
    }
    return '';
  };

  // 連続する学年は「小4〜小6」にまとめる。1つ飛びは「・」で並べる。
  const sorted = [...codes].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j - i >= 2 ? `${name(sorted[i])}〜${name(sorted[j])}` : sorted.slice(i, j + 1).map(name).join('・'));
    i = j + 1;
  }
  return parts.join('・');
}

// --- 講座・コース（内容と日程） -------------------------------------------

/**
 * ＜実施内容および日程＞を「### ■ 見出し」で区切って、講座・コース1件ずつにする。
 * 見出しが講座名のこともあれば校舎名のこともある（春期は校舎ごとに日程が違う）。
 * どちらでも「いつ始まるか」を出したいので、書かれている見出しをそのまま名前にする。
 */
function splitContents(body: string): { name: string; dates: string[]; rawWhen: string }[] {
  const sec = sectionOf(body, '実施内容');
  if (!sec) return [];
  // 年が書かれていない「日程：」行のために、要項の中で最初に出てくる年を控えておく。
  const firstYear = /(\d{4})年/.exec(body)?.[1];

  const out: { name: string; dates: string[]; rawWhen: string }[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  const push = () => {
    if (!cur) return;
    const text = cur.lines.join('\n');
    const { dates, raw } = datesInSchedule(text, firstYear ? Number(firstYear) : undefined);
    out.push({ name: cur.name.trim(), dates, rawWhen: raw });
  };

  for (const line of sec.split('\n')) {
    const h = /^#{3,6}\s*(?:■\s*)?(.+?)\s*$/.exec(line);
    if (h) {
      push();
      cur = { name: h[1], lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  push();
  return out.filter((c) => c.name);
}

// --- 期間 -----------------------------------------------------------------

const DATE_RE = /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/g;

/**
 * 「日程：」の行から日付を拾う。
 *
 * 年は行の先頭にしか書かれない（「2026年3月30日（月）〜4月3日（金）」）ので、
 * 直前に出た年を引き継ぐ。12月→1月のように月が戻ったときだけ年を繰り上げる。
 * 「8月22日・8月10日」のような単なる前後は繰り上げない（誤って翌年にしないため）。
 *
 * Google ドキュメントから書き出すと「- 日程：…」と箇条書きになる。
 * 「- 形式：全6日程　…」のように途中に「日程」が出る行は拾わない。
 */
function datesInSchedule(text: string, fallbackYear?: number): { dates: string[]; raw: string } {
  const lines = text.split('\n').filter((l) => /^[-*・\s]*日程[：:]/.test(l.trim()));
  const found: string[] = [];
  const raws: string[] = [];

  for (const line of lines) {
    raws.push(line.trim().replace(/^[-*・\s]*日程[：:]\s*/, ''));
    let year = fallbackYear ?? null;
    let prevMonth: number | null = null;
    DATE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DATE_RE.exec(line)) !== null) {
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (m[1]) {
        year = Number(m[1]);
      } else if (year != null && prevMonth != null && mo < prevMonth && prevMonth >= 11) {
        year += 1; // 12月→1月の年またぎだけ繰り上げる
      }
      prevMonth = mo;
      if (year == null || mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      found.push(ymd(year, mo, d));
    }
  }
  found.sort();
  return { dates: [...new Set(found)], raw: raws.join(' ／ ') };
}

/** 要項全体の開始日・終了日。 */
export function docPeriod(body: string): { start: string | null; end: string | null; text: string } {
  // 年の書かれていない行のために、要項の中で最初に出てくる年を控えておく。
  const firstYear = /(\d{4})年/.exec(body)?.[1];
  const { dates } = datesInSchedule(body, firstYear ? Number(firstYear) : undefined);

  if (!dates.length) return { start: null, end: null, text: '未記入' };
  const start = dates[0];
  const end = dates[dates.length - 1];
  const label = (v: string, withYear: boolean) => {
    const [y, mo, d] = [v.slice(0, 4), Number(v.slice(5, 7)), Number(v.slice(8, 10))];
    return withYear ? `${y}年${mo}月${d}日` : `${mo}月${d}日`;
  };
  const text =
    start === end
      ? label(start, true)
      : `${label(start, true)}〜${label(end, start.slice(0, 4) !== end.slice(0, 4))}`;
  return { start, end, text };
}

/** 講座の行に出す日付。「9/12〜10/17」「10/18」「未定」。 */
function whenText(dates: string[], raw: string): string {
  const md = (v: string) => `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}`;
  if (!dates.length) return /未定|未記入/.test(raw) || !raw ? '未定' : raw.slice(0, 20);
  if (dates.length === 1) return md(dates[0]);
  return `${md(dates[0])}〜${md(dates[dates.length - 1])}`;
}

// --- 料金 -----------------------------------------------------------------

function yen(n: number, zeroText: string): string {
  return n === 0 ? zeroText : `${n.toLocaleString('ja-JP')}円`;
}

function range(list: number[], zeroText: string): string {
  const lo = Math.min(...list);
  const hi = Math.max(...list);
  return lo === hi ? yen(lo, zeroText) : `${yen(lo, zeroText)}〜${yen(hi, zeroText)}`;
}

// 行頭に来る「区分」の言葉。「塾生・講習会生　無料」のように連ねて書かれる。
const AUDIENCE_WORDS = ['塾生', '一般生', '講習会生', '外部生', '模試生', '内部生'];
// 区分として切り出すのは、その言葉で区切れているときだけ。
// 「塾生紹介の場合　27,500円」（一般生の節にある紹介価格）の「塾生」を区分として
// 切り出すと、塾生の料金が 27,500円 だと表示されてしまう。うしろが空白・区切り・
// 数字・行末のときだけ区分とみなす。
const AUDIENCE_HEAD = new RegExp(
  `^(?:${AUDIENCE_WORDS.join('|')})(?:[・、／/](?:${AUDIENCE_WORDS.join('|')}))*(?=[\\s　：:]|[0-9]|$)`,
);

/** 見出しが「塾生」「一般生」だけを指しているか（講座名ではないか）。 */
function audienceHeading(t: string): string | null {
  const x = t.replace(/[\s　]/g, '');
  if (/^塾生(・(講習会生|内部生))?$/.test(x)) return '塾生';
  if (/^一般生$/.test(x)) return '一般生';
  return null;
}

/**
 * 受講料の1行。
 * - forced … 見出しが講座名だった場合のその講座名（行の頭は区分になる）
 * - label  … 行の頭に書かれた名前。講座名のことも、「通常料金」「早割」のような
 *            料金の種類のこともある。どちらかは講座名と突き合わせて決める。
 */
type FeeLine = {
  forced: string | null;
  head: string;   // 直前の見出し（区分の見出しなら空）。どの講座にも当たらなかったときの名前に使う
  label: string;
  audience: string;
  amounts: number[];
  free: boolean;
};

/**
 * ＜受講料＞を1行ずつ読む。要項によって2つの書き方がある。
 *
 *  A) 見出しが区分（### ■ 塾生 ／ ### ■ 一般生）で、行が「講座名　金額」
 *     → 行の頭が講座名。区分は見出しから取る。
 *  B) 見出しが講座名（### ■ 中1・2　前期：定着コース）で、行が「塾生　金額」
 *     → 講座名は見出しから取る。行の頭が区分。
 *
 * B と判定するのは、見出しが＜実施内容＞の見出しと実際に一致したときだけ。
 * 「夏期講習会（塾生・一般生の区分は元データに記載なし）」のように一致しない見出しは
 * 講座名として扱わない。
 *
 * 「### ■ 割引」の節は早割・兄弟割の一覧で、講座の値段ではないので読まない。
 */
function parseFeeLines(body: string, contentNames: string[]): FeeLine[] {
  const sec = sectionOf(body, '受講料');
  if (!sec) return [];

  const out: FeeLine[] = [];
  let headAudience: string | null = null;
  let headContent: string | null = null;
  let headName = '';
  let skipBlock = false;

  for (const raw of sec.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const h = /^#{2,6}\s*(?:■\s*)?(.+?)\s*$/.exec(line);
    if (h) {
      const t = h[1];
      skipBlock = /割引|注意|備考/.test(t);
      headAudience = audienceHeading(t);
      headContent = headAudience || !matchContent(t, contentNames).hits.length ? null : t;
      headName = headAudience || skipBlock ? '' : t;
      continue;
    }
    if (skipBlock) continue;
    // 「※兄弟割：…」などの注記は価格表ではないので拾わない。
    if (!/^[・\-*]/.test(line)) continue;

    const item = line.replace(/^[・\-*\s]+/, '');

    // 行の頭の区分（「塾生」「塾生・講習会生」）を切り出す。
    const am = AUDIENCE_HEAD.exec(item);
    const lineAudience = am ? am[0] : null;
    let label = (am ? item.slice(am[0].length) : item).replace(/^[\s　：:・、／/]+/, '');
    // 金額より前だけが名前。「サイトク前期〜最重要単元特訓〜　26,400円」→「サイトク前期〜最重要単元特訓〜」
    label = label
      .split(/[0-9][0-9,]*円|無料/)[0]
      .replace(/[\s　：:／/]+$/, '')
      .replace(/[はがをのも、]+$/, '') // 「体験は無料」→「体験」
      .trim();

    // 「2,200円引」「教材費最大11,000円（税込）無料」のような割引額・特典額は
    // 払う金額ではないので落とす。金額と「無料」の間に（税込）が挟まることがある。
    const cleaned = item.replace(/[0-9][0-9,]*円(?:[（(][^）)]*[）)])?[\s　]*(?:引き?|無料|免除|相当|分)/g, ' ');
    const amounts: number[] = [];
    for (const m of cleaned.matchAll(/([0-9][0-9,]*)円/g)) {
      const n = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(n)) amounts.push(n);
    }
    // 「無料」は括弧の外にあるときだけ価格として数える。
    // 「5,500円／回（初めて受験する場合は初回無料）」の無料は条件付きの但し書きで、
    // これを拾うと一般生の料金が「無料〜33,000円」になり 5,500円 が消えてしまう。
    // 括弧の中の「金額」は逆に本物のことがある（「29,700円（塾生紹介の場合 25,300円）」）ので落とさない。
    const free = /無料/.test(cleaned.replace(/[（(][^）)]*[）)]/g, ' '));
    if (free) amounts.push(0);
    if (!amounts.length) continue;

    out.push({
      forced: headContent,
      head: headName,
      label,
      audience: lineAudience ?? headAudience ?? '',
      amounts,
      free,
    });
  }
  return out;
}

/** 画面に出す料金の見出し。「一般生／早割」「模試のみの受検」など、書かれたまま。 */
function feeWith(f: FeeLine, extra: string): YokoFee {
  const parts = [f.audience, extra].filter(Boolean);
  const audience = parts.join('／').slice(0, 40) || '受講料';
  return { audience, text: range(f.amounts, f.free ? '無料' : '0円') };
}

// --- 料金と講座の突き合わせ -----------------------------------------------

/**
 * 突き合わせ用に名前をならす。
 * 括弧の中（「（通塾）」「（中3希望者）」）や「STEP01 」、区切り記号を落として比べる。
 */
function normName(s: string): string {
  return s
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/^STEP\s*\d+\s*/i, '')
    .replace(/[【】「」『』［］[\]]/g, '')
    .replace(/[\s　・･,、]/g, '')
    .replace(/(受験料|受講料|料金|代)$/, '');
}

/**
 * 料金行の名前が、どの講座を指しているかを返す（複数可）。
 *
 * 「秋の受検対策講座」は（通塾）と（オンライン）の2件に当たる。同じ講座の受け方違いで
 * 値段も同じなので、両方に出すのが正しい。
 *
 * 「対象の秋講座（STEP01〜04・本番レベル模試・定期テスト対策講座）」のように
 * 括弧の中に対象の講座が並ぶ書き方もあるので、そのままで当たらなければ
 * 括弧の中を「・」で割って1つずつ当てる。「STEP01〜04」は番号の範囲として広げる。
 * このときは括弧の中身が講座のまとめ書きなので、行の名前は区分として出さない
 * （viaParen で知らせる）。
 */
function matchContent(label: string, names: string[]): { hits: number[]; viaParen: boolean } {
  const direct = hitNames(label, names);
  if (direct.length) return { hits: direct, viaParen: false };

  const inParen = /[（(]([^）)]*)[）)]/.exec(label)?.[1];
  if (!inParen) return { hits: [], viaParen: false };

  const found = new Set<number>();
  for (const token of inParen.split(/[・、，,／/]/)) {
    const t = token.trim();
    if (!t) continue;
    // 「STEP01〜04」→ STEP01・02・03・04
    const rangeM = /^STEP\s*0*(\d+)\s*[〜～~\-−ー]\s*(?:STEP)?\s*0*(\d+)$/i.exec(t);
    if (rangeM) {
      const lo = Number(rangeM[1]);
      const hi = Number(rangeM[2]);
      names.forEach((n, i) => {
        const sm = /^STEP\s*0*(\d+)/i.exec(n.trim());
        if (sm && Number(sm[1]) >= lo && Number(sm[1]) <= hi) found.add(i);
      });
      continue;
    }
    for (const i of hitNames(t, names)) found.add(i);
  }
  return { hits: [...found], viaParen: found.size > 0 };
}

// 「セット」「一括」「＋」は複数の講座をまとめた申込み。片方だけに付いていたら別物。
// これを見ないと「チャレンジ合宿＋課題完成合宿セット」の値段が
// 「チャレンジ合宿」の行に出てしまう（41,800円と25,300円が同じ講座に並ぶ）。
const BUNDLE_RE = /セット|一括|まとめ|[＋+]/;

function hitNames(token: string, names: string[]): number[] {
  const a = normName(token);
  if (a.length < 3) return [];
  // 判定は括弧を外したあとの名前で。「フルコース（前期＋後期）」の＋は
  // 講座名の説明であって、まとめ申込みの印ではない。
  const aBundle = BUNDLE_RE.test(a);
  return names
    .map((n, i) => [normName(n), i] as const)
    .filter(([b]) => {
      if (b.length < 3) return false;
      if (aBundle !== BUNDLE_RE.test(b)) return false;
      return a.includes(b) || b.includes(a);
    })
    .map(([, i]) => i);
}

/**
 * 料金行の名前から講座名の部分を取り除いて、残った修飾だけを返す。
 * 「県立中学受検対策コース／小学6年生」→「小学6年生」。
 * 講座名と同じだけなら空（区分だけを出す）。
 */
function residualLabel(label: string, contentName: string): string {
  if (!label) return '';
  const base = contentName
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/^STEP\s*\d+\s*/i, '')
    .trim();
  if (!base) return label;
  if (normName(label) === normName(base)) return '';
  if (label.startsWith(base)) {
    return label.slice(base.length).replace(/^[\s　・／/：:、,]+/, '').trim();
  }
  const a = normName(label);
  const b = normName(base);
  if (a && b && (a.includes(b) || b.includes(a))) return '';
  return label;
}

// --- 題名 -----------------------------------------------------------------

/**
 * カード用に題名を短くする。
 * 「2026 中等部夏期講習会 実施要項（2026）(0912確定)」→「2026 中等部夏期講習会」。
 * 確定日の注記や「実施要項」は全件に付いていて、並べたときの見分けに効かない。
 */
export function shortTitle(title: string): string {
  return title
    .replace(/[（(]\s*\d{4}\s*[）)]/g, '')
    .replace(/[（(]\s*\d{3,4}\s*確定\s*[）)]/g, '')
    .replace(/\s*実施要項\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// --- 組み立て -------------------------------------------------------------

export function buildCard(doc: KnowledgeDoc, kind: YokoCard['kind'], daysUntilStart: number | null): YokoCard {
  const period = docPeriod(doc.body);
  const contents = splitContents(doc.body);
  const names = contents.map((c) => c.name);
  const feeLines = parseFeeLines(doc.body, names);

  // 料金行を講座に振り分ける。
  // 行の頭の名前が＜実施内容＞の見出しと一致したときだけ、その講座の行に出す。
  // 一致しないもの（「通常料金」「早割」「全コース一括申込み」など）は講座ごとの値段では
  // ないので、カード上部に書かれたまま出す。各行にコピーすると、模試だけ別料金といった
  // 要項で嘘になる。
  const perItem: YokoFee[][] = names.map(() => []);
  const wholeFees: YokoFee[] = [];

  for (const f of feeLines) {
    // 見出しが講座名だった場合（### ■ 中1・2　前期：定着コース）はその講座へ。
    const m = f.forced ? matchContent(f.forced, names) : f.label ? matchContent(f.label, names) : null;
    if (m && m.hits.length) {
      for (const i of m.hits) {
        // 行の名前から講座名を除いた残り（「／小学6年生」など）だけを区分に足す。
        // 括弧の中のまとめ書きで当たった場合は、行の名前は区分ではないので足さない。
        const extra = m.viaParen || f.forced ? (f.forced ? f.label : '') : residualLabel(f.label, names[i]);
        perItem[i].push(feeWith(f, extra));
      }
      continue;
    }
    // どの講座にも当たらなかった料金。何の値段か分からなくなるので、
    // 行の名前（無ければ見出しの講座名）を必ず添える。
    wholeFees.push(feeWith(f, f.label || f.forced || f.head));
  }

  const items: YokoItem[] = contents.map((c, i) => ({
    name: c.name,
    when: whenText(c.dates, c.rawWhen),
    startYmd: c.dates[0] ?? null,
    // 「STEP01〜04」のまとめ書きと個別の行が同じ講座に当たることがある。
    // 同じ区分・同じ金額は1つにまとめる。
    fees: perItem[i].filter(
      (f, k, all) => all.findIndex((x) => x.audience === f.audience && x.text === f.text) === k,
    ),
  }));

  // 開始日の早い順。日程が未定のものは末尾へ（並びが日付順に見えるように）。
  items.sort((a, b) => {
    if (a.startYmd && b.startYmd) return a.startYmd.localeCompare(b.startYmd);
    if (a.startYmd) return -1;
    if (b.startYmd) return 1;
    return 0;
  });

  return {
    file: doc.file,
    title: shortTitle(doc.title),
    fullTitle: doc.title,
    grades: docGrades(doc.body),
    period: period.text,
    startYmd: period.start,
    endYmd: period.end,
    items,
    wholeFees,
    kind,
    daysUntilStart,
  };
}

/**
 * 確定済みの要項から、実施中・まもなく実施のものだけカードにする。
 * どちらにも当てはまらない要項はカードにしない（終わった講座を出さない）。
 */
export function buildCards(docs: KnowledgeDoc[], now: Date = new Date()): YokoCard[] {
  const { y, m, d } = jstDate(now);
  const today = dayNumber(ymd(y, m, d));

  const cards: YokoCard[] = [];
  const used = new Set<string>();

  for (const doc of docs) {
    const { start, end } = docPeriod(doc.body);
    if (!start || !end) continue;
    const s = dayNumber(start);
    const e = dayNumber(end);
    if (today >= s && today <= e) {
      cards.push(buildCard(doc, '実施中', null));
      used.add(doc.file);
    } else if (s > today && s - today <= SOON_DAYS) {
      cards.push(buildCard(doc, '開始間近', s - today));
      used.add(doc.file);
    }
  }

  // テスト表示（TEST_PINNED_TITLES を空にすれば何も足されない）。
  for (const doc of docs) {
    if (used.has(doc.file)) continue;
    if (!TEST_PINNED_TITLES.some((t) => doc.title.includes(t))) continue;
    cards.push(buildCard(doc, 'テスト表示', null));
    used.add(doc.file);
  }

  const rank = { 実施中: 0, 開始間近: 1, テスト表示: 2 } as const;
  return cards.sort((a, b) => {
    const r = rank[a.kind] - rank[b.kind];
    if (r !== 0) return r;
    return (a.startYmd ?? '').localeCompare(b.startYmd ?? '');
  });
}
