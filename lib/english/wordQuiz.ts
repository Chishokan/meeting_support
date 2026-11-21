// 英語の単語テスト：範囲（学年・Unit・区分）と出し方から、元データ（lib/english/data）の問題を選ぶ。ほかに依存しない。
// 問題と答えは元データのまま使い、AI は書かない（答えの誤りを入れないため）。Word にするのは wordQuizDoc.ts。

// 元データ（lib/english/data）は呼ぶ側が渡す（books.ts の BOOKS）。この中で読み込まないのは、テスト（node --test）で読み込めるようにするため。
import type { Book, KwtItem, Section, Unit, Word } from './data/types';

export type Source = 'words' | 'kwt';
export type Direction = 'ja-en' | 'en-ja' | 'mix';

/** 1問（Word に入れる形）。 */
export type QuizQ =
  | { kind: 'word'; prompt: string; answer: string; /** 日本語を見て英語を書く */ toEn: boolean; star: boolean }
  | { kind: 'kwt'; ja: string; en: string; note?: string };

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
export const PER_SHEET = { words: 40, kwt: 12 } as const;
export const MAX_COUNT = { words: 120, kwt: 36 } as const;

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s,，・、'’]/g, '').replace(/[〜~]/g, '-');

export function findBook(books: Book[], grade: string): Book | undefined {
  const g = grade.normalize('NFKC').replace(/\s/g, '').replace(/^中学?/, '中').replace(/年生?$/, '');
  const key = /^[123]$/.test(g) ? `中${g}` : g;
  return books.find((b) => b.grade === key);
}

export function findUnit(book: Book, unit: string): Unit | undefined {
  const u = norm(unit).replace(/^unit/, '');
  return book.units.find((x) => norm(x.unit) === u);
}

/** 区分の名前を探す（「part1」「Part 1」「Let's Talk 1」などの揺れを許す。「Part3」で「Part3, T&S」も当てる）。 */
export function findSection(unit: Unit, name: string): Section | undefined {
  const n = norm(name);
  return unit.sections.find((s) => norm(s.id) === n) ?? unit.sections.find((s) => norm(s.id).startsWith(n) && n.length >= 4);
}

/** 学年・Unit・区分の一覧（AI と職員に見せる）。 */
export function rangeList(books: Book[]): string {
  const lines: string[] = [];
  for (const b of books) {
    for (const u of b.units) {
      lines.push(`- ${b.grade} Unit${u.unit}「${u.title}」：${u.sections.map((s) => `${s.id}（${s.words.length}語${s.words.some((w) => w.star) ? `・☆${s.words.filter((w) => w.star).length}` : ''}${s.kwt.length ? `・KWT${s.kwt.length}問` : ''}）`).join('／')}`);
    }
  }
  return lines.join('\n');
}

function shuffle<T>(a: T[], random: () => number): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 同じ語（英語が同じ）は、最初に出た区分の1つだけにする。 */
function uniqueWords(words: Word[]): Word[] {
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
  if (!unit) return { ok: false, message: `${book.grade}の Unit「${o.unit}」の元データがまだありません。入っている範囲：\n${rangeList(books)}` };
  const names = (o.sections ?? []).map((s) => String(s).trim()).filter(Boolean);
  const sections: Section[] = [];
  for (const n of names) {
    const s = findSection(unit, n);
    if (!s) return { ok: false, message: `${book.grade} Unit${unit.unit} に区分「${n}」がありません。区分：${unit.sections.map((x) => x.id).join('／')}` };
    if (!sections.includes(s)) sections.push(s);
  }
  if (!sections.length) sections.push(...unit.sections);
  const source: Source = o.source === 'kwt' ? 'kwt' : 'words';
  const direction: Direction = o.direction === 'en-ja' || o.direction === 'mix' ? o.direction : 'ja-en';
  const range = `${book.grade} Unit${unit.unit}${names.length ? `（${sections.map((s) => s.id).join('・')}）` : ''}`;

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
