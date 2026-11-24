// 本番レベル模試の問題を、前に県全体で実施したときの集計（過去の実施データ）。
// 本番レベル模試は智翔館の塾生だけが受けるが、問題は前に長崎県統一模試として県全体で実施したものなので、そのときの
// 全県の平均点・標準偏差・度数分布・設問別の平均正答率を借りて、偏差値・県内のおよその順位・設問別の県平均を出す。
// 「模試の設定」の［この実施データを使う］で回の設定（outside.ref）に結ぶ。
//
// 出典：長崎県統一模試 中学3年 秋期模試（2023年10月実施。主催・長崎学習塾協会）
//   ・全県の平均点・標準偏差（得点順の一覧の上の表）と、所属内（その年の智翔館）の平均点：帳票（紙）から読み取った
//   ・度数分布（五教科25点・三教科15点・教科5点きざみ。教科ごとの人数は欠席などで少し違う）：帳票の度数分布表から読み取り、
//     スプレッドシート「2024三高高専本番レベル模試入力シート」の「202310月データ」タブと同じ値であることを確かめた
//     （そのタブの三教科の列は五教科の人数の写しになっているので、三教科は帳票の値を使う。三教科の標準偏差もタブの 49.9 ではなく帳票の 48.6）
//   ・設問別の平均の得点率：同じスプレッドシートの「成績表 のコピー」タブの「平均」（2024年の本番レベル模試の成績表。
//     本番レベル模試の大問の並びに合わせてある）。英語4の配点はタブでは33だが、合計が100点になる 32 にした
//   生徒ごとの行（氏名・得点）は読んでいない。読み取りは、度数分布から出した平均点・標準偏差が帳票の値と合うことで確かめた（テスト）。
// ★別の年の問題を使う回が来たら、PAST_EXAMS に1つ足す。
//
// ★テストからも読めるよう、ここには import を置かない（型だけ）。

import type { StatKey, SubjectKey } from './model';

export type PastQuestion = {
  no: string;    // 大問の番号（「1」、まとめた行は「1・2」）
  label: string; // 出題内容
  max: number;   // 配点
  rate: number;  // 全県の平均の得点率（%）
};

export type PastExam = {
  id: string;
  label: string;    // 例「長崎県統一模試 秋期模試 2023年10月」
  held: string;     // 実施した年月（YYYY-MM）
  organizer: string;
  mean: Record<StatKey, number>;     // 全県の平均点
  sd: Record<StatKey, number>;       // 全県の標準偏差
  ownMean: Record<StatKey, number>;  // 所属内（その年の智翔館）の平均点
  step: Record<StatKey, number>;     // 度数分布のきざみ（いちばん下だけ 0〜step、あとは step×k+1〜step×(k+1)）
  bins: Record<StatKey, number[]>;   // 度数分布の人数（低い点から）
  questions: Record<SubjectKey, PastQuestion[]>;
  questionsSource: string; // 設問別の平均の出どころ（画面の注に出す）
};

// 度数分布表の人数は帳票と同じ「高い点から」の並びで書き、下で低い点からに並べかえる
const HIGH_FIRST: Record<StatKey, number[]> = {
  //   96〜100 91〜95 … 6〜10 0〜5
  ja: [0, 6, 16, 37, 52, 67, 86, 67, 77, 87, 68, 56, 50, 45, 25, 24, 17, 7, 4, 1],
  en: [12, 31, 31, 33, 47, 52, 64, 58, 60, 62, 48, 56, 53, 51, 55, 39, 30, 9, 2, 0],
  ma: [0, 0, 0, 1, 1, 5, 14, 19, 37, 65, 74, 99, 114, 78, 83, 69, 53, 38, 29, 10],
  so: [1, 2, 7, 21, 37, 53, 71, 80, 61, 87, 80, 69, 56, 65, 46, 28, 13, 8, 2, 0],
  sc: [0, 3, 10, 14, 25, 45, 33, 57, 55, 77, 71, 76, 82, 86, 58, 45, 31, 11, 8, 0],
  //   286〜300 … 16〜30 0〜15
  k3: [0, 0, 3, 8, 22, 42, 64, 66, 78, 106, 71, 88, 69, 51, 47, 50, 19, 7, 2, 0],
  //   476〜500 … 26〜50 0〜25
  k5: [0, 0, 2, 12, 23, 43, 41, 87, 84, 79, 103, 80, 63, 72, 44, 31, 22, 6, 1, 0],
};
const lowFirst = (m: Record<StatKey, number[]>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].reverse()])) as Record<StatKey, number[]>;

export const PAST_EXAMS: PastExam[] = [
  {
    id: 'shuki-2023-10',
    label: '長崎県統一模試 秋期模試 2023年10月',
    held: '2023-10',
    organizer: '長崎学習塾協会',
    mean: { ja: 55.4, en: 54.5, ma: 36.3, so: 51.8, sc: 46.7, k3: 145.9, k5: 244.8 },
    sd: { ja: 18.2, en: 21.7, ma: 15.0, so: 17.2, sc: 18.0, k3: 48.6, k5: 79.3 },
    ownMean: { ja: 54.8, en: 53.4, ma: 35.1, so: 50.6, sc: 44.6, k3: 143.2, k5: 238.3 },
    step: { ja: 5, en: 5, ma: 5, so: 5, sc: 5, k3: 15, k5: 25 },
    bins: lowFirst(HIGH_FIRST),
    questions: {
      ja: [
        { no: '1', label: '文学的文章の読解', max: 31, rate: 59 },
        { no: '2', label: '古文の読解', max: 17, rate: 44 },
        { no: '3', label: '説明的文章の読解', max: 34, rate: 55 },
        { no: '4', label: '資料の読みとり', max: 18, rate: 60 },
      ],
      en: [
        { no: '1', label: '聞き取りテスト', max: 27, rate: 65 },
        { no: '2', label: '対話文', max: 30, rate: 61 },
        { no: '3', label: '英作文', max: 11, rate: 53 },
        { no: '4', label: '長文読解', max: 32, rate: 40 },
      ],
      ma: [
        { no: '1', label: '小問集合（計算）', max: 30, rate: 60 },
        { no: '2', label: '資料の整理、確率', max: 14, rate: 42 },
        { no: '3', label: '2次関数のグラフ', max: 15, rate: 35 },
        { no: '4', label: '平面・空間融合問題', max: 16, rate: 22 },
        { no: '5', label: '平面図形', max: 13, rate: 22 },
        { no: '6', label: '数学的思考力を問う問題', max: 12, rate: 8 },
      ],
      so: [
        { no: '1', label: '江戸時代までの歴史', max: 23, rate: 48 },
        { no: '2', label: '明治からの歴史', max: 19, rate: 47 },
        { no: '3', label: '日本地理', max: 24, rate: 50 },
        { no: '4', label: '現代社会', max: 17, rate: 53 },
        { no: '5', label: '憲法と人権', max: 17, rate: 50 },
      ],
      sc: [
        { no: '1', label: '生物の分類', max: 15, rate: 67 },
        { no: '2', label: '力とばね', max: 15, rate: 42 },
        { no: '3', label: '物質の性質', max: 19, rate: 56 },
        { no: '4', label: '火山と火成岩', max: 18, rate: 57 },
        { no: '5', label: '電流と磁界', max: 18, rate: 44 },
        { no: '6', label: '気体の性質', max: 15, rate: 46 },
      ],
    },
    questionsSource: '2024年の本番レベル模試の成績表の平均',
  },
];

export function pastExamById(id: string | null | undefined): PastExam | undefined {
  return id ? PAST_EXAMS.find((p) => p.id === id) : undefined;
}

/** その教科（五教科・三教科）の人数＝度数分布の合計。 */
export function pastN(p: PastExam, key: StatKey): number {
  return p.bins[key].reduce((a, n) => a + n, 0);
}

/** 満点（度数分布のいちばん上の階級の上端）。 */
export function pastMax(p: PastExam, key: StatKey): number {
  return p.step[key] * p.bins[key].length;
}

/** 得点が入る階級（低い点から 0, 1, …）。いちばん下の階級だけ 0〜step（ほかは step×k+1〜step×(k+1)）。 */
export function pastBinOf(step: number, score: number): number {
  return score <= step ? 0 : Math.ceil(score / step) - 1;
}

/** 階級の範囲（下端・上端。どちらも含む）。 */
export function pastBinRange(step: number, i: number): [number, number] {
  return [i === 0 ? 0 : step * i + 1, step * (i + 1)];
}

/**
 * 県内のおよその順位：その得点より上の人数＋1。同じ階級の中の人数は、となりの階級の人数に合わせて
 * 階級の下の端から上の端へなだらかに増える（減る）とみて数える（均等に散らばるとみるより、帳票の県内順位に近い）。
 * 満点が違う（回の設定が100点・300点・500点でない）ときや得点が無いときは null。
 */
export function pastRank(p: PastExam, key: StatKey, score: number | null | undefined, max?: number): { rank: number; n: number } | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (max != null && max !== pastMax(p, key)) return null;
  const step = p.step[key];
  const bins = p.bins[key];
  const i = Math.min(bins.length - 1, Math.max(0, pastBinOf(step, score)));
  const [lo, hi] = pastBinRange(step, i);
  let above = 0;
  for (let j = i + 1; j < bins.length; j++) above += bins[j];
  // 階級の中を連続とみる（下の端 lo-0.5 〜 上の端 hi+0.5）。密度は下の端で (前の階級＋この階級)/2、上の端で (この階級＋次の階級)/2
  const w = hi - lo + 1;
  const dl = ((bins[i - 1] ?? 0) + bins[i]) / 2;
  const dh = (bins[i] + (bins[i + 1] ?? 0)) / 2;
  const t = Math.min(w, Math.max(0, score + 0.5 - (lo - 0.5))); // 階級の下の端から本人の得点の上の端まで
  const total = dl * w + ((dh - dl) * w) / 2;
  const upper = dl * (w - t) + ((dh - dl) * (w * w - t * t)) / (2 * w);
  const frac = total > 0 ? upper / total : (w - t) / w;
  above += bins[i] * Math.min(1, Math.max(0, frac));
  return { rank: Math.round(above) + 1, n: pastN(p, key) };
}

/**
 * 回の大問（配点の並び）と、過去の実施データの設問（の行）を結ぶ。回の大問を前から足していき、
 * 実施データの行の配点とちょうど合えばその行に入れる（社会の「1・2」のように、2つの大問が1行になっていてもよい）。
 * 戻り値：実施データの行ごとの、回の大問の番号（0 から）の並び。合わなければ null（大問の数か配点が違う＝別の問題）。
 */
export function matchPastQuestions(examMaxes: number[], past: PastQuestion[]): number[][] | null {
  const out: number[][] = [];
  let i = 0;
  for (const q of past) {
    const group: number[] = [];
    let sum = 0;
    while (i < examMaxes.length && sum < q.max) { sum += examMaxes[i]; group.push(i); i++; }
    if (sum !== q.max || !group.length) return null;
    out.push(group);
  }
  return i === examMaxes.length ? out : null;
}

type SubjectsLike = { key: SubjectKey; questions: { max: number }[] }[];

/**
 * 回の大問が資料と合う教科。合わない教科は「問題が違う」とみて、資料（平均点・標準偏差・度数分布・設問別の平均）を使わず、
 * この回の結果（智翔館の受験者）だけで出す。三教科・五教科は、いつも資料の値を使う。
 */
export function pastSubjectsMatched(subjects: SubjectsLike, p: PastExam): Record<SubjectKey, boolean> {
  const out = {} as Record<SubjectKey, boolean>;
  for (const k of Object.keys(p.questions) as SubjectKey[]) {
    const qs = subjects.find((s) => s.key === k)?.questions ?? [];
    out[k] = matchPastQuestions(qs.map((q) => q.max), p.questions[k]) != null;
  }
  return out;
}

/** 資料を使う項目か（三教科・五教科はいつも使う。教科は大問が合うときだけ）。 */
export function pastUsesKey(subjects: SubjectsLike, p: PastExam, key: StatKey): boolean {
  if (key === 'k3' || key === 'k5') return true;
  return pastSubjectsMatched(subjects, p)[key] ?? false;
}

/**
 * 過去の実施データを結んだ回の、換算の平均点・標準偏差から、大問の合わない教科の値を外す
 * （外した教科は、成績表・面談の平均点・偏差値をこの回の結果で出す）。結んでいない回はそのまま返す。
 * 「模試の設定」で結ぶときと、読み込んだ回（前に結んで保存した回）の両方に使う。
 */
export function withPastRules<E extends { subjects: SubjectsLike; outside?: { ref?: string; mean: Partial<Record<StatKey, number | null>>; sd: Partial<Record<StatKey, number | null>> } }>(exam: E): E {
  const p = pastExamById(exam.outside?.ref);
  if (!p || !exam.outside) return exam;
  const ok = pastSubjectsMatched(exam.subjects, p);
  const drop = (Object.keys(ok) as SubjectKey[]).filter((k) => !ok[k]);
  if (!drop.some((k) => exam.outside!.mean[k] != null || exam.outside!.sd[k] != null)) return exam;
  const mean = { ...exam.outside.mean };
  const sd = { ...exam.outside.sd };
  for (const k of drop) { delete mean[k]; delete sd[k]; }
  return { ...exam, outside: { ...exam.outside, mean, sd } };
}
