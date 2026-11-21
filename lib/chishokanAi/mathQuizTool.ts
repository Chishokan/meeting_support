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
    '作業「数学の問題を作る」の小テストで問題と答えが決まったら使う（「チャットだけで」と言われたら使わない）。番号（□(1)・□1）はアプリが付けるので、文には書かない。' +
    '1枚に入る量の目安：図の無い計算8〜10問、文章題5〜6問、図のある問題3〜4問。1枚に収まらないときは作らずに理由を返すので、減らすか sheets を分けて呼び直す。' +
    '角を求める図は、求める角と分かっている角に angle で印と label を付ける（無いと作らずに返す）。直線の名前は line の label（"l" は ℓ）。' +
    '数式は $ … $ の中に書く（分数 \\frac{1}{2}、根号 \\sqrt{3}、累乗 x^2、×は \\times）。' +
    '小学校・中学校の小テストでは、高校で習う書き方・方法（点と傾きの式、絶対値の記号 | |、f(x)、三角比 など）を使わない（見つかると作らずに理由を返す）。',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'ファイル名（例：中1 正負の数 小テスト）。40字まで' },
      level: { type: 'string', enum: ['小学校', '中学校', '高校'], description: '対象の学校。高校の小テストのときだけ「高校」。省くと題名から決める' },
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
export type MathQuiz = {
  title: string;
  series: string;
  startNo: number;
  sheets: { sections: QuizSection[] }[];
  /** 対象の学校（小学校・中学校・高校）。省くと題名から決める（mathScope.ts） */
  level?: string;
};

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

/**
 * 図のある角の問題を確かめる（2026-11-16：図に角の印が無く、分かっている角の大きさも無い小テストができた）。
 * - 決まった角を求める問題（∠x・角の大きさ）なのに、図に angle（角の印）が1つも無い
 * - 問題文で名前を出した角（∠x・∠a）に、図の angle の label が無い
 * - ∠ で角を指す問題で、分かっている角の大きさ（70° など）が、問題文にも図にも無い（「和」を求める問題は除く）
 * 直してほしいことを返す（問題が無ければ null）。
 */
export function checkAngleFigure(text: string, figure: unknown): string | null {
  // 決まった角を求める問題だけを見る（「三角形の面積」「内角の和」は対象外）
  const named = /∠|\\angle/.test(text);
  if (!named && !/角の大きさ|角\s*\$?[a-z](?![a-z])/.test(text)) return null;
  const f = (figure && typeof figure === 'object' ? figure : {}) as Record<string, unknown>;
  const shapes = (Array.isArray(f.shapes) ? f.shapes : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  const angles = shapes.filter((x) => 'angle' in x);
  const norm = (v: unknown) => (typeof v === 'string' ? v.replace(/[$∠\s]|\\angle/g, '') : '');
  const angleLabels = angles.map((x) => norm(x.label)).filter(Boolean);
  const allLabels = shapes.map((x) => norm(x.label)).filter(Boolean);
  if (!angles.length) {
    return '図に角の印がありません。求める角（x など）と分かっている角（70° など）に、{"angle": ["A","B","C"], "label": "x"} で印を付けてください（真ん中が頂点。label は印の内側に書かれる）。';
  }
  for (const m of text.matchAll(/(?:∠|\\angle)\s*([a-z])(?![a-z])/g)) {
    if (!angleLabels.includes(m[1])) {
      return `問題文の ∠${m[1]} が、図のどの角か分かりません。図のその角に {"angle": […], "label": "${m[1]}"} で印を付けてください。`;
    }
  }
  const hasDegree = (v: string) => /\d+(?:\.\d+)?\s*(?:°|\^\{?\\circ\}?|度)/.test(v);
  if (named && !/和/.test(text) && !hasDegree(text) && !allLabels.some(hasDegree)) {
    return '分かっている角の大きさ（70° など）が、問題文にも図にもありません。答えが1つに決まるよう、問題文か図の angle の label に書いてください。';
  }
  return null;
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
    for (const sec of sections) {
      for (let k = 0; k < sec.items.length; k++) {
        const it = sec.items[k];
        const bad = it.side?.figure ? checkAngleFigure(it.text, it.side.figure) : null;
        if (bad) return { ok: false, message: `${s + 1}枚目${sec.heading ? `「${sec.heading.slice(0, 12)}」` : ''}の(${k + 1})：${bad}` };
      }
    }
    if (count > LIMITS.items) return { ok: false, message: `1枚の問題は${LIMITS.items}問までです（${s + 1}枚目が${count}問）。枚を分けてください。` };
    sheets.push({ sections });
  }
  const startNo = typeof o.start_no === 'number' && o.start_no >= 1 && o.start_no < 1000 ? Math.floor(o.start_no) : 1;
  const level = typeof o.level === 'string' && ['小学校', '中学校', '高校'].includes(o.level) ? o.level : undefined;
  return { ok: true, value: { title, series: str(o.series, 40) || DEFAULT_SERIES, startNo, sheets, level } };
}
