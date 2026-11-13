// 智翔館AI：数学の小テスト（1枚に5〜10問が並ぶ B5 のプリント）を Word にする道具の定義と、入力の確かめ。ほかに依存しない。
// Word を組むのは mathQuizDoc.ts、保存は mathMaterial.ts（runCreateMathQuiz）。書式は knowledge/37_教材制作/数学/41_小テストの書式.md。

import type Anthropic from '@anthropic-ai/sdk';
import type { Side } from './mathMaterialTool';

const SIDE_SCHEMA = {
  type: 'object',
  description: '問題文の右に置く図か表（label は「図」「表」など。省いてよい）',
  properties: {
    label: { type: 'string' },
    figure: { type: 'object', description: '図の記述（```図 の枠と同じ JSON。37_教材制作/数学/30_図の書き方.md）' },
    table: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '表（1行目が見出し）' },
  },
};

export const MATH_QUIZ_TOOL: Anthropic.Tool = {
  name: 'create_math_quiz',
  description:
    '数学の小テスト（B5縦・1枚に5〜10問、□(1)のチェック欄つき、右は計算と答えの余白、上に「No.」と氏名の枠）を Word にして、ドライブに保存する。' +
    '「小テスト」と「答え入り」（右の余白に赤で答え）の2つのファイルができる。何枚かまとめて作れる（No. が続く）。' +
    '職員が小テストを「ファイルにして」「Word で」「印刷できる形で」と頼んだときだけ使う。番号（□(1)・□1）はアプリが付けるので、文には書かない。' +
    '数式は $ … $ の中に書く（分数 \\frac{1}{2}、根号 \\sqrt{3}、累乗 x^2、×は \\times）。',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'ファイル名（例：中1 正負の数 小テスト）。40字まで' },
      series: { type: 'string', description: '各枚の上の題名（No. の前）。省くと「志望校合格にむけて　ベーシック」' },
      start_no: { type: 'number', description: '1枚目の No.（省くと1）' },
      sheets: {
        type: 'array',
        description: '小テストの枚（1枚に問題5〜10問）。上から No. が続く',
        items: {
          type: 'object',
          properties: {
            sections: {
              type: 'array',
              description: '枚の中のまとまり。見出し（例：次の計算をしなさい。）があると□1 □2 …が付き、問題の番号は(1)からふり直す。見出しが要らなければ1つだけにして heading を省く',
              items: {
                type: 'object',
                properties: {
                  heading: { type: 'string' },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        text: { type: 'string', description: '問題の文（番号は書かない）' },
                        sub: { type: 'array', items: { type: 'string' }, description: '問題の中の小問（□①□②…が付く）' },
                        side: SIDE_SCHEMA,
                        frequent: { type: 'boolean', description: '「よく出る」の印を付ける（長崎県の入試でよく出る型だけ）' },
                        answer: { type: 'string', description: '答え（答え入りの版に赤で入る。小問があれば「① … ② …」）' },
                      },
                      required: ['text', 'answer'],
                    },
                  },
                },
                required: ['items'],
              },
            },
          },
          required: ['sections'],
        },
      },
    },
    required: ['title', 'sheets'],
  } as unknown as Anthropic.Tool.InputSchema,
};

export type QuizItem = { text: string; sub: string[]; side?: Side; frequent: boolean; answer: string };
export type QuizSection = { heading: string; items: QuizItem[] };
export type MathQuiz = { title: string; series: string; startNo: number; sheets: { sections: QuizSection[] }[] };

export const DEFAULT_SERIES = '志望校合格にむけて　ベーシック';
const LIMITS = { sheets: 10, sections: 4, items: 12, sub: 6, text: 600, answer: 200, rows: 10, cols: 6 };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function side(v: unknown): Side | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const label = str(o.label, 12) || undefined;
  if (o.figure && typeof o.figure === 'object') return { label, figure: o.figure };
  if (Array.isArray(o.table)) {
    const rows = o.table.slice(0, LIMITS.rows).map((r) => (Array.isArray(r) ? r.slice(0, LIMITS.cols).map((c) => str(c, 40)) : [])).filter((r) => r.length);
    if (rows.length) return { label, table: rows };
  }
  return undefined;
}

/** 入力を確かめて、足りないものは既定で埋める。直せない形なら理由を返す（AI に直してもらう）。 */
export function checkMathQuizInput(input: unknown): { ok: true; value: MathQuiz } | { ok: false; message: string } {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const title = str(o.title, 40).replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim();
  if (!title) return { ok: false, message: 'title（ファイル名）がありません。' };
  const rawSheets = Array.isArray(o.sheets) ? o.sheets : [];
  if (!rawSheets.length) return { ok: false, message: 'sheets（小テストの枚）がありません。' };
  if (rawSheets.length > LIMITS.sheets) return { ok: false, message: `小テストは1回に${LIMITS.sheets}枚までです。` };
  const sheets: { sections: QuizSection[] }[] = [];
  for (let s = 0; s < rawSheets.length; s++) {
    const rs = (rawSheets[s] ?? {}) as Record<string, unknown>;
    const rawSections = (Array.isArray(rs.sections) ? rs.sections : []).slice(0, LIMITS.sections);
    const sections: QuizSection[] = rawSections
      .map((x) => {
        const r = (x ?? {}) as Record<string, unknown>;
        const items = (Array.isArray(r.items) ? r.items : [])
          .map((it) => {
            const i = (it ?? {}) as Record<string, unknown>;
            return {
              text: str(i.text, LIMITS.text),
              sub: (Array.isArray(i.sub) ? i.sub : []).map((t) => str(t, LIMITS.text)).filter(Boolean).slice(0, LIMITS.sub),
              side: side(i.side),
              frequent: i.frequent === true,
              answer: str(i.answer, LIMITS.answer),
            };
          })
          .filter((i) => i.text);
        return { heading: str(r.heading, 80), items };
      })
      .filter((x) => x.items.length);
    const count = sections.reduce((n, x) => n + x.items.length, 0);
    if (!count) return { ok: false, message: `${s + 1}枚目に問題がありません。` };
    if (count > LIMITS.items) return { ok: false, message: `1枚の問題は${LIMITS.items}問までです（${s + 1}枚目が${count}問）。枚を分けてください。` };
    sheets.push({ sections });
  }
  const startNo = typeof o.start_no === 'number' && o.start_no >= 1 && o.start_no < 1000 ? Math.floor(o.start_no) : 1;
  return { ok: true, value: { title, series: str(o.series, 40) || DEFAULT_SERIES, startNo, sheets } };
}
