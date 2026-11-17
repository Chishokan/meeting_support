// 智翔館AI：小学校・中学校の数学の教材で、高校で習う書き方・方法を見つける。ほかに依存しない（テストしやすいように）。
//
// 2026-11-16：中3の模試の解答・解説に、高校で習う「点と傾きの式」（y－4＝3/2(x＋4)）と、
// 中学で習わない絶対値の記号（|10－t|）が出た（小中等部からの問い合わせ）。
// 教材の Word を作る道具（create_math_material・create_math_quiz）で、保存の前に確かめ、AI に中学の方法で書き直してもらう。
// 中学の書き方の決まりは knowledge/37_教材制作/数学/10_形式と表記.md の「中学の範囲で書く」。

import type { MathMaterial } from './mathMaterialTool';
import type { MathQuiz } from './mathQuizTool';

export type SchoolLevel = '小学校' | '中学校' | '高校';
export const SCHOOL_LEVELS: SchoolLevel[] = ['小学校', '中学校', '高校'];

/** 対象の学校。指定が無ければ題名から決める（「公立高校入試」は中学生向けなので、高校には数えない）。 */
export function schoolLevel(v: unknown, title: string): SchoolLevel {
  if (typeof v === 'string' && (SCHOOL_LEVELS as string[]).includes(v)) return v as SchoolLevel;
  return /高[1-3１-３]|高校[1-3１-３]年|高校生向け|数学\s*[ⅠⅡⅢIAB](?![a-zA-Z])|数[ⅠⅡⅢ]|大学入試|共通テスト/.test(title) ? '高校' : '中学校';
}

type Rule = { what: string; test: (s: string) => boolean };

/** 比べやすい形にする（全角の記号・空白をそろえる）。 */
function norm(s: string): string {
  return s
    .replace(/[－−–—]/g, '-')
    .replace(/＋/g, '+')
    .replace(/＝/g, '=')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[ｘ]/g, 'x')
    .replace(/[ｙ]/g, 'y')
    .replace(/\\left|\\right/g, '')
    .replace(/[\s　$]/g, '');
}

const RULES: Rule[] = [
  { what: '絶対値の記号（| |）', test: (s) => /[|｜]|\\[lr]?vert|\\mid/.test(s) },
  // y－4＝3/2(x＋4)、y－y₁＝m(x－x₁)、y－9＝－(x－6) など
  { what: '点と傾きの式（y－b＝a(x－c) の形）', test: (s) => /y-[^=]{1,30}=[^=]{0,40}\(x[-+][^)]{1,30}\)/.test(norm(s)) },
  { what: '関数の記号 f(x)', test: (s) => /(?<![a-zA-Z\\])[fg]\(x\)/.test(norm(s)) },
  { what: '三角比（sin・cos・tan）', test: (s) => /\\(?:sin|cos|tan)(?![a-z])|(?<![a-zA-Z])(?:sin|cos|tan)(?=[θ\dA-Z\\(])/.test(norm(s)) },
  { what: 'ベクトル', test: (s) => /\\vec|\\overrightarrow|ベクトル/.test(s) },
  { what: 'Σ・lim・log・∫', test: (s) => /\\sum|Σ|\\lim|\\log|\\int|∫|(?<![a-zA-Z])log(?![a-z])/.test(s) },
  { what: '判別式', test: (s) => /判別式/.test(s) },
  { what: '解と係数の関係', test: (s) => /解と係数/.test(s) },
  { what: '正弦定理・余弦定理', test: (s) => /正弦定理|余弦定理/.test(s) },
  { what: '内分・外分（の公式）', test: (s) => /内分|外分/.test(s) },
  { what: '点と直線の距離・2点間の距離の公式', test: (s) => /点と直線の距離|2点間の距離の公式|２点間の距離の公式/.test(s) },
  { what: '2直線の垂直の条件（傾きの積が－1）', test: (s) => /傾きの積|垂直条件/.test(s) },
  { what: '方べきの定理・接弦定理・メネラウス・チェバの定理', test: (s) => /方べき|接弦定理|メネラウス|チェバ/.test(s) },
  { what: '相加平均・相乗平均', test: (s) => /相加平均|相乗平均/.test(s) },
];

/** 文の中の、中学で習わない書き方・方法の名前（無ければ空）。 */
export function outOfScope(text: string): string[] {
  if (!text) return [];
  return RULES.filter((r) => r.test(text)).map((r) => r.what);
}

/** どこに何があったか（例：「大問3の解説：点と傾きの式」）をまとめ、書き直してもらう文にする。無ければ null。 */
export function scopeMessage(level: SchoolLevel, parts: { where: string; text: string }[]): string | null {
  if (level === '高校') return null;
  const found: string[] = [];
  for (const p of parts) {
    const w = outOfScope(p.text);
    if (w.length) found.push(`${p.where}：${w.join('・')}`);
    if (found.length >= 6) break;
  }
  if (!found.length) return null;
  return (
    `${level}の教材に、高校で習う書き方・方法があります（${found.join('／')}）。保存していません。中学の方法で書き直して、もう一度呼んでください。` +
    '直線の式は、傾き a を「yの増加量÷xの増加量」で求め、y＝ax＋b に通る点の座標を代入して b を求める（2点の座標を代入して連立方程式でもよい）。' +
    '平行な直線は「傾きが等しい」を使う。長さ・高さは「大きい方－小さい方」や「y軸からの距離」で書き、絶対値の記号 | | は使わない' +
    '（文字のときは、図から大小を決めて「15－t」のように書く）。関数は f(x) と書かず「y＝…」で書く。' +
    '高校の教材なら level に「高校」を入れる。'
  );
}

/** 教材（create_math_material）で確かめる文：大問ごとの問題・答え・解説。 */
export function materialScopeMessage(m: MathMaterial): string | null {
  return scopeMessage(schoolLevel(m.level, m.title), [
    ...m.problems.map((p, i) => ({ where: `大問${i + 1}の問題`, text: [p.intro, ...p.items.flatMap((it) => [it.text, ...it.sub])].join('\n') })),
    ...m.answers.map((a, i) => ({ where: `大問${i + 1}の答え`, text: a.join('\n') })),
    ...m.explanations.map((e, i) => ({ where: `大問${i + 1}の解説`, text: e })),
  ]);
}

/** 小テスト（create_math_quiz）で確かめる文：枚ごと・問題ごとの文と答え。 */
export function quizScopeMessage(q: MathQuiz): string | null {
  return scopeMessage(
    schoolLevel(q.level, q.title),
    q.sheets.flatMap((sh, s) =>
      sh.sections.flatMap((sec) => sec.items.map((it, k) => ({ where: `${s + 1}枚目の(${k + 1})`, text: [sec.heading, it.text, ...it.sub, it.answer].join('\n') }))),
    ),
  );
}
