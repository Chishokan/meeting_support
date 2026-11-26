// 英語の単語テストを Word にする（「テスト」と「答え入り」）。サーバ専用。
//
// 書式は数学の小テスト（lib/chishokanAi/mathQuizDoc.ts）にそろえる：B5縦、上に題名と範囲、右に氏名と点数の枠、下に注意と塾名。
// - 単語（Key Words）：左右2列の表。1行に「番号・問題・答えを書く欄」。1枚に40問（左20・右20）まで
// - Key Words TEST（巻末の文の穴埋め）：1問2行（日本文と、空欄のある英文）。1枚に12問まで
// - 不規則動詞：1行に「番号・意味・原形・過去形・過去分詞」の表。書かせる形は空欄。1枚に20問まで
// - 助動詞の確認テスト：1行に「番号・問い・答える部分（空欄つき）」の表。全25問を1枚に
// - 答え入りは、答えを書く欄・空欄に赤で答えを入れる
// - 版（A・B）があるときは、版ごとにテストを分け、答え入りも版ごとに続けて入れる

import {
  AlignmentType, BorderStyle, Document, Footer, HeightRule, Packer, PageBreak, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun,
  VerticalAlign, WidthType, type IBorderOptions,
} from 'docx';
import { kwtParts, PER_SHEET, type QuizQ, type WordQuiz } from './wordQuiz';

const KYOKASHO = 'UD デジタル 教科書体 NK-R';
const FONT_JA = { ascii: 'Century', hAnsi: 'Century', eastAsia: KYOKASHO, cs: KYOKASHO };
const MINCHO = 'ＭＳ 明朝';
const RED = 'C00000';
const SIZE = 21; // 10.5pt

const MM = 56.7;
const PAGE = { width: Math.round(182 * MM), height: Math.round(257 * MM) }; // B5 縦
const MARGIN = { top: Math.round(12 * MM), bottom: Math.round(12 * MM), left: Math.round(12 * MM), right: Math.round(10 * MM) };
const TEXT_W = PAGE.width - MARGIN.left - MARGIN.right;

export const NOTE = '※やり直しは全て、訂正ノートに！提出期限は守ること。';
export const ORG = '智翔館・東進衛星予備校';

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const LINE: IBorderOptions = { style: BorderStyle.SINGLE, size: 8, color: '000000' };
const THIN: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: '7F7F7F' };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

const run = (text: string, o: { size?: number; color?: string; bold?: boolean; underline?: boolean } = {}) =>
  new TextRun({ text, font: FONT_JA, size: o.size ?? SIZE, color: o.color, bold: o.bold, underline: o.underline ? { type: 'single', color: o.color ?? '000000' } : undefined });

const p = (children: TextRun[], o: { after?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
  new Paragraph({ alignment: o.align, spacing: { after: o.after ?? 0 }, children });

function cell(children: Paragraph[], width: number, o: { bottom?: IBorderOptions; top?: IBorderOptions; align?: 'center' } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: { top: o.top ?? NONE, bottom: o.bottom ?? NONE, left: NONE, right: NONE },
    verticalAlign: VerticalAlign.CENTER,
    margins: { left: 60, right: 60 },
    children: children.length ? children : [new Paragraph({ children: [] })],
  });
}

/** 枚の上：題名（と版）・範囲、右に氏名と点数の枠。 */
function sheetHead(q: WordQuiz, label: string, total: number, page: number, pages: number, first: boolean, withAnswers: boolean): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  if (!first) out.push(new Paragraph({ children: [new PageBreak()] }));
  const kind = q.source === 'kwt' ? 'Key Words TEST' : q.source === 'verbs' ? '不規則動詞テスト' : q.source === 'modals' ? '助動詞の確認テスト' : '単語テスト';
  const head = `英語　${kind}${label ? `　${label}` : ''}${pages > 1 ? `　（${page}/${pages}）` : ''}${withAnswers ? '　答え' : ''}`;
  const leftW = Math.round(TEXT_W * 0.5);
  const nameW = Math.round(TEXT_W * 0.32);
  const scoreW = TEXT_W - leftW - nameW;
  const box = (text: string, w: number) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      borders: { top: LINE, bottom: LINE, left: LINE, right: LINE },
      verticalAlign: VerticalAlign.CENTER,
      margins: { left: 100 },
      children: [p([run(text, { size: 20 })])],
    });
  out.push(new Table({
    width: { size: TEXT_W, type: WidthType.DXA },
    columnWidths: [leftW, nameW, scoreW],
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows: [new TableRow({
      height: { value: Math.round(11 * MM), rule: HeightRule.ATLEAST },
      children: [
        new TableCell({
          width: { size: leftW, type: WidthType.DXA },
          borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
          verticalAlign: VerticalAlign.CENTER,
          children: [p([run(head, { size: 26, bold: true })]), p([run(q.range, { size: 18 })])],
        }),
        box('氏名', nameW),
        box(`　　　／${total}`, scoreW),
      ],
    })],
  }));
  const firstQ = q.versions[0].questions[0];
  const verbAsk = firstQ?.kind === 'verb' ? firstQ.ask : 'past-pp';
  const how = q.source === 'kwt'
    ? '日本文に合うように、下線部に適する語を書きなさい。'
    : q.source === 'modals'
      ? '下線部や（　）・〖　〗に、あてはまる意味や語を書きなさい。【　】の内容を参考にしなさい。'
    : q.source === 'verbs'
      ? verbAsk === 'all'
        ? '意味に合う動詞の原形・過去形・過去分詞を書きなさい。'
        : verbAsk === 'past'
          ? '次の動詞の過去形を書きなさい。'
          : '次の動詞の過去形・過去分詞を書きなさい。'
    : q.versions[0].questions.every((x) => x.kind === 'word' && x.toEn)
      ? '次の日本語を英語に直しなさい。'
      : q.versions[0].questions.every((x) => x.kind === 'word' && !x.toEn)
        ? '次の英語の意味を日本語で書きなさい。'
        : '日本語は英語に、英語は日本語に直しなさい。';
  out.push(p([run(how, { size: 20 })], { after: q.source === 'modals' ? 0 : 160 }));
  if (q.source === 'modals') out.push(p([run('※大文字、小文字、符号に注意して、見直しをすること！', { size: 18 })], { after: 120 }));
  return out;
}

/** 単語：左右2列（番号・問題・答えの欄）の表。 */
function wordTable(qs: Extract<QuizQ, { kind: 'word' }>[], startNo: number, withAnswers: boolean): Table {
  const half = Math.floor(TEXT_W / 2);
  const noW = Math.round(9 * MM);
  const gap = Math.round(4 * MM);
  const qW = Math.round((half - noW - gap) * 0.5);
  const aW = half - noW - gap - qW;
  const rowsN = Math.ceil(qs.length / 2);
  const side = (i: number) => {
    const q = qs[i];
    if (!q) return [cell([], noW), cell([], qW), cell([], aW), cell([], gap)];
    const small = q.prompt.length > 14 ? 17 : 19;
    return [
      cell([p([run(`(${startNo + i})`, { size: 18 })])], noW),
      cell([p([run(q.prompt, { size: small })])], qW),
      cell(withAnswers ? [p([run(q.answer, { size: q.answer.length > 14 ? 17 : SIZE, color: RED })])] : [], aW, { bottom: THIN }),
      cell([], gap),
    ];
  };
  const rows = Array.from({ length: rowsN }, (_, r) =>
    new TableRow({ height: { value: Math.round(8.6 * MM), rule: HeightRule.ATLEAST }, cantSplit: true, children: [...side(r), ...side(r + rowsN)] }),
  );
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA },
    columnWidths: [noW, qW, aW, gap, noW, qW, aW, gap].map((w, i) => (i === 7 ? TEXT_W - 2 * (noW + qW + aW) - gap : w)),
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows,
  });
}

/** Key Words TEST：1問ごとに日本文と、空欄のある英文。 */
function kwtBlocks(qs: Extract<QuizQ, { kind: 'kwt' }>[], startNo: number, withAnswers: boolean): Paragraph[] {
  const out: Paragraph[] = [];
  qs.forEach((q, i) => {
    out.push(new Paragraph({
      spacing: { before: i ? 200 : 0, after: 60 },
      indent: { left: 560, hanging: 560 },
      children: [run(`(${startNo + i})　`, { size: 19 }), run(q.ja), ...(q.note ? [run(`　※${q.note}`, { size: 17 })] : [])],
    }));
    const parts = kwtParts(q.en).map((x) => {
      if (!x.blank) return run(x.text);
      // 空欄の長さは答えの長さに合わせる（答えが分からないように、少し長めに）
      const w = Math.max(8, Math.ceil(x.text.length * 1.3));
      return withAnswers ? run(`  ${x.text}  `, { color: RED, underline: true }) : run('　'.repeat(Math.ceil(w / 2)), { underline: true });
    });
    out.push(new Paragraph({ spacing: { line: 400, after: 0 }, indent: { left: 560 }, children: parts }));
  });
  return out;
}

/** 不規則動詞：意味・原形・過去形・過去分詞の表。書かせる形は空欄（答え入りは赤）。 */
function verbTable(qs: Extract<QuizQ, { kind: 'verb' }>[], startNo: number, withAnswers: boolean): Table {
  const ask = qs[0]?.ask ?? 'past-pp';
  const cols: ('base' | 'past' | 'pp')[] = ask === 'past' ? ['base', 'past'] : ['base', 'past', 'pp'];
  const asked = (c: 'base' | 'past' | 'pp') => c !== 'base' || ask === 'all';
  const noW = Math.round(10 * MM);
  const jaW = Math.round((TEXT_W - noW) * (cols.length === 2 ? 0.36 : 0.31));
  const formW = Math.floor((TEXT_W - noW - jaW) / cols.length);
  const widths = [noW, jaW, ...cols.map((_, i) => (i === cols.length - 1 ? TEXT_W - noW - jaW - formW * (cols.length - 1) : formW))];
  const headName = { base: '原形', past: '過去形', pp: '過去分詞' } as const;
  const header = new TableRow({
    height: { value: Math.round(7 * MM), rule: HeightRule.ATLEAST },
    tableHeader: true,
    children: [
      cell([], noW, { bottom: LINE }),
      cell([p([run('意味', { size: 18 })], { align: AlignmentType.CENTER })], jaW, { bottom: LINE }),
      ...cols.map((c, i) => cell([p([run(headName[c], { size: 18 })], { align: AlignmentType.CENTER })], widths[i + 2], { bottom: LINE })),
    ],
  });
  const rows = qs.map((q, i) => new TableRow({
    height: { value: Math.round(8.6 * MM), rule: HeightRule.ATLEAST },
    cantSplit: true,
    children: [
      cell([p([run(`(${startNo + i})`, { size: 18 })])], noW, { bottom: THIN }),
      cell([p([run(q.ja, { size: q.ja.length > 12 ? 16 : 18 }), ...(withAnswers && q.note ? [run(`　※${q.note}`, { size: 14 })] : [])])], jaW, { bottom: THIN }),
      ...cols.map((c, k) => {
        const text = q[c];
        const show = !asked(c);
        return cell(
          show || withAnswers ? [p([run(text, { size: text.length > 12 ? 17 : SIZE, color: show ? undefined : RED })], { align: AlignmentType.CENTER })] : [],
          widths[k + 2],
          { bottom: THIN },
        );
      }),
    ],
  }));
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows: [header, ...rows],
  });
}

/** 空欄の長さ（答えが分からないように、少し長めに）。日本語は1字に全角1つ、英語は2字に全角1つ。 */
function blankFor(answer: string): string {
  const wide = [...answer].filter((c) => c.charCodeAt(0) > 0xff).length;
  const narrow = answer.length - wide;
  return '　'.repeat(Math.max(3, wide + Math.ceil(narrow / 2) + 1));
}

/** 助動詞の確認テスト：1行に「番号・問い・答える部分」。答え入りは空欄に赤で答え。 */
function modalTable(qs: Extract<QuizQ, { kind: 'modal' }>[], startNo: number, withAnswers: boolean): Table {
  const noW = Math.round(9 * MM);
  const qW = Math.round((TEXT_W - noW) * 0.3);
  const bW = TEXT_W - noW - qW;
  const rows = qs.map((q, i) => {
    // 本文の改行（\n）は、同じ欄の中で行を変える
    const parts = kwtParts(q.body).flatMap((x) =>
      !x.blank
        ? x.text.split('\n').map((t, k) => new TextRun({ text: t, font: FONT_JA, size: 19, break: k ? 1 : undefined }))
        : [withAnswers ? run(` ${x.text} `, { size: 19, color: RED, underline: true }) : run(blankFor(x.text), { size: 19, underline: true })],
    );
    if (withAnswers && q.note) parts.push(run(`　※${q.note}`, { size: 15, color: RED }));
    return new TableRow({
      height: { value: Math.round(7.6 * MM), rule: HeightRule.ATLEAST },
      cantSplit: true,
      children: [
        cell([p([run(`(${startNo + i})`, { size: 18 })])], noW, { bottom: THIN }),
        cell([p([run(q.prompt, { size: q.prompt.length > 14 ? 17 : 19 })])], qW, { bottom: THIN }),
        cell([new Paragraph({ spacing: { line: 320 }, children: parts })], bW, { bottom: THIN }),
      ],
    });
  });
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA },
    columnWidths: [noW, qW, bW],
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows,
  });
}

function footer(): Footer {
  return new Footer({
    children: [
      new Paragraph({ children: [new TextRun({ text: NOTE, font: { ascii: KYOKASHO, hAnsi: KYOKASHO, eastAsia: KYOKASHO }, size: 22 })] }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: ORG, font: { ascii: MINCHO, hAnsi: MINCHO, eastAsia: MINCHO }, size: 16 })] }),
    ],
  });
}

/** 1枚ずつに分ける。 */
export function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out.length ? out : [[]];
}

/** テストの Word。withAnswers なら答え入り。版があれば版ごとに枚を続ける。 */
export async function buildWordQuizDocx(q: WordQuiz, o: { withAnswers?: boolean } = {}): Promise<Buffer> {
  const withAnswers = !!o.withAnswers;
  const per = PER_SHEET[q.source];
  const children: (Paragraph | Table)[] = [];
  let first = true;
  for (const v of q.versions) {
    const sheets = chunk(v.questions, per);
    sheets.forEach((qs, s) => {
      children.push(...sheetHead(q, v.label ? `${v.label}版` : '', v.questions.length, s + 1, sheets.length, first, withAnswers));
      first = false;
      const startNo = s * per + 1;
      if (q.source === 'kwt') children.push(...kwtBlocks(qs as Extract<QuizQ, { kind: 'kwt' }>[], startNo, withAnswers));
      else if (q.source === 'verbs') children.push(verbTable(qs as Extract<QuizQ, { kind: 'verb' }>[], startNo, withAnswers));
      else if (q.source === 'modals') children.push(modalTable(qs as Extract<QuizQ, { kind: 'modal' }>[], startNo, withAnswers));
      else children.push(wordTable(qs as Extract<QuizQ, { kind: 'word' }>[], startNo, withAnswers));
    });
  }
  const doc = new Document({
    creator: '智翔館AI',
    title: `${q.title}${withAnswers ? '（答え入り）' : ''}`,
    styles: { default: { document: { run: { font: FONT_JA, size: SIZE } } } },
    sections: [{
      properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: { ...MARGIN, footer: Math.round(7 * MM) } } },
      footers: { default: footer() },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}
