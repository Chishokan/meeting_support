// 議事録の1枚まとめ（Digest）を Word（A4 縦、1会議1ページ）にする。
// 見た目は PDF（lib/deptMinutesDigestPdf.ts）と同じ並び。週ごとのまとめ（scripts/minutes-digest-files.mjs）で使う。
//
// - 会議ごとにセクションを分ける（1ページ直しても、ほかのページの位置が動かない）。足元に出典を書く
// - 行送りは固定値（パソコンやフォントが変わってもレイアウトがずれにくい）
// - 文字の大きさは会議ごとに渡す。1枚に収まるかは scripts/minutes-digest-files.mjs が LibreOffice で確かめる

import {
  AlignmentType, BorderStyle, Document, Footer, LevelFormat, LineRuleType, Packer, Paragraph, ShadingType,
  Tab, Table, TableCell, TableLayoutType, TableRow, TabStopType, TextRun, VerticalAlign, WidthType,
} from 'docx';
import type { Digest } from './deptMinutesDigest';

const FONT = 'Yu Gothic';
const INK = '1D2433';
const NAVY = '1F3A5F';
const SUB = '5A6375';
const LINE = 'D5DAE3';
const SOFT = 'F3F5F9';
const DEPT_COLOR: Record<string, string> = {
  英検: '16707A', RED個別: 'A83838', 小中等部: '2A5AA8', LEC: '5B4A9E', 高等部: '5B4A9E',
};
const mm = (v: number) => Math.round((v * 1440) / 25.4);
const PAGE_W = 11906;
const PAGE_H = 16838;
const MX = mm(12);
const CW = PAGE_W - MX * 2 - 6; // 本文幅（DXA）

export type DocxItem = { digest: Digest; size: number };

function section(d: Digest, pt: number, idx: number, total: number, safetyMm: number) {
  const hp = (v: number) => Math.round(v * 2);
  const lineOf = (s: number, k = 1.5) => Math.round(s * k * 20);
  const S = pt;
  const SM = pt * 0.88;
  const XS = pt * 0.8;
  const sp = (size: number, o: { before?: number; after?: number; k?: number } = {}) => ({
    before: o.before ?? 0, after: o.after ?? 0, line: lineOf(size, o.k ?? 1.5), lineRule: LineRuleType.EXACT,
  });

  // 【要確認】は黄色のマーカー
  const runs = (text: string, o: { size?: number; bold?: boolean; color?: string } = {}) =>
    String(text ?? '').split(/(【要確認】)/).filter(Boolean).map((part) =>
      part === '【要確認】'
        ? new TextRun({ text: '要確認', font: FONT, size: hp(o.size ?? S), bold: true, color: '7A5300',
          shading: { type: ShadingType.CLEAR, fill: 'FFF4D6', color: 'auto' } })
        : new TextRun({ text: part, font: FONT, size: hp(o.size ?? S), bold: !!o.bold, color: o.color ?? INK }));
  const para = (children: TextRun[], size: number, o: { before?: number; after?: number; k?: number } = {}, extra: object = {}) =>
    new Paragraph({ children, spacing: sp(size, o), ...extra });

  const thin = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const allThin = { top: thin, bottom: thin, left: thin, right: thin };
  const allNone = { top: none, bottom: none, left: none, right: none };
  const zero = { top: 0, bottom: 0, left: 0, right: 0 };

  type CellBorders = ConstructorParameters<typeof TableCell>[0]['borders'];
  const cell = (children: (Paragraph | Table)[], width: number, o: { fill?: string; borders?: CellBorders; margins?: typeof zero; center?: boolean } = {}) =>
    new TableCell({
      children, width: { size: width, type: WidthType.DXA },
      borders: o.borders ?? allThin, margins: o.margins ?? { top: 30, bottom: 30, left: 90, right: 90 },
      verticalAlign: o.center ? VerticalAlign.CENTER : VerticalAlign.TOP,
      shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
    });
  const table = (widths: number[], rows: TableRow[]) => new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths,
    layout: TableLayoutType.FIXED, rows,
  });
  const heading = (text: string, count?: number) => para([
    new TextRun({ text, font: FONT, size: hp(S * 1.02), bold: true, color: NAVY }),
    ...(count !== undefined ? [new TextRun({ text: `  ${count}件`, font: FONT, size: hp(XS), color: SUB })] : []),
  ], S, { before: 120, after: 30 }, {
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: NAVY, space: 4 } }, indent: { left: 60 },
  });
  const bullet = (text: string, size: number) => new Paragraph({
    children: runs(text, { size }), spacing: sp(size, { after: 10 }), numbering: { reference: 'bul', level: 0 },
  });

  const k: (Paragraph | Table)[] = [];
  // 見出し行（部門・通し番号）
  k.push(para([
    new TextRun({ text: ` ${d.dept} `, font: FONT, size: hp(XS * 1.05), bold: true, color: 'FFFFFF',
      shading: { type: ShadingType.CLEAR, fill: Object.entries(DEPT_COLOR).find(([key]) => d.dept.includes(key))?.[1] ?? NAVY, color: 'auto' } }),
    new TextRun({ text: '　部門会議 議事録まとめ', font: FONT, size: hp(XS), color: SUB }),
    ...(d.revised ? [new TextRun({ text: '　修正版', font: FONT, size: hp(XS), bold: true, color: 'B23A3A' })] : []),
    ...(total > 1 ? [new TextRun({ children: [new Tab(), `No. ${idx + 1} / ${total}`], font: FONT, size: hp(XS), color: SUB })] : []),
  ], S, {}, { tabStops: [{ type: TabStopType.RIGHT, position: CW }] }));
  // 会議名
  k.push(para([
    new TextRun({ text: d.title, font: FONT, size: hp(S * 1.75), bold: true, color: NAVY }),
    new TextRun({ text: `　${d.date}`, font: FONT, size: hp(S * 1.08), color: INK }),
  ], S * 1.75, { k: 1.4, before: 40, after: 60 }));
  // 会議情報
  const lab = (t: string) => cell([para(runs(t, { size: SM, color: SUB }), SM)], 1150, { fill: SOFT });
  const val = (t: string, w: number) => cell([para(runs(t, { size: SM }), SM)], w);
  const vw = Math.floor((CW - 2300) / 2);
  k.push(table([1150, vw, 1150, vw], [
    new TableRow({ children: [lab('開催日時'), val(d.date, vw), lab('場所'), val(d.place, vw)] }),
    new TableRow({ children: [lab('出席者'), val(d.attendees, vw), lab('記録者'), val(d.recorder, vw)] }),
  ]));
  if (d.purpose) {
    k.push(para([new TextRun({ text: '目的　', font: FONT, size: hp(SM), bold: true, color: NAVY }), ...runs(d.purpose, { size: SM })], SM, { before: 100 }));
  }
  // 概要
  const boxed = {
    border: { left: { style: BorderStyle.SINGLE, size: 24, color: NAVY, space: 6 } },
    shading: { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' }, indent: { left: 140, right: 60 },
  };
  k.push(para([new TextRun({ text: '概要', font: FONT, size: hp(XS), bold: true, color: NAVY })], XS, { before: 110 }, boxed));
  k.push(para(runs(d.summary || '（要約なし）'), S, { after: 20 }, boxed));

  // 決定事項
  if (d.decisions.length) {
    k.push(heading('決定事項', d.decisions.length));
    for (const x of d.decisions) {
      const tags = [x.owner && `担当：${x.owner}`, x.due && `期限：${x.due}`].filter(Boolean).join('／');
      k.push(new Paragraph({
        numbering: { reference: 'dec', level: 0, instance: idx },
        spacing: sp(S, { after: 30 }),
        children: [
          ...(x.title ? [new TextRun({ text: x.title, font: FONT, size: hp(S), bold: true, color: INK })] : []),
          ...(x.title && x.detail ? [new TextRun({ text: '　', font: FONT, size: hp(S) })] : []),
          ...runs(x.detail),
          ...(tags ? [new TextRun({ text: '　', font: FONT, size: hp(S) }), ...runs(`〔${tags}〕`, { size: XS, color: SUB })] : []),
        ],
      }));
    }
  }

  // ToDo
  if (d.todos.length) {
    k.push(heading('ToDo', d.todos.length));
    const hasSt = d.todos.some((t) => t.status);
    const wSt = 620;
    const wWho = 2500;
    const wDue = 2100;
    const wT = CW - wWho - wDue - (hasSt ? wSt : 0);
    const th = (t: string, w: number) => cell([para(runs(t, { size: SM, color: SUB }), SM)], w, { fill: SOFT });
    const rows = [new TableRow({ tableHeader: true, children: [...(hasSt ? [th('状況', wSt)] : []), th('内容', wT), th('担当', wWho), th('期限', wDue)] })];
    for (const t of d.todos) {
      const mark = t.status === 'done' ? '〇' : t.status === 'not_done' ? '×' : '';
      rows.push(new TableRow({ children: [
        ...(hasSt ? [cell([new Paragraph({ alignment: AlignmentType.CENTER, spacing: sp(SM), children: [
          new TextRun({ text: mark, font: FONT, size: hp(SM), bold: true, color: t.status === 'not_done' ? 'B23A3A' : '1E7A3C' })] })], wSt)] : []),
        val(t.task, wT), val(t.owner || '—', wWho), val(t.due || '—', wDue),
      ] }));
    }
    k.push(table(hasSt ? [wSt, wT, wWho, wDue] : [wT, wWho, wDue], rows));
    if (hasSt) k.push(para(runs('状況：議事録の記載どおり（〇＝済、×＝未）', { size: XS * 0.95, color: SUB }), XS, { before: 20 }));
  }

  // 継続審議・保留 ／ 報告・共有（2段）
  const boxes = ([['継続審議・保留', d.pending], ['報告・共有', d.reports]] as [string, string[]][]).filter(([, it]) => it.length);
  if (boxes.length) {
    const gap = 240;
    const bw = boxes.length === 2 ? Math.floor((CW - gap) / 2) : CW;
    const cells: TableCell[] = [];
    boxes.forEach(([title, items], bi) => {
      cells.push(cell([heading(title), ...items.map((x) => bullet(x, SM))], bw, { borders: allNone, margins: zero }));
      if (boxes.length === 2 && bi === 0) cells.push(cell([para([], SM)], gap, { borders: allNone, margins: zero }));
    });
    k.push(table(boxes.length === 2 ? [bw, gap, bw] : [bw], [new TableRow({ children: cells })]));
  }

  // 次回会議・要確認
  const stripLabel = (t: string, fill: string) => {
    const b = { ...thin, color: fill };
    return cell([para([new TextRun({ text: t, font: FONT, size: hp(SM), bold: true, color: 'FFFFFF' })], SM)], 1300,
      { fill, center: true, borders: { top: b, bottom: b, left: b, right: b } });
  };
  k.push(para([], 4, { before: 100 }));
  k.push(table([1300, CW - 1300], [new TableRow({ children: [stripLabel('次回会議', NAVY), val(d.next || '【要確認】', CW - 1300)] })]));
  if (d.checks.length) {
    const amber = { style: BorderStyle.SINGLE, size: 4, color: 'ECD28F' };
    k.push(para([], 4, { before: 70 }));
    k.push(table([1300, CW - 1300], [new TableRow({ children: [
      stripLabel('要確認', 'C98A00'),
      cell(d.checks.map((x) => bullet(x, SM)), CW - 1300, { fill: 'FFFBEF', borders: { top: amber, bottom: amber, left: amber, right: amber } }),
    ] })]));
  }

  const footer = new Footer({ children: [new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: CW }],
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 3 } },
    spacing: { line: 220, lineRule: LineRuleType.EXACT },
    children: [
      new TextRun({ text: `出典：会議DX「部門会議議事録」${d.id ? `（議事録ID ${d.id.slice(0, 8)}…）` : ''}　※生徒の氏名は省略`, font: FONT, size: 15, color: SUB }),
      new TextRun({ children: [new Tab(), `${d.createdAt} 作成`], font: FONT, size: 15, color: SUB }),
    ],
  })] });

  return {
    properties: { page: { size: { width: PAGE_W, height: PAGE_H },
      margin: { top: mm(10), bottom: mm(14 + safetyMm), left: MX, right: MX, header: mm(5), footer: mm(6) } } },
    footers: { default: footer },
    children: k,
  };
}

/**
 * 会議ごとに1ページの Word を作る。
 * safetyMm は下の余白を広げて「少し短いページ」で作る確認用（LibreOffice と Word の差の分の余裕を見るため）。
 */
export async function digestsDocx(items: DocxItem[], title: string, safetyMm = 0): Promise<Buffer> {
  const doc = new Document({
    creator: '会議DX',
    title,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    numbering: { config: [
      { reference: 'dec', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 360, hanging: 300 } }, run: { bold: true, color: NAVY, font: FONT } } }] },
      { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 260, hanging: 200 } }, run: { color: NAVY } } }] },
    ] },
    sections: items.map((it, i) => section(it.digest, it.size, i, items.length, safetyMm)),
  });
  return Packer.toBuffer(doc);
}
