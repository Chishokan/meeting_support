// 数学の小テストを、社内の小テストの書式の Word にする（「小テスト」と「答え入り」）。サーバ専用。
//
// 書式は、数学科の見本（志望校合格にむけて ベーシック No.1〜53、B5）に合わせる。決まりは knowledge/37_教材制作/数学/41_小テストの書式.md。
// - B5縦。上に「（題名）　No.○」、右に氏名の枠
// - 問題は「□(1)」（チェック欄つき）で縦に並べ、左の6割に書く。右の4割は計算と答えの余白（図・表もここ）
// - 見出しがあれば□で囲んだ番号と見出しを付け、問題の番号は(1)からふり直す。小問は「□①」
// - 下に「※やり直しは全て、訂正ノートに！提出期限は守ること。」と「智翔館・東進衛星予備校」
// - 答え入りの版は、右の余白に赤で答えを入れる
// - 1枚に収まるかを先に見積もり、はみ出すときは図を小さくする。それでも入らなければ、AI に問題を減らすか枚を分けるよう返す
//   （2026-11-16：10問に図2つで2ページになった小テストがあった）

import {
  AlignmentType, BorderStyle, Document, Footer, HeightRule, LineRuleType, Packer, PageBreak, Paragraph, Table, TableCell, TableLayoutType,
  TableRow, TabStopType, TextRun, VerticalAlign, WidthType,
  type IBorderOptions, type ParagraphChild,
} from 'docx';
import { boxedNumber, para, richRuns, sideBlocks, textRun, type FigureRenderer } from './mathDoc';
import type { MathQuiz, QuizItem, QuizSection } from './mathQuizTool';

const KYOKASHO = 'UD デジタル 教科書体 NK-R';
const FONT_KYOKASHO = { ascii: KYOKASHO, hAnsi: KYOKASHO, eastAsia: KYOKASHO, cs: KYOKASHO };
const MINCHO = 'ＭＳ 明朝';
const SIZE = 21; // 10.5pt
const RED = 'C00000';

const MM = 56.7;
const PAGE = { width: Math.round(182 * MM), height: Math.round(257 * MM) }; // B5 縦
const MARGIN = { top: Math.round(14 * MM), bottom: Math.round(12 * MM), left: Math.round(12 * MM), right: Math.round(10 * MM) };
const TEXT_W = PAGE.width - MARGIN.left - MARGIN.right;
const LEFT_W = Math.round(TEXT_W * 0.6); // 問題を書く幅
const RIGHT_W = TEXT_W - LEFT_W; // 計算と答えの余白（図・表）

// --- 1枚に収まるかの見積もり（mm）-----------------------------------------------
// 値は、LibreOffice で PDF にして確かめた目安（Word でもほぼ同じ）。少し余裕を見て、入る高さを小さめにしている。
const FIT = {
  /** 問題を置ける高さ（上の題名・氏名の枠と、下の注意を除く） */
  area: 186,
  line: 7.0, // 問題文1行（10.5pt・1.5行）
  answerLine: 5.0, // 右の答え1行（行間1）
  charsLeft: 21, // 問題文の1行の字数（全角）
  charsSub: 18, // 小問の1行の字数
  charsRight: 15, // 答えの1行の字数
  frac: 2.5, // 分数のある行は高くなる
  heading: 9, // 見出し（□1 次の計算をしなさい。）
  gap: 9, // 見出しのまとまりの間
  cellBottom: 3.5, // 問題の下の余白
  figAfter: 4.2, // 図の下の余白
};
/** 小テストの図の幅（mm）。はみ出すときは QUIZ_FIG_MIN_MM まで小さくする。 */
export const QUIZ_FIG_MAX_MM = 50;
const QUIZ_FIG_MIN_MM = 40; // これより小さくすると、角の印と文字が重なって読みにくい

/** 1枚に収まらないとき（AI に、問題を減らすか枚を分けてもらう）。 */
export class QuizOverflowError extends Error {}

function units(s: string): number {
  const t = s.replace(/\\[a-zA-Z]+/g, '').replace(/[{}$^_]/g, '');
  let n = 0;
  for (const ch of t) n += /[\u0000-\u00ff]/.test(ch) ? 0.55 : 1;
  return n;
}

function textMm(s: string, perLine: number, lineMm: number): number {
  let mm = 0;
  for (const l of s.split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
    mm += Math.max(1, Math.ceil(units(l) / perLine)) * lineMm + (/\\d?frac/.test(l) ? FIT.frac : 0);
  }
  return mm || lineMm;
}

/** 1問の高さの見積もり（mm）。figMm は右に置く図の高さ（図が無ければ null）。 */
export function itemHeightMm(it: QuizItem, figMm: number | null, withAnswers: boolean): number {
  let left = textMm(`${it.frequent ? 'よく出る　' : ''}${it.text}`, FIT.charsLeft, FIT.line);
  for (const sub of it.sub) left += 2.1 + textMm(sub, FIT.charsSub, FIT.line);
  let right = withAnswers ? textMm(`答　${it.answer || ''}`, FIT.charsRight, FIT.answerLine) : 0;
  if (figMm !== null) right += figMm + FIT.figAfter;
  else if (it.side?.table) right += (it.side.table.length + 1) * 6 + FIT.figAfter;
  const short = it.text.length <= 40 && !it.sub.length && !it.side;
  return Math.max(short ? 13 : 22, Math.max(left, right) + FIT.cellBottom);
}

/** 1枚の高さの見積もり（mm）。figMm(item) は、その問題の図の高さ（図が無ければ null）。 */
export function sheetHeightMm(sections: QuizSection[], figMm: (it: QuizItem) => number | null, withAnswers: boolean): number {
  return sections.reduce(
    (sum, sec, k) =>
      sum + (sec.heading ? FIT.heading : 0) + sec.items.reduce((n, it) => n + itemHeightMm(it, figMm(it), withAnswers), 0) + (k < sections.length - 1 ? FIT.gap : 0),
    0,
  );
}

/**
 * 1枚に収まる図の幅（mm）を決める。図を QUIZ_FIG_MIN_MM まで小さくしても入らなければ QuizOverflowError。
 * aspect(it) は図の縦横比（高さ÷幅）。問題用と答え入りの両方で収まる幅にする（2つの紙の並びをそろえる）。
 */
export function fitFigureWidth(sections: QuizSection[], aspect: (it: QuizItem) => number | null, sheetNo: number): number {
  const height = (w: number, secs = sections) =>
    Math.max(
      sheetHeightMm(secs, (it) => (it.side?.figure ? (aspect(it) ?? 0.8) * w : null), false),
      sheetHeightMm(secs, (it) => (it.side?.figure ? (aspect(it) ?? 0.8) * w : null), true),
    );
  for (let w = QUIZ_FIG_MAX_MM; w >= QUIZ_FIG_MIN_MM; w -= 4) if (height(w) <= FIT.area) return w;
  // 入らない：後ろから何問減らせば入るか
  const flat = sections.flatMap((sec, si) => sec.items.map((_, ii) => [si, ii] as const));
  let drop = 0;
  for (; drop < flat.length - 1; drop++) {
    const keep = new Set(flat.slice(0, flat.length - drop - 1).map(([a, b]) => `${a}:${b}`));
    const secs = sections.map((sec, si) => ({ ...sec, items: sec.items.filter((_, ii) => keep.has(`${si}:${ii}`)) })).filter((sec) => sec.items.length);
    if (height(QUIZ_FIG_MIN_MM, secs) <= FIT.area) break;
  }
  const count = flat.length;
  const figs = flat.filter(([a, b]) => sections[a].items[b].side?.figure).length;
  const need = (Math.ceil(height(QUIZ_FIG_MIN_MM)) / 10).toFixed(1);
  const room = (Math.floor(FIT.area) / 10).toFixed(1);
  throw new QuizOverflowError(
    `${sheetNo}枚目（${count}問・図${figs}つ）が B5 の1枚に収まりません（問題の高さの目安：約${need}cm、1枚に入るのは約${room}cm）。` +
      `あと${drop + 1}問ほど減らすか、sheets を分けて2枚にしてください（No. が続く）。` +
      '目安：図のある問題は1枚に3〜4問（図の無い短い問題を足すなら合わせて6問まで）、図の無い短い計算は8〜10問。直したら、もう一度 create_math_quiz を呼ぶ。',
  );
}

export const QUIZ_NOTE = '※やり直しは全て、訂正ノートに！提出期限は守ること。';
export const QUIZ_ORG = '智翔館・東進衛星予備校';

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const LINE: IBorderOptions = { style: BorderStyle.SINGLE, size: 8, color: '000000' };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const CELL_NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };

const kyo = (text: string, size: number, o: { spacing?: number } = {}) =>
  new TextRun({ text, font: FONT_KYOKASHO, size, characterSpacing: o.spacing });

/** 枚の上：題名と No.、氏名の枠。 */
function sheetHead(series: string, no: number, first: boolean): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  if (!first) out.push(new Paragraph({ children: [new PageBreak()] }));
  out.push(new Paragraph({
    indent: { left: Math.round(16 * MM) },
    spacing: { after: 80 },
    children: [kyo(`${series}　No.${no}`, 28, { spacing: 30 })],
  }));
  out.push(new Table({
    width: { size: Math.round(68 * MM), type: WidthType.DXA },
    columnWidths: [Math.round(68 * MM)],
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.RIGHT,
    rows: [new TableRow({
      height: { value: Math.round(10 * MM), rule: HeightRule.ATLEAST },
      children: [new TableCell({
        width: { size: Math.round(68 * MM), type: WidthType.DXA },
        borders: { top: LINE, bottom: LINE, left: LINE, right: LINE },
        verticalAlign: VerticalAlign.CENTER,
        margins: { left: 100 },
        children: [new Paragraph({ children: [kyo('氏名', 26)] })],
      })],
    })],
  }));
  out.push(para([], { after: 360 }));
  return out;
}

/** 「よく出る」の印（枠で囲む）。 */
function frequentMark(): TextRun {
  return new TextRun({ text: 'よく出る', font: { ascii: MINCHO, hAnsi: MINCHO, eastAsia: MINCHO }, size: 16, border: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } });
}

const LABEL_TAB = 720; // 「□(1)」のあと、本文が始まる位置（見本では約12.7mm）
const SUB_LEFT = LABEL_TAB + 600;

function itemLeft(it: QuizItem, n: number): Paragraph[] {
  const label: ParagraphChild[] = [textRun('□', { size: SIZE }), textRun(`(${n})`, { size: 18 })];
  const lines = it.text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: Paragraph[] = lines.map((l, i) => new Paragraph({
    indent: i === 0 ? { left: LABEL_TAB, hanging: LABEL_TAB } : { left: LABEL_TAB },
    tabStops: [{ type: TabStopType.LEFT, position: LABEL_TAB }],
    spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 0 },
    children: i === 0 ? [...label, new TextRun({ text: '\t' }), ...(it.frequent ? [frequentMark(), textRun('　', { size: SIZE })] : []), ...richRuns(l, { size: SIZE })] : richRuns(l, { size: SIZE }),
  }));
  it.sub.forEach((s, k) => {
    out.push(new Paragraph({
      indent: { left: SUB_LEFT, hanging: SUB_LEFT - LABEL_TAB },
      tabStops: [{ type: TabStopType.LEFT, position: SUB_LEFT }],
      spacing: { before: 120, line: 360, lineRule: LineRuleType.AUTO },
      children: [textRun(`□${'①②③④⑤⑥'[k]}`, { size: SIZE }), new TextRun({ text: '\t' }), ...richRuns(s, { size: SIZE })],
    }));
  });
  return out;
}

/** 1つの見出しのまとまり：見出しの行と、問題の表（左に問題、右に余白・図・答え）。 */
async function sectionBlocks(
  heading: string, no: number, items: QuizItem[], withAnswers: boolean, render: FigureRenderer, notes: string[], last: boolean, figMm: number,
): Promise<(Paragraph | Table)[]> {
  const out: (Paragraph | Table)[] = [];
  if (heading) out.push(para([boxedNumber(no, 22), textRun('　'), ...richRuns(heading, { size: SIZE })], { after: 120 }));
  const figNo = { n: 0 };
  const rows: TableRow[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const right: (Paragraph | Table)[] = [];
    if (withAnswers) {
      right.push(new Paragraph({ children: [textRun('答　', { size: 18, color: RED, bold: true }), ...richRuns(it.answer || '〔答えがありません〕', { size: SIZE, color: RED })] }));
    }
    // 図は1枚に収まるように決めた幅（figMm）で入れる。表は右の余白の幅いっぱい
    const sideW = it.side?.figure ? Math.min(RIGHT_W, Math.round(figMm * MM) + 200) : RIGHT_W;
    if (it.side) right.push(...(await sideBlocks([{ ...it.side, label: it.side.label ?? '' }], render, figNo, notes, sideW)));
    // 短い問題（計算）は詰めて、長い問題・図のある問題は高さにまかせる
    const short = it.text.length <= 40 && !it.sub.length && !it.side;
    rows.push(new TableRow({
      height: { value: short ? Math.round(13 * MM) : Math.round(22 * MM), rule: HeightRule.ATLEAST },
      cantSplit: true,
      children: [
        new TableCell({ width: { size: LEFT_W, type: WidthType.DXA }, borders: CELL_NO_BORDERS, margins: { right: 160, bottom: 200 }, children: itemLeft(it, i + 1) }),
        new TableCell({ width: { size: RIGHT_W, type: WidthType.DXA }, borders: CELL_NO_BORDERS, margins: { left: 160, bottom: 200 }, children: right.length ? right : [new Paragraph({ children: [] })] }),
      ],
    }));
  }
  out.push(new Table({ width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: [LEFT_W, RIGHT_W], layout: TableLayoutType.FIXED, borders: NO_BORDERS, rows }));
  // 枚の最後には空の段落を足さない（ページがあふれて、空のページができないように）
  if (!last) out.push(para([], { after: 200 }));
  return out;
}

function quizFooter(note: string, org: string): Footer {
  return new Footer({
    children: [
      new Paragraph({ children: [kyo(note, 24)] }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: org, font: { ascii: MINCHO, hAnsi: MINCHO, eastAsia: MINCHO }, size: 16 })] }),
    ],
  });
}

/** 小テストの Word。withAnswers なら、右の余白に赤で答えを入れた版。 */
export async function buildQuizDocx(
  q: MathQuiz, render: FigureRenderer, o: { withAnswers?: boolean; note?: string; org?: string } = {},
): Promise<{ buffer: Buffer; notes: string[] }> {
  const notes: string[] = [];
  const children: (Paragraph | Table)[] = [];
  // 図の縦横比（1枚に収まるかの見積もりに使う。描けない図は見積もりでは高さ0.8倍とみなす）
  const aspects = new Map<QuizItem, number | null>();
  for (const sh of q.sheets) {
    for (const sec of sh.sections) {
      for (const it of sec.items) {
        if (!it.side?.figure) continue;
        try {
          const img = await render(it.side.figure, { printMm: QUIZ_FIG_MAX_MM });
          aspects.set(it, img.height / img.width);
        } catch {
          aspects.set(it, null);
        }
      }
    }
  }
  // 先に全部の枚を確かめる（1枚でもはみ出すなら、作らずに AI へ返す）
  const figMms = q.sheets.map((sh, s) => fitFigureWidth(sh.sections, (it) => aspects.get(it) ?? null, s + 1));
  for (let s = 0; s < q.sheets.length; s++) {
    children.push(...sheetHead(q.series, q.startNo + s, s === 0));
    const secs = q.sheets[s].sections;
    for (let k = 0; k < secs.length; k++) {
      children.push(...(await sectionBlocks(secs[k].heading, k + 1, secs[k].items, !!o.withAnswers, render, notes, k === secs.length - 1, figMms[s])));
    }
  }
  const doc = new Document({
    creator: '智翔館AI',
    title: `${q.title}${o.withAnswers ? '（答え入り）' : ''}`,
    styles: { default: { document: { run: { font: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: MINCHO }, size: SIZE } } } },
    sections: [{
      properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: { ...MARGIN, footer: Math.round(8 * MM) } } },
      footers: { default: quizFooter(o.note ?? QUIZ_NOTE, o.org ?? QUIZ_ORG) },
      children,
    }],
  });
  return { buffer: await Packer.toBuffer(doc), notes };
}
