// AI壁打ちの「行動計画の案」を Word ファイル（A4 縦）にする。サーバ専用。
// 秋～冬行動計画と同じ「日付・区分・行動・○✕」の並びで、○✕の欄は空けておく（印刷して手で付けられる）。

import {
  AlignmentType, BorderStyle, Document, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { PLAN_KINDS, type CoachPlan } from './taskCoach';

const FONT = 'Yu Gothic';
const NAVY = '1F4E78';
const GRID = { style: BorderStyle.SINGLE, size: 4, color: 'A6A6A6' };
const BORDERS = { top: GRID, bottom: GRID, left: GRID, right: GRID };
const WIDTHS = [1300, 1000, 6000, 900]; // 日付・区分・行動・○✕（合計 9200 = A4 縦の本文幅）

const run = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) =>
  new TextRun({ text, font: FONT, size: o.size ?? 21, bold: o.bold, color: o.color });
const para = (text: string, o: { bold?: boolean; size?: number; color?: string; before?: number; after?: number } = {}) =>
  new Paragraph({ children: [run(text, o)], spacing: { before: o.before ?? 0, after: o.after ?? 80 } });
const cell = (text: string, w: number, head = false) => new TableCell({
  width: { size: w, type: WidthType.DXA },
  borders: BORDERS,
  shading: head ? { fill: 'D9E2F3', type: ShadingType.CLEAR, color: 'auto' } : undefined,
  margins: { top: 60, bottom: 60, left: 100, right: 100 },
  children: [new Paragraph({ alignment: head ? AlignmentType.CENTER : AlignmentType.LEFT, children: [run(text, { bold: head })] })],
});

export async function planDocx(o: {
  school: string; itemLabel: string; author: string; today: string; plan: CoachPlan; dateOrder: string[];
}): Promise<Buffer> {
  const order = (d: string) => o.dateOrder.indexOf(d);
  const actions = [...o.plan.actions].sort((a, b) =>
    order(a.date) - order(b.date) || PLAN_KINDS.indexOf(a.kind) - PLAN_KINDS.indexOf(b.kind));
  const table = new Table({
    width: { size: WIDTHS.reduce((x, y) => x + y, 0), type: WidthType.DXA },
    columnWidths: WIDTHS,
    rows: [
      new TableRow({ tableHeader: true, children: ['日付', '区分', '行動', '○✕'].map((t, i) => cell(t, WIDTHS[i], true)) }),
      ...actions.map((a) => new TableRow({ children: [a.date, a.kind, a.text, ''].map((t, i) => cell(t, WIDTHS[i])) })),
    ],
  });
  const doc = new Document({
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1350, right: 1350 } } },
      children: [
        para(`${o.school}　行動計画の案（AI壁打ち）`, { bold: true, size: 32, color: NAVY, after: 120 }),
        para(`作成：${o.today}　${o.author}　／　相談した項目：${o.itemLabel}`, { size: 19, after: 200 }),
        para('週間目標', { bold: true, color: NAVY }),
        para(o.plan.goal || '（なし）', { after: 200 }),
        para('相談のまとめ', { bold: true, color: NAVY }),
        para(o.plan.summary || '（なし）', { after: 200 }),
        para('行動', { bold: true, color: NAVY }),
        table,
        para('生徒・保護者の名前はイニシャルで書いています。この案は校舎の行動計画づくりに使い、人事評価には使いません。', { size: 17, color: '666666', before: 200 }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
