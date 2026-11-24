// 英語の単語テスト：範囲（学年・Unit・区分）と出し方から、元データ（lib/english/data）の問題を選ぶ。ほかに依存しない。
// 後半は基本単語の小テスト：英単語一覧（data/basic.ts）から、分類（曜日・月・数字など）・学年の目安・品詞で絞って選ぶ。不規則動詞は原形・過去形・過去分詞の表にする。
// 問題と答えは元データのまま使い、AI は書かない（答えの誤りを入れないため）。Word にするのは wordQuizDoc.ts。

// 元データ（lib/english/data）は呼ぶ側が渡す（books.ts の BOOKS）。この中で読み込まないのは、テスト（node --test）で読み込めるようにするため。
import type { BasicLevel, BasicWord, Book, IrregularVerb, KwtItem, Section, Unit, Word } from './data/types';

/** words：単語（教材の Key Words・基本単語）／kwt：巻末の Key Words TEST／verbs：不規則動詞の変化 */
export type Source = 'words' | 'kwt' | 'verbs';
export type Direction = 'ja-en' | 'en-ja' | 'mix';

/** 1問（Word に入れる形）。 */
export type QuizQ =
  | { kind: 'word'; prompt: string; answer: string; /** 日本語を見て英語を書く */ toEn: boolean; star: boolean }
  | { kind: 'kwt'; ja: string; en: string; note?: string }
  /** 不規則動詞：意味と、原形・過去形・過去分詞。ask にある形を書かせ、ほかは見せる（past だけのときは過去分詞の欄を出さない） */
  | { kind: 'verb'; ja: string; base: string; past: string; pp: string; ask: VerbAsk; note?: string };

/** past-pp：原形を見て過去形・過去分詞を書く／past：原形を見て過去形を書く／all：意味を見て原形・過去形・過去分詞を書く */
export type VerbAsk = 'past-pp' | 'past' | 'all';

export type WordQuiz = {
  title: string;
  /** 枚の上の範囲の表示（例：中1 Unit4（Part1・Part2）） */
  range: string;
  source: Source;
  /** 版（A・B…）ごとの問題。版が1つなら versions は1つ */
  versions: { label: string; questions: QuizQ[] }[];
  /** 範囲にあった問題の数（絞り込みのあと・数を減らす前） */
  available: number;
};

export type WordQuizOptions = {
  grade: string;
  unit: string;
  /** 区分の名前（空なら Unit のすべて） */
  sections?: string[];
  source?: Source;
  starOnly?: boolean;
  direction?: Direction;
  /** 問題の数（省くと範囲のすべて） */
  count?: number;
  order?: 'book' | 'random';
  /** 版の数（1〜3。A・B・C。同じ問題で並びを変える） */
  versions?: number;
  title?: string;
  /** 並べかえの乱数（テストで決まった並びにするため。省くと Math.random） */
  random?: () => number;
};

/** 1枚に入る数（wordQuizDoc.ts の書式に合わせた目安）。 */
export const PER_SHEET = { words: 40, kwt: 12, verbs: 20 } as const;
export const MAX_COUNT = { words: 120, kwt: 36, verbs: 90 } as const;

/** Unit の呼び名（数字なら「Unit4」、プレステップ・Let's Read1 などはそのまま）。 */
export const unitLabel = (u: Unit) => (/^\d+$/.test(u.unit) ? `Unit${u.unit}` : u.unit);

export const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s,，・、'’]/g, '').replace(/[〜~]/g, '-');

export function findBook(books: Book[], grade: string): Book | undefined {
  const g = grade.normalize('NFKC').replace(/\s/g, '').replace(/^中学?/, '中').replace(/年生?$/, '');
  const key = /^[123]$/.test(g) ? `中${g}` : g;
  return books.find((b) => b.grade === key);
}

export function findUnit(book: Book, unit: string): Unit | undefined {
  const u = norm(unit).replace(/^unit/, '');
  // 「プレ」→プレステップ、「Let's Start」→Let's Start2 のような、頭だけの呼び方も当てる
  return book.units.find((x) => norm(x.unit) === u) ?? (u.length >= 2 && !/^\d+$/.test(u) ? book.units.find((x) => norm(x.unit).startsWith(u)) : undefined);
}

/** 区分の名前を探す（「part1」「Part 1」「Let's Talk 1」などの揺れを許す。「Part3」で「Part3, T&S」、「Part2」で「Part1, 2」も当てる）。 */
export function findSection(unit: Unit, name: string): Section | undefined {
  const n = norm(name);
  return (
    unit.sections.find((s) => norm(s.id) === n) ??
    unit.sections.find((s) => sectionAliases(s.id).includes(n)) ??
    unit.sections.find((s) => norm(s.id).startsWith(n) && n.length >= 4)
  );
}

/** 区分の名前を「,」で分けた呼び名（「Part1, 2」→ part1・part2、「Part3, L&T, T&S」→ part3・l&t・t&s）。 */
function sectionAliases(id: string): string[] {
  let head = '';
  return id.split(/[,，]/).map((p) => {
    const t = norm(p);
    if (/^\d+$/.test(t)) return head + t;
    head = t.replace(/\d+$/, '');
    return t;
  });
}

/** 学年・Unit・区分の一覧（AI と職員に見せる）。 */
export function rangeList(books: Book[]): string {
  const lines: string[] = [];
  for (const b of books) {
    for (const u of b.units) {
      lines.push(`- ${b.grade} ${unitLabel(u)}「${u.title}」：${u.sections.map((s) => `${s.id}（${s.words.length}語${s.words.some((w) => w.star) ? `・☆${s.words.filter((w) => w.star).length}` : ''}${s.kwt.length ? `・KWT${s.kwt.length}問` : ''}）`).join('／')}`);
    }
  }
  return lines.join('\n');
}

export function shuffle<T>(a: T[], random: () => number): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 同じ語（英語が同じ）は、最初に出た区分の1つだけにする。 */
export function uniqueWords<T extends { en: string }>(words: T[]): T[] {
  const seen = new Set<string>();
  return words.filter((w) => {
    const k = norm(w.en);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 範囲と出し方から、問題を選ぶ。直せない形なら理由を返す（AI に直してもらう）。 */
export function buildWordQuiz(books: Book[], o: WordQuizOptions): { ok: true; value: WordQuiz } | { ok: false; message: string } {
  const random = o.random ?? Math.random;
  const book = findBook(books, String(o.grade ?? ''));
  if (!book) return { ok: false, message: `学年「${o.grade}」の元データがありません。入っている範囲：\n${rangeList(books)}` };
  const unit = findUnit(book, String(o.unit ?? ''));
  if (!unit) return { ok: false, message: `${book.grade}の Unit「${o.unit}」の元データがありません。入っている範囲：\n${rangeList([book])}` };
  const names = (o.sections ?? []).map((s) => String(s).trim()).filter(Boolean);
  const sections: Section[] = [];
  for (const n of names) {
    const s = findSection(unit, n);
    if (!s) return { ok: false, message: `${book.grade} ${unitLabel(unit)} に区分「${n}」がありません。区分：${unit.sections.map((x) => x.id).join('／')}` };
    if (!sections.includes(s)) sections.push(s);
  }
  if (!sections.length) sections.push(...unit.sections);
  const source: Source = o.source === 'kwt' ? 'kwt' : 'words';
  const direction: Direction = o.direction === 'en-ja' || o.direction === 'mix' ? o.direction : 'ja-en';
  const range = `${book.grade} ${unitLabel(unit)}${names.length ? `（${sections.map((s) => s.id).join('・')}）` : ''}`;

  let base: (Word | KwtItem)[];
  if (source === 'kwt') {
    base = sections.flatMap((s) => s.kwt);
    if (!base.length) {
      const has = unit.sections.filter((s) => s.kwt.length).map((s) => s.id);
      return { ok: false, message: `選んだ区分（${sections.map((s) => s.id).join('・')}）には、巻末の Key Words TEST の問題がありません。${has.length ? `KWT がある区分：${has.join('／')}` : ''}` };
    }
  } else {
    let words = uniqueWords(sections.flatMap((s) => s.words));
    if (o.starOnly) words = words.filter((w) => w.star);
    if (!words.length) return { ok: false, message: `選んだ区分（${sections.map((s) => s.id).join('・')}）に${o.starOnly ? '☆の' : ''}単語がありません。` };
    base = words;
  }
  const available = base.length;
  const max = MAX_COUNT[source];
  const want = typeof o.count === 'number' && o.count >= 1 ? Math.min(Math.floor(o.count), available, max) : Math.min(available, max);
  const order = o.order === 'random' ? 'random' : 'book';
  // 数を減らすときは、範囲からまんべんなく（ランダムなら無作為に、教材順なら等間隔に）選ぶ
  let picked: (Word | KwtItem)[];
  if (want >= available) picked = base;
  else if (order === 'random') picked = shuffle(base, random).slice(0, want);
  else picked = Array.from({ length: want }, (_, i) => base[Math.floor((i * available) / want)]);
  if (order === 'book') picked = base.filter((x) => picked.includes(x));

  const nVersions = Math.max(1, Math.min(3, Math.floor(o.versions ?? 1)));
  const toQ = (x: Word | KwtItem, i: number): QuizQ => {
    if (source === 'kwt') {
      const k = x as KwtItem;
      return { kind: 'kwt', ja: k.ja, en: k.en, ...(k.note ? { note: k.note } : {}) };
    }
    const w = x as Word;
    const toEn = direction === 'ja-en' || (direction === 'mix' && i % 2 === 0);
    return { kind: 'word', prompt: toEn ? w.ja : w.en, answer: toEn ? w.en : w.ja, toEn, star: w.star };
  };
  // 問い方（日→英・英→日）は語ごとに先に決め、版が変わっても同じにする
  const qs = picked.map(toQ);
  const versions = Array.from({ length: nVersions }, (_, v) => {
    // 教材順の1つ目の版はそのまま。ほかの版とランダムは並びを変える（A と B で同じ並びにしない）
    const list = order === 'book' && v === 0 ? qs : shuffle(qs, random);
    return { label: nVersions > 1 ? 'ABC'[v] : '', questions: list };
  });
  const kind = source === 'kwt' ? 'Key Words TEST' : '単語テスト';
  const title = (o.title ?? '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 40) || `英語 ${range} ${kind}`;
  return { ok: true, value: { title, range, source, versions, available } };
}

/** KWT の英文の [[答え]] を、空欄か答えに置きかえた部品に分ける。 */
export function kwtParts(en: string): { text: string; blank: boolean }[] {
  const out: { text: string; blank: boolean }[] = [];
  const re = /\[\[(.+?)\]\]/g;
  let last = 0;
  for (const m of en.matchAll(re)) {
    if (m.index! > last) out.push({ text: en.slice(last, m.index), blank: false });
    out.push({ text: m[1], blank: true });
    last = m.index! + m[0].length;
  }
  if (last < en.length) out.push({ text: en.slice(last), blank: false });
  return out;
}

// ---- 基本単語・不規則動詞 ----

export type BasicData = { words: BasicWord[]; verbs: IrregularVerb[] };

export type BasicQuizOptions = {
  /** words：基本単語（日本語⇔英語）／verbs：不規則動詞の変化 */
  kind: 'words' | 'verbs';
  /** 分類（元の一覧の分類の名前、または 曜日・月・数字・序数・不規則動詞 などのまとまり）。空ならすべて */
  categories?: string[];
  /** 学年の目安（小学校・中1・中2）。空ならすべて */
  levels?: string[];
  /** 品詞（名詞・動詞・熟語 など）。空ならすべて */
  pos?: string[];
  direction?: Direction;
  verbAsk?: VerbAsk;
  count?: number;
  order?: 'book' | 'random';
  versions?: number;
  title?: string;
  random?: () => number;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const BIG_NUMBERS = ['hundred', 'thousand', 'million', 'billion'];
const ORDINAL = /^\d+番目$/;

/** 元の一覧の分類のほかに選べるまとまり（名前 → 当てはまる語）。 */
export const BASIC_GROUPS: { name: string; aliases: string[]; test: (w: BasicWord) => boolean; about: string }[] = [
  { name: '曜日', aliases: ['曜日'], test: (w) => DAYS.includes(w.en), about: 'Sunday〜Saturday' },
  { name: '月', aliases: ['月', '月名', '月の名前'], test: (w) => MONTHS.includes(w.en), about: 'January〜December' },
  { name: '数字', aliases: ['数字', '数', '数詞', '基数'], test: (w) => w.category === '基数' || BIG_NUMBERS.includes(w.en), about: 'one〜ninety と hundred・thousand・million・billion' },
  { name: '序数', aliases: ['序数', '順番'], test: (w) => ORDINAL.test(w.ja), about: 'first・third など（〜番目）' },
  { name: '不規則動詞', aliases: ['不規則動詞', '不規則'], test: (w) => w.conj === '不規則', about: '不規則に変化する動詞（意味のテスト。変化を書くのは不規則動詞のテスト）' },
  { name: '規則動詞', aliases: ['規則動詞'], test: (w) => w.conj === '規則', about: '' },
  { name: '助動詞', aliases: ['助動詞'], test: (w) => w.conj === '助動詞', about: '' },
];

const LEVELS: BasicLevel[] = ['小学校', '中1', '中2'];

function findLevel(s: string): BasicLevel | undefined {
  const t = s.normalize('NFKC').replace(/\s/g, '').replace(/^中学?/, '中').replace(/年生?$/, '');
  if (/^小/.test(t)) return '小学校';
  if (t === '中1' || t === '1') return '中1';
  if (t === '中2' || t === '2') return '中2';
  return undefined;
}

/** 分類の名前を探す（まとまり → 元の分類 の順。元の分類は「時」で「時・曜日・月」を当てない、ぴったりを先に）。 */
function findCategory(words: BasicWord[], name: string): { label: string; test: (w: BasicWord) => boolean } | undefined {
  const n = norm(name);
  const g = BASIC_GROUPS.find((x) => x.aliases.some((a) => norm(a) === n));
  if (g) return { label: g.name, test: g.test };
  const cats = [...new Set(words.map((w) => w.category))];
  const c = cats.find((x) => norm(x) === n) ?? cats.find((x) => norm(x).includes(n) && n.length >= 2);
  return c ? { label: c, test: (w) => w.category === c } : undefined;
}

/** 選べる分類の一覧（AI と職員に見せる）。 */
export function basicCategoryList(data: BasicData): string {
  const count = (t: (w: BasicWord) => boolean) => data.words.filter(t).length;
  const groups = BASIC_GROUPS.map((g) => `${g.name}（${count(g.test)}語${g.about ? `：${g.about}` : ''}）`).join('／');
  const cats = [...new Set(data.words.map((w) => w.category))].map((c) => `${c}（${count((w) => w.category === c)}）`).join('／');
  const pos = [...new Set(data.words.map((w) => w.pos))].join('・');
  return `まとまり：${groups}\n分類：${cats}\n品詞：${pos}\n学年の目安：小学校・中1・中2\n不規則動詞の変化のテスト：${data.verbs.length}語`;
}

type Result = { ok: true; value: WordQuiz } | { ok: false; message: string };

export function buildBasicQuiz(data: BasicData, o: BasicQuizOptions): Result {
  const random = o.random ?? Math.random;
  const levels: BasicLevel[] = [];
  for (const s of o.levels ?? []) {
    if (!String(s).trim()) continue;
    const l = findLevel(String(s));
    if (!l) return { ok: false, message: `学年の目安「${s}」がありません。小学校・中1・中2 から選びます。` };
    if (!levels.includes(l)) levels.push(l);
  }
  const levelOk = (l: BasicLevel) => !levels.length || levels.includes(l);
  const levelLabel = levels.length ? LEVELS.filter((l) => levels.includes(l)).join('・') : '';

  let base: (BasicWord | IrregularVerb)[];
  let range: string;
  let source: 'words' | 'verbs';
  if (o.kind === 'verbs') {
    source = 'verbs';
    base = data.verbs.filter((v) => levelOk(v.level));
    range = `不規則動詞${levelLabel ? `（${levelLabel}）` : ''}`;
    if (!base.length) return { ok: false, message: `${range}の動詞がありません。` };
  } else {
    source = 'words';
    const labels: string[] = [];
    const tests: ((w: BasicWord) => boolean)[] = [];
    for (const s of o.categories ?? []) {
      if (!String(s).trim()) continue;
      const c = findCategory(data.words, String(s));
      if (!c) return { ok: false, message: `分類「${s}」がありません。選べるもの：\n${basicCategoryList(data)}` };
      if (!labels.includes(c.label)) { labels.push(c.label); tests.push(c.test); }
    }
    const posList = (o.pos ?? []).map((x) => String(x).trim()).filter(Boolean);
    const allPos = new Set(data.words.map((w) => w.pos));
    for (const p of posList) if (!allPos.has(p)) return { ok: false, message: `品詞「${p}」がありません。品詞：${[...allPos].join('・')}` };
    let words = data.words.filter((w) => levelOk(w.level) && (!tests.length || tests.some((t) => t(w))) && (!posList.length || posList.includes(w.pos)));
    words = uniqueWords(words);
    const parts = [...labels, ...posList, ...(levelLabel ? [levelLabel] : [])];
    range = `基本単語${parts.length ? `（${parts.join('・')}）` : ''}`;
    if (!words.length) return { ok: false, message: `${range}に当てはまる語がありません。` };
    base = words;
  }

  const available = base.length;
  const max = MAX_COUNT[source];
  const want = typeof o.count === 'number' && o.count >= 1 ? Math.min(Math.floor(o.count), available, max) : Math.min(available, max);
  const order = o.order === 'random' ? 'random' : 'book';
  let picked: (BasicWord | IrregularVerb)[];
  if (want >= available) picked = base;
  else if (order === 'random') picked = shuffle(base, random).slice(0, want);
  else picked = Array.from({ length: want }, (_, i) => base[Math.floor((i * available) / want)]);
  if (order === 'book') picked = base.filter((x) => picked.includes(x));

  const direction: Direction = o.direction === 'en-ja' || o.direction === 'mix' ? o.direction : 'ja-en';
  const ask: VerbAsk = o.verbAsk === 'past' || o.verbAsk === 'all' ? o.verbAsk : 'past-pp';
  const qs: QuizQ[] = picked.map((x, i) => {
    if (source === 'verbs') {
      const v = x as IrregularVerb;
      return { kind: 'verb', ja: v.ja, base: v.base, past: v.past, pp: v.pp, ask, ...(v.note ? { note: v.note } : {}) };
    }
    const w = x as BasicWord;
    const toEn = direction === 'ja-en' || (direction === 'mix' && i % 2 === 0);
    return { kind: 'word', prompt: toEn ? w.ja : w.en, answer: toEn ? w.en : w.ja, toEn, star: false };
  });
  const nVersions = Math.max(1, Math.min(3, Math.floor(o.versions ?? 1)));
  const versions = Array.from({ length: nVersions }, (_, v) => ({
    label: nVersions > 1 ? 'ABC'[v] : '',
    questions: order === 'book' && v === 0 ? qs : shuffle(qs, random),
  }));
  const kind = source === 'verbs' ? '不規則動詞テスト' : '単語テスト';
  const title = (o.title ?? '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 40) || `英語 ${range} ${kind}`;
  return { ok: true, value: { title, range, source, versions, available } };
}
