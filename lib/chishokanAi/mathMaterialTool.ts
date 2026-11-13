// 智翔館AI：数学の教材を、社内の仕上がりの書式（B4・ＭＳ明朝・大問の番号を□で囲む・図は右の列）の Word にする道具の定義と、入力の確かめ。
// ほかに依存しない（テストしやすいように）。Word を組むのは mathDoc.ts、保存は mathMaterial.ts。
// 書式の決まりは knowledge/37_教材制作/数学/40_仕上がりの書式.md。

import type Anthropic from '@anthropic-ai/sdk';

/** 右の列に置く図か表。 */
const SIDE_SCHEMA = {
  type: 'object',
  description: '右の列に置く図か表。label は「図１」「表」など（省くと図は図１、図２…と付ける）',
  properties: {
    label: { type: 'string' },
    figure: { type: 'object', description: '図の記述（```図 の枠と同じ JSON。37_教材制作/数学/30_図の書き方.md）' },
    table: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '表（1行目が見出し）' },
  },
};

export const MATH_MATERIAL_TOOL: Anthropic.Tool = {
  name: 'create_math_material',
  description:
    '数学の教材を、社内の仕上がりの書式（B4縦・ＭＳ明朝・大問の番号を□で囲む・小問は（１）か「問１」・図と表は問題文の右）の Word ファイルにして、ドライブに保存する。' +
    '「問題」と「解答・解説」の2つのファイルができる。職員が「ファイルにして」「Word で」「印刷できる形で」と頼んだときだけ使う。' +
    '番号（□1・（１）・問１）はアプリが付けるので、文には書かない。数式は $ … $ の中に書く（分数 \\frac{1}{2}、根号 \\sqrt{3}、累乗 x^2、×は \\times、πは \\pi）。',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'ファイル名と解答の題名（例：中3 関数 思考力問題 第1回）。40字まで' },
      booklet: {
        type: 'boolean',
        description: '模試の形にする（表紙〔受験番号・題名・時間・注意〕と「問題」の扉を付ける）。「模試の形で」「表紙を付けて」と頼まれたときだけ true',
      },
      cover: {
        type: 'object',
        description: 'booklet のときの表紙。省くと title と 50分',
        properties: {
          name: { type: 'string', description: '表紙の題名（例：長崎県統一模試 233号）' },
          minutes: { type: 'number', description: '試験時間（分）' },
        },
      },
      problems: {
        type: 'array',
        description: '大問（上から順に □1 □2 …）。大問ごとに新しいページから始まる',
        items: {
          type: 'object',
          properties: {
            intro: { type: 'string', description: '大問の頭の文（例：次の（１）～（10）に答えなさい。／図１のように、…。次の問いに答えなさい。）' },
            numbering: {
              type: 'string',
              enum: ['kakko', 'toi'],
              description: '小問の番号。kakko＝（１）（２）…（計算などの小問集合）、toi＝問１ 問２ …（ふつうの大問。既定）',
            },
            side: { type: 'array', description: '大問全体にかかる図・表。問題文の右の列に上から並べる', items: SIDE_SCHEMA },
            items: {
              type: 'array',
              description: '小問（上から順に番号が付く）',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: '小問の文（番号は書かない）' },
                  sub: { type: 'array', items: { type: 'string' }, description: '小問の中の細かい問い（（１）（２）…が付く。toi のときだけ）' },
                  side: SIDE_SCHEMA,
                },
                required: ['text'],
              },
            },
          },
          required: ['items'],
        },
      },
      answers: {
        type: 'array',
        description: '大問ごとの答え（problems と同じ順・同じ数）。items は小問の順の答え（細かい問いは「（１）…（２）…」のように1つにまとめる）',
        items: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] },
      },
      explanations: {
        type: 'array',
        description: '大問ごとの解説（problems と同じ順）。text は途中の式を省かずに書く。段落は改行で分ける',
        items: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      },
    },
    required: ['title', 'problems', 'answers'],
  } as unknown as Anthropic.Tool.InputSchema,
};

export type Side = { label?: string; figure?: unknown; table?: string[][] };
export type MathItem = { text: string; sub: string[]; side?: Side };
export type MathProblem = { intro: string; numbering: 'kakko' | 'toi'; side: Side[]; items: MathItem[] };
export type MathMaterial = {
  title: string;
  booklet: boolean;
  cover: { name: string; minutes: number };
  problems: MathProblem[];
  answers: string[][];
  explanations: string[];
};

const LIMITS = { problems: 8, items: 12, sub: 6, side: 4, sides: 16, text: 1500, explanation: 6000, rows: 12, cols: 8 };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function side(v: unknown): Side | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const label = str(o.label, 12) || undefined;
  if (o.figure && typeof o.figure === 'object') return { label, figure: o.figure };
  if (Array.isArray(o.table)) {
    const rows = o.table.slice(0, LIMITS.rows).map((r) => (Array.isArray(r) ? r.slice(0, LIMITS.cols).map((c) => str(c, 60)) : [])).filter((r) => r.length);
    if (rows.length) return { label, table: rows };
  }
  return undefined;
}

/** 入力を確かめて、足りないものは既定で埋める。直せない形なら理由を返す（AI に直してもらう）。 */
export function checkMathMaterialInput(input: unknown): { ok: true; value: MathMaterial } | { ok: false; message: string } {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const title = str(o.title, 40).replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim();
  if (!title) return { ok: false, message: 'title（題名）がありません。' };
  const rawProblems = Array.isArray(o.problems) ? o.problems : [];
  if (!rawProblems.length) return { ok: false, message: 'problems（大問）がありません。' };
  if (rawProblems.length > LIMITS.problems) return { ok: false, message: `大問は${LIMITS.problems}題までです。` };
  let sides = 0;
  const problems: MathProblem[] = [];
  for (let p = 0; p < rawProblems.length; p++) {
    const r = (rawProblems[p] ?? {}) as Record<string, unknown>;
    const items = (Array.isArray(r.items) ? r.items : [])
      .map((it) => {
        const x = (it ?? {}) as Record<string, unknown>;
        return {
          text: str(x.text, LIMITS.text),
          sub: (Array.isArray(x.sub) ? x.sub : []).map((s) => str(s, LIMITS.text)).filter(Boolean).slice(0, LIMITS.sub),
          side: side(x.side),
        };
      })
      .filter((it) => it.text);
    if (!items.length) return { ok: false, message: `大問${p + 1}に小問（items）がありません。` };
    if (items.length > LIMITS.items) return { ok: false, message: `大問${p + 1}の小問は${LIMITS.items}問までです。` };
    const ps = (Array.isArray(r.side) ? r.side : []).map(side).filter((s): s is Side => !!s).slice(0, LIMITS.side);
    sides += ps.length + items.filter((it) => it.side).length;
    problems.push({ intro: str(r.intro, LIMITS.text), numbering: r.numbering === 'kakko' ? 'kakko' : 'toi', side: ps, items });
  }
  if (sides > LIMITS.sides) return { ok: false, message: `図と表は合わせて${LIMITS.sides}個までです。` };
  const rawAnswers = Array.isArray(o.answers) ? o.answers : [];
  const answers = problems.map((_, p) => {
    const a = (rawAnswers[p] ?? {}) as Record<string, unknown>;
    return (Array.isArray(a.items) ? a.items : []).map((s) => str(s, 400));
  });
  if (answers.every((a) => !a.length)) return { ok: false, message: 'answers（答え）がありません。大問ごとに、小問の順で答えを入れてください。' };
  const rawEx = Array.isArray(o.explanations) ? o.explanations : [];
  const explanations = problems.map((_, p) => str((rawEx[p] as Record<string, unknown> | undefined)?.text, LIMITS.explanation));
  const cover = (o.cover && typeof o.cover === 'object' ? o.cover : {}) as Record<string, unknown>;
  const minutes = typeof cover.minutes === 'number' && cover.minutes > 0 && cover.minutes <= 180 ? Math.round(cover.minutes) : 50;
  return {
    ok: true,
    value: { title, booklet: o.booklet === true, cover: { name: str(cover.name, 40) || title, minutes }, problems, answers, explanations },
  };
}
