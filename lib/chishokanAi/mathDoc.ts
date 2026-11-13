// 数学の教材を、社内の仕上がりの書式の Word にする（問題のファイルと、解答・解説のファイル）。サーバ専用。
//
// 書式は、数学科の仕上がりデータ（長崎県統一模試 232号 数学）に合わせる。決まりは knowledge/37_教材制作/数学/40_仕上がりの書式.md。
// - B4縦、余白は上下左右 20mm。本文はＭＳ明朝 11pt、英数字は Times New Roman
// - 大問の番号は□で囲み、大問ごとに新しいページから始める
// - 小問は（１）（２）…（小問集合）か、太字の「問１」「問２」…（その中の細かい問いは（１）（２）…）
// - 図と表は問題文の右の列に置き、上に太字で「図１」「表」と付ける
// - ページの下：真ん中にページ番号、右に「問題は次のページも続きます。」（最後のページは「これで問題は終わりです。」）
// - 模試の形（booklet）のときは、表紙（受験番号・題名・時間・注意）と「問題」の扉を付ける

import {
  AlignmentType, BorderStyle, Document, Footer, HeightRule, ImageRun, LineRuleType, Math as OMath, MathFraction, MathRadical, MathRun, MathSuperScript,
  Packer, PageBreak, PageNumber, Paragraph, SectionType, Table, TableCell, TableLayoutType, TableRow, TabStopType, TextRun,
  VerticalAlign, WidthType,
  type IBorderOptions, type ISectionOptions, type MathComponent, type ParagraphChild,
} from 'docx';
import type { MathItem, MathMaterial, MathProblem, Side } from './mathMaterialTool';
import { parseMathText, wideNum, type Piece } from './mathText';

// --- 書式の決まり ------------------------------------------------------------

const MINCHO = 'ＭＳ 明朝';
const GOTHIC = 'ＭＳ ゴシック';
const LATIN = 'Times New Roman';
const SIZE = 22; // 11pt（half-point）

const MM = 56.7; // 1mm の twip
const PAGE = { width: Math.round(257 * MM), height: Math.round(364 * MM) }; // B4 縦
const MARGIN = Math.round(20 * MM);
const TEXT_W = PAGE.width - 2 * MARGIN; // 本文の幅
const SIDE_W = 4500; // 右の列（図・表）の幅
const MAIN_W = TEXT_W - SIDE_W;
const PX_PER_TWIP = 96 / 1440;

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const LINE: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const CELL_NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const CELL_BORDERS = { top: LINE, bottom: LINE, left: LINE, right: LINE };

const FONT_MINCHO = { ascii: LATIN, hAnsi: LATIN, eastAsia: MINCHO, cs: LATIN };
const FONT_GOTHIC = { ascii: GOTHIC, hAnsi: GOTHIC, eastAsia: GOTHIC, cs: GOTHIC };

/** 図を PNG にする関数（figurePng.ts の renderFigurePng を、テストでは差し替える）。 */
export type FigureRenderer = (figure: unknown) => Promise<{ data: Buffer; width: number; height: number; widthCm: number }>;

export type RunOpts = { bold?: boolean; size?: number; gothic?: boolean; color?: string };

// --- 文（数式を含む） ---------------------------------------------------------

export function textRun(text: string, o: RunOpts & { italics?: boolean; superScript?: boolean; subScript?: boolean; color?: string } = {}): TextRun {
  return new TextRun({
    text,
    font: o.gothic ? FONT_GOTHIC : FONT_MINCHO,
    size: o.size ?? SIZE,
    color: o.color,
    bold: o.bold,
    italics: o.italics,
    superScript: o.superScript,
    subScript: o.subScript,
  });
}

function mathList(ps: Piece[]): MathComponent[] {
  const out: MathComponent[] = [];
  for (const p of ps) {
    if (p.t === 'frac') out.push(new MathFraction({ numerator: mathList(p.num), denominator: mathList(p.den) }));
    else if (p.t === 'sqrt') out.push(new MathRadical({ children: mathList(p.body) }));
    else if (p.sup && out.length) {
      const base = out.pop() as MathComponent;
      out.push(new MathSuperScript({ children: [base], superScript: [new MathRun(p.v)] }));
    } else {
      out.push(new MathRun({ text: p.v, style: p.italic ? 'boldItalic' : 'plain' }));
    }
  }
  return out;
}

/** 文（$ … $ の数式を含む）を、段落の中身にする。 */
export function richRuns(src: string, o: RunOpts = {}): ParagraphChild[] {
  return parseMathText(src).map((p) => {
    if (p.t === 'text') {
      return textRun(p.v, { ...o, bold: o.bold || p.bold, italics: p.italic, superScript: p.sup, subScript: p.sub, color: o.color });
    }
    return new OMath({ children: mathList([p]) });
  });
}

export function para(children: ParagraphChild[], o: { indent?: { left: number; hanging?: number }; after?: number; before?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; tab?: number; pageBreakBefore?: boolean; single?: boolean } = {}): Paragraph {
  return new Paragraph({
    children,
    indent: o.indent,
    alignment: o.align,
    // 行間は「倍数」で指定する（固定にすると、図や分数が行の高さで切れる）。図の段落は1行
    spacing: { before: o.before ?? 0, after: o.after ?? 0, line: o.single ? 240 : 360, lineRule: LineRuleType.AUTO },
    tabStops: o.tab ? [{ type: TabStopType.LEFT, position: o.tab }] : undefined,
    pageBreakBefore: o.pageBreakBefore,
  });
}

/** 改行で分けた文を、段落にする（1行目にだけ番号を付け、2行目からは本文の位置にそろえる）。 */
function labeled(label: ParagraphChild[], text: string, indent: { left: number; hanging: number }, after: number): Paragraph[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return lines.map((l, i) =>
    para(i === 0 ? [...label, new TextRun({ text: '\t' }), ...richRuns(l)] : richRuns(l), {
      indent: i === 0 ? indent : { left: indent.left },
      tab: indent.left,
      after: i === lines.length - 1 ? after : 0,
    }),
  );
}

// --- 大問 -------------------------------------------------------------------

// 番号の位置と本文の位置（twip。11pt の1文字＝220）。番号は1文字下げ、番号のあとに約2文字あける（仕上がりデータに合わせる）
const KAKKO = { left: 1320, hanging: 1100 }; // （１）
const TOI = { left: 1100, hanging: 880 }; // 問１
const SUB = { left: 1540, hanging: 1100 }; // 問の中の（１）

export function boxedNumber(n: number, size = 28): TextRun {
  return new TextRun({ text: ` ${n} `, font: FONT_GOTHIC, size, border: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 1 } });
}

function itemParagraphs(it: MathItem, n: number, numbering: MathProblem['numbering']): Paragraph[] {
  if (numbering === 'kakko') {
    return labeled([textRun(`（${wideNum(n)}）`)], it.text, KAKKO, 520);
  }
  const out = labeled([textRun(`問${wideNum(n)}`, { bold: true })], it.text, TOI, it.sub.length ? 160 : 640);
  it.sub.forEach((s, k) => out.push(...labeled([textRun(`（${wideNum(k + 1)}）`)], s, SUB, k === it.sub.length - 1 ? 640 : 300)));
  return out;
}

function sideTable(rows: string[][], sideW = SIDE_W): Table {
  const cols = Math.max(...rows.map((r) => r.length));
  const w = Math.floor((sideW - 200) / cols);
  return new Table({
    width: { size: w * cols, type: WidthType.DXA },
    columnWidths: Array(cols).fill(w),
    layout: TableLayoutType.FIXED,
    rows: rows.map((r, i) => new TableRow({
      children: Array.from({ length: cols }, (_, c) => new TableCell({
        width: { size: w, type: WidthType.DXA },
        borders: CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 20, bottom: 20, left: 40, right: 40 },
        children: [para(richRuns(r[c] ?? '', { size: 18, bold: i === 0 && false }), { align: AlignmentType.CENTER })],
      })),
    })),
  });
}

/** 右の列に置く図・表（ラベルを上に付ける）。 */
export async function sideBlocks(sides: Side[], render: FigureRenderer, figNo: { n: number }, notes: string[], sideW = SIDE_W): Promise<(Paragraph | Table)[]> {
  const out: (Paragraph | Table)[] = [];
  for (const s of sides) {
    // label が空の文字（''）なら、見出しを付けない（小テストの図など）
    if (s.table) {
      if (s.label !== '') out.push(para([textRun(s.label || '表', { bold: true, gothic: true, size: 20 })], { after: 60 }));
      out.push(sideTable(s.table, sideW));
      out.push(para([], { after: 240 }));
      continue;
    }
    figNo.n++;
    const label = s.label || `図${wideNum(figNo.n)}`;
    if (s.label !== '') out.push(para([textRun(label, { bold: true, gothic: true, size: 20 })], { after: 60 }));
    try {
      const img = await render(s.figure);
      const maxPx = (sideW - 200) * PX_PER_TWIP;
      const wantPx = (img.widthCm / 2.54) * 96;
      const w = Math.round(Math.min(maxPx, wantPx));
      const h = Math.round((w * img.height) / img.width);
      out.push(para([new ImageRun({ type: 'png', data: img.data, transformation: { width: w, height: h } })], { after: 240, single: true }));
    } catch (e) {
      notes.push(`${label}を描けませんでした（${String((e as Error)?.message ?? e).slice(0, 80)}）`);
      out.push(para([textRun(`〔${label}を描けませんでした〕`)], { after: 240 }));
    }
  }
  return out;
}

/** 本文の左と、図・表の右を並べる、枠の無い表。 */
function twoColumns(left: (Paragraph | Table)[], right: (Paragraph | Table)[]): Table {
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA },
    columnWidths: [MAIN_W, SIDE_W],
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows: [new TableRow({
      children: [
        new TableCell({ width: { size: MAIN_W, type: WidthType.DXA }, borders: CELL_NO_BORDERS, margins: { left: 0, right: 120 }, children: left.length ? left : [para([])] }),
        new TableCell({ width: { size: SIDE_W, type: WidthType.DXA }, borders: CELL_NO_BORDERS, margins: { left: 120, right: 0 }, children: right.length ? right : [para([])] }),
      ],
    })],
  });
}

async function problemBlocks(p: MathProblem, n: number, first: boolean, render: FigureRenderer, notes: string[]): Promise<(Paragraph | Table)[]> {
  const figNo = { n: 0 };
  const head = para([boxedNumber(n), textRun('　'), ...(p.intro ? richRuns(p.intro) : [])], { after: 360, indent: { left: 0 } });
  const out: (Paragraph | Table)[] = [];
  if (!first) out.push(new Paragraph({ children: [new PageBreak()] }));
  if (p.side.length) {
    // 大問全体にかかる図・表：大問をまるごと左の列に、図・表を右の列に（小問の図はその下に続ける）
    const left: Paragraph[] = [head];
    p.items.forEach((it, i) => left.push(...itemParagraphs(it, i + 1, p.numbering)));
    const sides = [...p.side, ...p.items.flatMap((it) => (it.side ? [it.side] : []))];
    out.push(twoColumns(left, await sideBlocks(sides, render, figNo, notes)));
    return out;
  }
  out.push(head);
  for (let i = 0; i < p.items.length; i++) {
    const it = p.items[i];
    const ps = itemParagraphs(it, i + 1, p.numbering);
    if (it.side) out.push(twoColumns(ps, await sideBlocks([it.side], render, figNo, notes)));
    else out.push(...ps);
  }
  return out;
}

// --- ページの下・表紙・扉 ----------------------------------------------------

function pageFooter(note: string): Footer {
  return new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.CENTER, position: Math.round(TEXT_W / 2) }, { type: TabStopType.RIGHT, position: TEXT_W }],
        children: [
          new TextRun({ text: '\t－ ', font: FONT_MINCHO, size: 20 }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT_MINCHO, size: 20 }),
          new TextRun({ text: ' －\t', font: FONT_MINCHO, size: 20 }),
          new TextRun({ text: note, font: FONT_GOTHIC, size: 20, bold: true }),
        ],
      }),
    ],
  });
}

const blank = () => new Footer({ children: [new Paragraph({ children: [] })] });

function coverChildren(m: MathMaterial): (Paragraph | Table)[] {
  const box = new Table({
    width: { size: 4200, type: WidthType.DXA },
    columnWidths: [1500, 2700],
    layout: TableLayoutType.FIXED,
    rows: [new TableRow({
      height: { value: 560, rule: HeightRule.ATLEAST },
      children: [
        new TableCell({ width: { size: 1500, type: WidthType.DXA }, borders: CELL_BORDERS, verticalAlign: VerticalAlign.CENTER, children: [para([textRun('受験番号', { size: 20 })], { align: AlignmentType.CENTER })] }),
        new TableCell({ width: { size: 2700, type: WidthType.DXA }, borders: CELL_BORDERS, verticalAlign: VerticalAlign.CENTER, children: [para([textRun('番', { size: 20 })], { align: AlignmentType.RIGHT })] }),
      ],
    })],
  });
  const N = m.problems.length;
  const notes: ParagraphChild[][] = [
    [textRun('放送で指示があるまで、この問題冊子を開いてはいけません。')],
    [textRun('解答用紙は中にはさんであります。')],
    [textRun('「始め」の合図があったら、まず、受験番号、氏名、所属塾名を解答用紙のそれぞれの欄に記入しなさい。')],
    [textRun('問題は'), boxedNumber(1), textRun('～'), boxedNumber(N), textRun('です。')],
    [textRun('答えは、すべて解答用紙に記入しなさい。'), textRun('答えは、最も簡単な形にしなさい。なお、計算の結果に √ または π をふくむときは、近似値に直さないでそのまま答えなさい。', { bold: true })],
    [textRun('「やめ」の合図で、鉛筆を置きなさい。')],
  ];
  const noteBox = new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [9000],
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: 9000, type: WidthType.DXA },
        borders: CELL_BORDERS,
        margins: { top: 200, bottom: 200, left: 300, right: 300 },
        children: notes.map((c, i) => para([textRun(`${wideNum(i + 1)}　`), ...c], { indent: { left: 440, hanging: 440 }, after: 80 })),
      })],
    })],
  });
  return [
    box,
    para([], { after: 2400 }),
    para([textRun(m.cover.name, { size: 40 })], { align: AlignmentType.CENTER, after: 400 }),
    para([textRun('数　　学', { size: 72 })], { align: AlignmentType.CENTER, after: 200 }),
    para([textRun(`（${String(m.cover.minutes).replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0))}分）`)], { align: AlignmentType.CENTER, after: 4200 }),
    para([textRun('注　　意', { size: 24 })], { align: AlignmentType.CENTER, after: 200 }),
    noteBox,
  ];
}

function doorChildren(): Paragraph[] {
  // ページの頭の段落の「前の間隔」は Word が詰めることがあるので、空の段落を置いてから下げる
  return [para([]), para([textRun('問　　題', { size: 96 })], { align: AlignmentType.CENTER, before: 4600 })];
}

const pageProps = (pageNumbersStart?: number) => ({
  page: {
    size: { width: PAGE.width, height: PAGE.height },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, footer: 560 },
    pageNumbers: pageNumbersStart ? { start: pageNumbersStart } : undefined,
  },
});

// --- ファイル ----------------------------------------------------------------

/** 問題のファイル（.docx）。notes には、作るときに気になった点（描けなかった図など）を入れる。 */
export async function buildProblemDocx(m: MathMaterial, render: FigureRenderer): Promise<{ buffer: Buffer; notes: string[] }> {
  const notes: string[] = [];
  const blocks: (Paragraph | Table)[][] = [];
  for (let i = 0; i < m.problems.length; i++) blocks.push(await problemBlocks(m.problems[i], i + 1, i === 0, render, notes));
  const sections: ISectionOptions[] = [];
  if (m.booklet) {
    sections.push({ properties: pageProps(), footers: { default: blank() }, children: coverChildren(m) });
    sections.push({ properties: { ...pageProps(), type: SectionType.NEXT_PAGE }, footers: { default: blank() }, children: doorChildren() });
  }
  // 最後の大問だけ別の区切りにして、ページの下の文言を「これで問題は終わりです。」にする
  const last = blocks.length - 1;
  const firstType = m.booklet ? SectionType.NEXT_PAGE : undefined;
  if (last > 0) {
    sections.push({ properties: { ...pageProps(1), type: firstType }, footers: { default: pageFooter('問題は次のページも続きます。') }, children: blocks.slice(0, last).flat() });
  }
  const lastChildren = blocks[last].filter((b, k) => !(last > 0 && k === 0 && b instanceof Paragraph)); // 区切りで改ページするので PageBreak を外す
  sections.push({
    properties: { ...pageProps(last > 0 ? undefined : 1), type: last > 0 ? SectionType.NEXT_PAGE : firstType },
    footers: { default: pageFooter('これで問題は終わりです。') },
    children: lastChildren,
  });
  const doc = new Document({
    creator: '智翔館AI',
    title: m.title,
    styles: { default: { document: { run: { font: FONT_MINCHO, size: SIZE } } } },
    sections,
  });
  return { buffer: await Packer.toBuffer(doc), notes };
}

/** 解答・解説のファイル（.docx）。 */
export async function buildAnswerDocx(m: MathMaterial): Promise<Buffer> {
  const children: Paragraph[] = [
    para([textRun(`${m.title}　解答・解説`, { size: 28, bold: true, gothic: true })], { after: 360 }),
  ];
  m.problems.forEach((p, i) => {
    children.push(para([boxedNumber(i + 1), textRun('　解答', { bold: true, gothic: true })], { before: i ? 360 : 0, after: 200 }));
    const answers = m.answers[i] ?? [];
    p.items.forEach((_, k) => {
      const label = p.numbering === 'kakko' ? textRun(`（${wideNum(k + 1)}）`) : textRun(`問${wideNum(k + 1)}`, { bold: true });
      children.push(...labeled([label], answers[k] || '〔答えがありません〕', p.numbering === 'kakko' ? KAKKO : TOI, 120));
    });
    const ex = (m.explanations[i] ?? '').replace(/```[\s\S]*?```/g, '').trim();
    if (ex) {
      children.push(para([textRun('解説', { bold: true, gothic: true })], { before: 200, after: 120, indent: { left: 220 } }));
      for (const line of ex.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
        children.push(para(richRuns(line), { indent: { left: 440 }, after: 60 }));
      }
    }
  });
  const doc = new Document({
    creator: '智翔館AI',
    title: `${m.title} 解答・解説`,
    styles: { default: { document: { run: { font: FONT_MINCHO, size: SIZE } } } },
    sections: [{
      properties: pageProps(1),
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: '－ ', size: 20 }), new TextRun({ children: [PageNumber.CURRENT], size: 20 }), new TextRun({ text: ' －', size: 20 })],
          })],
        }),
      },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}
