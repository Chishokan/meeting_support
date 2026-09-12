// 要項カード：確定済みの要項のうち「実施中」「まもなく実施」だけを、
// タイトル・学年・期間・料金の4点に絞って画面上部に出す。
//
// 設計の要点：
// - 要項の本文は長い。会議中や保護者対応中に全文は読めないので、
//   その場で必要になる4点だけをカードにする。詳細はチャットで聞く。
// - 期間の判定は要項本文の「日程：」から取る。front matter の updated は
//   「確定した日」であって実施日ではないため、期間の判定には使えない。
// - 読み取れなかった項目は推測で埋めず「未記入」と出す。
//   カードに嘘の金額・日程が出ると、そのまま保護者に伝わる。

import type { KnowledgeDoc } from './knowledgeDocs';
import { jstDate } from './companyKnowledge';

/** 「まもなく実施」とみなす日数。開始がこの日数以内ならカードを出す。 */
export const SOON_DAYS = 30;

/**
 * テスト表示。
 *
 * 2026年9月時点で確定している要項は実施が終わっており、日程だけで絞ると
 * カードが1枚も出ない。画面の確認ができないため、この2件を「実施中」として
 * 強制的に出している。カードには「テスト表示」と明示する。
 *
 * ★秋以降の要項が入ったら、この配列を空にする（`= []`）。
 *   空にすれば、あとは実際の日程だけでカードが出る。ほかに直す所は無い。
 */
export const TEST_PINNED_TITLES = ['中等部夏期講習会', '県中対策 夏期講習会'];

export type YokoFee = { audience: string; text: string };

export type YokoCard = {
  file: string;
  title: string;      // カード用に短くした題名
  fullTitle: string;  // front matter の title そのまま
  grades: string;     // 「中1・中2・中3」／読めなければ「未記入」
  period: string;     // 「2026年7月30日〜8月30日」／読めなければ「未記入」
  startYmd: string | null;
  endYmd: string | null;
  fees: YokoFee[];
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

// --- 期間 -----------------------------------------------------------------

const DATE_RE = /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/g;

/**
 * 「日程：」の行から日付を全部拾い、要項全体の開始日と終了日を出す。
 *
 * 年は行の先頭にしか書かれない（「2026年3月30日（月）〜4月3日（金）」）ので、
 * 直前に出た年を引き継ぐ。12月→1月のように月が戻ったときだけ年を繰り上げる。
 * 「8月22日・8月10日」のような単なる前後は繰り上げない（誤って翌年にしないため）。
 */
export function docPeriod(body: string): { start: string | null; end: string | null; text: string } {
  const lines = body.split('\n').filter((l) => /^日程[：:]/.test(l.trim()));
  const found: string[] = [];

  // 年の書かれていない行のために、要項の中で最初に出てくる年を控えておく。
  const firstYear = /(\d{4})年/.exec(body)?.[1];

  for (const line of lines) {
    let year = firstYear ? Number(firstYear) : null;
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

  if (!found.length) return { start: null, end: null, text: '未記入' };
  found.sort();
  const start = found[0];
  const end = found[found.length - 1];
  const label = (s: string, withYear: boolean) => {
    const [y, mo, d] = [s.slice(0, 4), Number(s.slice(5, 7)), Number(s.slice(8, 10))];
    return withYear ? `${y}年${mo}月${d}日` : `${mo}月${d}日`;
  };
  const text =
    start === end
      ? label(start, true)
      : `${label(start, true)}〜${label(end, start.slice(0, 4) !== end.slice(0, 4))}`;
  return { start, end, text };
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

// --- 料金 -----------------------------------------------------------------

function yen(n: number): string {
  return n === 0 ? '無料' : `${n.toLocaleString('ja-JP')}円`;
}

function range(list: number[]): string {
  const lo = Math.min(...list);
  const hi = Math.max(...list);
  return lo === hi ? yen(lo) : `${yen(lo)}〜${yen(hi)}`;
}

/**
 * ＜受講料＞から塾生・一般生それぞれの金額の幅を出す。
 *
 * 要項によって「### ■ 塾生」で分かれている場合と、コースごとの見出しの下に
 * 「・塾生　25,300円」と並ぶ場合があるので、見出しと行頭の両方を見る。
 *
 * 拾ってはいけない金額が2種類ある。
 * - 「2,200円引」のような割引額（価格ではない）
 * - 「教材費最大11,000円無料」のような特典額（払う金額ではない）
 * どちらも先に落とす。残した場合、カードに「無料〜11,000円」のような
 * 実際には存在しない価格帯が出てしまう。
 */
export function docFees(body: string): YokoFee[] {
  const sec = sectionOf(body, '受講料');
  if (!sec) return [];

  const BUCKETS = ['塾生', '一般生', '区分なし'] as const;
  type Bucket = (typeof BUCKETS)[number];
  const amounts: Record<Bucket, number[]> = { 塾生: [], 一般生: [], 区分なし: [] };
  const seen = new Set<Bucket>();
  let heading: Bucket | null = null;

  for (const raw of sec.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const h = /^#{2,6}\s*(?:■\s*)?(.+)$/.exec(line);
    if (h) {
      const t = h[1];
      // 「夏期講習会（塾生・一般生の区分は元データに記載なし）」のように
      // 両方が書かれている見出しは、どちらかに寄せると間違いになる。区分なし扱い。
      const juku = t.includes('塾生');
      const ippan = t.includes('一般生');
      heading = juku && ippan ? null : ippan ? '一般生' : juku ? '塾生' : null;
      if (heading) seen.add(heading);
      continue;
    }
    // 「※兄弟割：…」などの注記は価格表ではないので拾わない。
    if (!/^[・\-*]/.test(line)) continue;

    const item = line.replace(/^[・\-*\s]+/, '');
    const bucket: Bucket = item.startsWith('一般生')
      ? '一般生'
      : item.startsWith('塾生')
        ? '塾生'
        : (heading ?? '区分なし');
    seen.add(bucket);

    const cleaned = item.replace(/[0-9][0-9,]*円(?:引き?|無料|免除|相当|分)/g, ' ');
    for (const m of cleaned.matchAll(/([0-9][0-9,]*)円/g)) {
      const n = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(n)) amounts[bucket].push(n);
    }
    if (/無料/.test(cleaned)) amounts[bucket].push(0);
  }

  const fees: YokoFee[] = [];
  for (const b of BUCKETS) {
    if (amounts[b].length) fees.push({ audience: b, text: range(amounts[b]) });
    // 見出しや行はあるのに金額が書かれていない場合（「未記入」「月額授業料に変更なし」など）。
    // 黙って消すと「料金の記載がある要項」に見えてしまうので、記載なしと出す。
    else if (seen.has(b) && b !== '区分なし') fees.push({ audience: b, text: '金額の記載なし' });
  }
  if (!fees.length) return [{ audience: '受講料', text: '未記入' }];
  return fees;
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
  return {
    file: doc.file,
    title: shortTitle(doc.title),
    fullTitle: doc.title,
    grades: docGrades(doc.body),
    period: period.text,
    startYmd: period.start,
    endYmd: period.end,
    fees: docFees(doc.body),
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
