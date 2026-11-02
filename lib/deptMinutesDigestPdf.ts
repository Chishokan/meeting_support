// 議事録の1枚まとめ（Digest）を A4 の PDF にする。サーバ専用（pdfkit）。
// 見た目は「部門会議 議事録まとめ」（2026/11 に社長へ配った PDF）に合わせている。
//
// - 1会議を A4 1枚に収める。収まる一番大きい文字（10pt〜7.5pt）を試して選ぶ。
//   7.5pt でも収まらない長い議事録だけ、2枚目以降に続ける。
// - 日本語フォントは assets/fonts/ の Noto Sans JP（SIL OFL）。Vercel の関数に同梱するため
//   next.config.mjs の outputFileTracingIncludes に載せてある（★置き場所を変えたらそちらも直す）。
// - テスト: lib/deptMinutesDigestPdf.test.ts（1枚に収まること・PDF として読めること）

import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Digest } from './deptMinutesDigest';

type Doc = PDFKit.PDFDocument;

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');
let fontCache: { regular: Buffer; bold: Buffer } | null = null;

/** フォントを読む（関数のインスタンス内では1回だけ）。 */
export function loadFonts(dir = FONT_DIR): { regular: Buffer; bold: Buffer } {
  if (fontCache && dir === FONT_DIR) return fontCache;
  const fonts = {
    regular: readFileSync(path.join(dir, 'NotoSansJP-Regular.ttf')),
    bold: readFileSync(path.join(dir, 'NotoSansJP-Bold.ttf')),
  };
  if (dir === FONT_DIR) fontCache = fonts;
  return fonts;
}

// ---- 色・寸法（pt。A4 = 595.28 × 841.89） ----
const C = {
  ink: '#1d2433',
  sub: '#5a6375',
  line: '#d5dae3',
  soft: '#f3f5f9',
  navy: '#1f3a5f',
  amber: '#c98a00',
  amberBg: '#fffbef',
  amberLine: '#ecd28f',
  warnInk: '#9a6700',
  ok: '#1e7a3c',
  ng: '#b23a3a',
};
const DEPT_COLOR: Record<string, string> = {
  英検: '#16707a',
  RED個別: '#a83838',
  小中等部: '#2a5aa8',
  LEC: '#5b4a9e',
  高等部: '#5b4a9e',
};
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MX = 34; // 左右の余白（12mm）
const TOP = 30;
const BOTTOM = 46; // 本文の下限（下に出典の行を置く）
const W = PAGE_W - MX * 2;

const SIZES = [10, 9.5, 9, 8.75, 8.5, 8.25, 8, 7.75, 7.5];

const UNKNOWN_RE = /(【要確認】)/;
// Noto Sans JP に無い記号の置き換え（無い字は空白の四角になるため）。
const REPLACE: Record<string, string> = { '✕': '×', '✖': '×', '❌': '×', '✔': '〇', '✓': '〇', '⭕': '〇' };

type Seg = { text: string; bold?: boolean; color?: string };

class Layout {
  doc: Doc;
  s: number; // 基準の文字サイズ
  y = TOP;
  private glyph: ((cp: number) => boolean) | null = null;

  constructor(doc: Doc, s: number) {
    this.doc = doc;
    this.s = s;
    doc.font('R');
    // フォントに無い字を落とすための判定（pdfkit の内部の fontkit フォントを使う。無ければ判定しない）。
    const f = (doc as unknown as { _font?: { font?: { hasGlyphForCodePoint?: (cp: number) => boolean } } })._font?.font;
    if (f && typeof f.hasGlyphForCodePoint === 'function') this.glyph = (cp) => f.hasGlyphForCodePoint!(cp);
  }

  get lineGap() {
    return this.s * 0.12;
  }
  get maxY() {
    return PAGE_H - BOTTOM;
  }

  clean(t: string): string {
    let out = '';
    for (const ch of String(t ?? '')) {
      const r = REPLACE[ch];
      if (r !== undefined) out += r;
      else if (ch === '\n' || ch === '\t') out += ' ';
      else if (!this.glyph || this.glyph(ch.codePointAt(0)!)) out += ch;
    }
    return out;
  }

  /** 【要確認】を目立つ色の区切りにした文字列の並び。 */
  segs(text: string, base: Omit<Seg, 'text'> = {}): Seg[] {
    return this.clean(text)
      .split(UNKNOWN_RE)
      .filter(Boolean)
      .map((p) => (p === '【要確認】' ? { text: p, bold: true, color: C.warnInk } : { text: p, ...base }));
  }

  height(segs: Seg[], width: number, size: number): number {
    const text = segs.map((x) => x.text).join('');
    if (!text) return 0;
    // 太字が混じるときは太字で測る（少し高めに出るほうが、背景の箱からはみ出さない）。
    this.doc.font(segs.some((x) => x.bold) ? 'B' : 'R').fontSize(size);
    return this.doc.heightOfString(text, { width, lineGap: this.lineGap });
  }

  /** 文字の並びを (x, y) から幅 width で書く。書き終えた下端の y を返す。 */
  write(segs: Seg[], x: number, y: number, width: number, size: number): number {
    const list = segs.filter((x) => x.text);
    if (!list.length) return y;
    list.forEach((sg, i) => {
      this.doc.font(sg.bold ? 'B' : 'R').fontSize(size).fillColor(sg.color ?? C.ink);
      const opts = { width, lineGap: this.lineGap, continued: i < list.length - 1 };
      if (i === 0) this.doc.text(sg.text, x, y, opts);
      else this.doc.text(sg.text, opts);
    });
    return this.doc.y;
  }

  /** 残りに h が入らなければ改ページ。 */
  need(h: number) {
    if (this.y + h > this.maxY) {
      this.doc.addPage();
      this.y = TOP;
    }
  }

  gap(k = 0.55) {
    this.y += this.s * k;
  }

  heading(title: string, count?: number) {
    const s = this.s * 1.02;
    const h = s * 1.5;
    this.need(h + this.s * 3); // 見出しだけがページの最後に残らないように
    this.doc.rect(MX, this.y + 1, 2.6, s * 1.25).fill(C.navy);
    this.doc.font('B').fontSize(s).fillColor(C.navy).text(title, MX + 7, this.y, { lineBreak: false });
    if (count !== undefined) {
      const w = this.doc.widthOfString(title);
      this.doc.font('R').fontSize(this.s * 0.8).fillColor(C.sub)
        .text(`${count}件`, MX + 7 + w + 5, this.y + s * 0.22, { lineBreak: false });
    }
    this.y += h;
  }
}

function header(L: Layout, d: Digest) {
  const { doc, s } = L;
  const xs = s * 0.82;
  // 部門のバッジ
  doc.font('B').fontSize(xs);
  const dept = L.clean(d.dept);
  const bw = doc.widthOfString(dept) + 10;
  const bh = xs * 1.6;
  const color = Object.entries(DEPT_COLOR).find(([k]) => dept.includes(k))?.[1] ?? C.navy;
  doc.roundedRect(MX, L.y, bw, bh, 2).fill(color);
  doc.fillColor('#ffffff').text(dept, MX + 5, L.y + bh * 0.16, { lineBreak: false });
  doc.font('R').fontSize(xs).fillColor(C.sub).text('部門会議 議事録まとめ', MX + bw + 7, L.y + bh * 0.16, { lineBreak: false });
  if (d.revised) {
    doc.font('B').fontSize(xs);
    const t = '修正版';
    const rw = doc.widthOfString(t) + 10;
    doc.roundedRect(PAGE_W - MX - rw, L.y, rw, bh, 2).fill(C.ng);
    doc.fillColor('#ffffff').text(t, PAGE_W - MX - rw + 5, L.y + bh * 0.16, { lineBreak: false });
  }
  L.y += bh + s * 0.5;

  // 会議名と開催日時（1行に入らなければ日時は次の行）
  const ts = s * 1.75;
  const ds = s * 1.08;
  const title = L.clean(d.title);
  const date = L.clean(d.date);
  doc.font('B').fontSize(ts);
  const tw = doc.widthOfString(title);
  doc.font('R').fontSize(ds);
  const dw = doc.widthOfString(date);
  if (tw + 8 + dw <= W) {
    doc.font('B').fontSize(ts).fillColor(C.navy).text(title, MX, L.y, { lineBreak: false });
    doc.font('R').fontSize(ds).fillColor(C.ink).text(date, MX + tw + 8, L.y + (ts - ds) * 0.78, { lineBreak: false });
    L.y += ts * 1.45;
  } else {
    doc.font('B').fontSize(ts).fillColor(C.navy).text(title, MX, L.y, { width: W });
    L.y = doc.y;
    doc.font('R').fontSize(ds).fillColor(C.ink).text(date, MX, L.y, { width: W });
    L.y = doc.y + s * 0.3;
  }

  // 会議情報（2行×4列）
  const sm = s * 0.9;
  const lw = sm * 4.6;
  const vw = (W - lw * 2) / 2;
  const pad = 2.5;
  const rows: [string, string, string, string][] = [
    ['開催日時', d.date, '場所', d.place],
    ['出席者', d.attendees, '記録者', d.recorder],
  ];
  doc.rect(MX, L.y, W, 1.4).fill(C.navy);
  L.y += 1.4;
  for (const [l1, v1, l2, v2] of rows) {
    const h = Math.max(L.height(L.segs(v1), vw - pad * 2, sm), L.height(L.segs(v2), vw - pad * 2, sm), sm * 1.45) + pad * 2;
    const cells: [number, number, string, boolean][] = [
      [MX, lw, l1, true], [MX + lw, vw, v1, false], [MX + lw + vw, lw, l2, true], [MX + lw * 2 + vw, vw, v2, false],
    ];
    for (const [x, w, t, isLabel] of cells) {
      if (isLabel) doc.rect(x, L.y, w, h).fill(C.soft);
      L.write(L.segs(t, isLabel ? { color: C.sub } : {}), x + pad + 1, L.y + pad, w - pad * 2 - 1, sm);
    }
    doc.moveTo(MX, L.y + h).lineTo(MX + W, L.y + h).lineWidth(0.5).strokeColor(C.line).stroke();
    L.y += h;
  }
  L.gap(0.7);
}

function summaryBox(L: Layout, d: Digest) {
  const { doc, s } = L;
  if (d.purpose) {
    const segs = [{ text: '目的　', bold: true, color: C.navy }, ...L.segs(d.purpose)];
    L.need(L.height(segs, W, s * 0.92));
    L.y = L.write(segs, MX, L.y, W, s * 0.92);
    L.gap(0.45);
  }
  const pad = s * 0.6;
  const label = s * 0.8;
  const segs = L.segs(d.summary || '（要約なし）');
  const h = label * 1.5 + L.height(segs, W - 14 - pad, s) + pad * 2;
  L.need(h);
  doc.rect(MX, L.y, W, h).fill(C.soft);
  doc.rect(MX, L.y, 3.2, h).fill(C.navy);
  doc.font('B').fontSize(label).fillColor(C.navy).text('概要', MX + 12, L.y + pad, { lineBreak: false });
  L.write(segs, MX + 12, L.y + pad + label * 1.5, W - 14 - pad, s);
  L.y += h;
  L.gap(0.8);
}

function decisions(L: Layout, d: Digest) {
  if (!d.decisions.length) return;
  const { s } = L;
  L.heading('決定事項', d.decisions.length);
  const ind = s * 1.6;
  d.decisions.forEach((x, i) => {
    const tags = [x.owner && `担当：${x.owner}`, x.due && `期限：${x.due}`].filter(Boolean).join('／');
    const segs: Seg[] = [
      ...(x.title ? L.segs(x.title, { bold: true }) : []),
      ...(x.title && x.detail ? [{ text: '　' }] : []),
      ...L.segs(x.detail),
      ...(tags ? [{ text: '　' }, ...L.segs(`〔${tags}〕`, { color: C.sub })] : []),
    ];
    const h = L.height(segs, W - ind, s);
    L.need(h);
    L.doc.font('B').fontSize(s).fillColor(C.navy).text(`${i + 1}.`, MX + 2, L.y, { lineBreak: false });
    L.y = L.write(segs, MX + ind, L.y, W - ind, s) + s * 0.3;
  });
  L.gap(0.5);
}

function table(L: Layout, head: string[], widths: number[], rows: { cells: Seg[][]; align?: ('left' | 'center')[] }[], size: number) {
  const { doc } = L;
  const pad = 2.6;
  const draw = (cells: Seg[][], fill: string | null, align?: ('left' | 'center')[]) => {
    const h = Math.max(size * 1.45, ...cells.map((c, i) => L.height(c, widths[i] - pad * 2, size))) + pad * 2;
    L.need(h);
    let x = MX;
    cells.forEach((c, i) => {
      if (fill) doc.rect(x, L.y, widths[i], h).fill(fill);
      doc.rect(x, L.y, widths[i], h).lineWidth(0.5).strokeColor(C.line).stroke();
      if (align?.[i] === 'center') {
        const t = c.map((z) => z.text).join('');
        doc.font(c[0]?.bold ? 'B' : 'R').fontSize(size).fillColor(c[0]?.color ?? C.ink)
          .text(t, x, L.y + pad, { width: widths[i], align: 'center', lineBreak: false });
      } else {
        L.write(c, x + pad, L.y + pad, widths[i] - pad * 2, size);
      }
      x += widths[i];
    });
    L.y += h;
  };
  draw(head.map((t) => [{ text: t, color: C.sub }]), C.soft);
  for (const r of rows) draw(r.cells, null, r.align);
}

function todos(L: Layout, d: Digest) {
  if (!d.todos.length) return;
  const { s } = L;
  L.heading('ToDo', d.todos.length);
  const size = s * 0.9;
  const hasSt = d.todos.some((t) => t.status);
  const stW = size * 2.8;
  const whoW = W * 0.25;
  const dueW = W * 0.2;
  const taskW = W - whoW - dueW - (hasSt ? stW : 0);
  const head = [...(hasSt ? ['状況'] : []), '内容', '担当', '期限'];
  const widths = [...(hasSt ? [stW] : []), taskW, whoW, dueW];
  const rows = d.todos.map((t) => {
    const mark: Seg[] = t.status === 'done' ? [{ text: '〇', bold: true, color: C.ok }]
      : t.status === 'not_done' ? [{ text: '×', bold: true, color: C.ng }] : [{ text: '' }];
    return {
      cells: [...(hasSt ? [mark] : []), L.segs(t.task), L.segs(t.owner || '—'), L.segs(t.due || '—')],
      align: hasSt ? (['center', 'left', 'left', 'left'] as ('left' | 'center')[]) : undefined,
    };
  });
  table(L, head, widths, rows, size);
  if (hasSt) {
    L.y += 2;
    L.write([{ text: '状況：議事録の記載どおり（〇＝済、×＝未）', color: C.sub }], MX, L.y, W, s * 0.75);
    L.y = L.doc.y;
  }
  L.gap(0.6);
}

function bullets(L: Layout, items: string[], x: number, y: number, width: number, size: number, draw: boolean): number {
  const ind = size * 1.1;
  let yy = y;
  for (const it of items) {
    const segs = L.segs(it);
    const h = L.height(segs, width - ind, size);
    if (draw) {
      L.doc.font('B').fontSize(size).fillColor(C.navy).text('•', x + 1, yy, { lineBreak: false });
      L.write(segs, x + ind, yy, width - ind, size);
    }
    yy += h + size * 0.25;
  }
  return yy - y;
}

function lists(L: Layout, d: Digest) {
  const { s } = L;
  const size = s * 0.9;
  const boxes = [
    ['継続審議・保留', d.pending],
    ['報告・共有', d.reports],
  ].filter(([, items]) => (items as string[]).length) as [string, string[]][];
  if (!boxes.length) return;
  const headH = s * 1.02 * 1.5;
  if (boxes.length === 2) {
    const gapX = 14;
    const cw = (W - gapX) / 2;
    const h = headH + Math.max(...boxes.map(([, it]) => bullets(L, it, 0, 0, cw, size, false)));
    if (L.y + h <= L.maxY) {
      const top = L.y;
      boxes.forEach(([title, items], i) => {
        const x = MX + i * (cw + gapX);
        L.doc.rect(x, top + 1, 2.6, s * 1.02 * 1.25).fill(C.navy);
        L.doc.font('B').fontSize(s * 1.02).fillColor(C.navy).text(title, x + 7, top, { lineBreak: false });
        bullets(L, items, x, top + headH, cw, size, true);
      });
      L.y = top + h;
      L.gap(0.5);
      return;
    }
  }
  // 1段で書く（片方しか無いとき・2段では残りに入らないとき）
  for (const [title, items] of boxes) {
    L.heading(title);
    for (const it of items) {
      const h = bullets(L, [it], MX, L.y, W, size, false);
      L.need(h);
      L.y += bullets(L, [it], MX, L.y, W, size, true);
    }
    L.gap(0.4);
  }
}

function strip(L: Layout, label: string, body: Seg[][] | Seg[], tone: 'navy' | 'amber') {
  const { doc, s } = L;
  const size = s * 0.9;
  const lw = size * 6.2;
  const pad = 3;
  const vw = W - lw;
  const isList = Array.isArray(body[0]);
  const items = (isList ? body : [body]) as Seg[][];
  const ind = isList ? size * 1.1 : 0;
  const hs = items.map((it) => L.height(it, vw - pad * 2 - ind, size));
  const h = Math.max(size * 1.5, hs.reduce((a, b) => a + b, 0) + (items.length - 1) * size * 0.2) + pad * 2;
  L.need(h);
  const bg = tone === 'navy' ? C.navy : C.amber;
  doc.rect(MX, L.y, lw, h).fill(bg);
  if (tone === 'amber') doc.rect(MX + lw, L.y, vw, h).fill(C.amberBg);
  doc.rect(MX, L.y, W, h).lineWidth(0.5).strokeColor(tone === 'navy' ? C.line : C.amberLine).stroke();
  doc.font('B').fontSize(size).fillColor('#ffffff').text(label, MX + 6, L.y + h / 2 - size * 0.75, { lineBreak: false });
  let yy = L.y + pad;
  items.forEach((it, i) => {
    if (isList) doc.font('B').fontSize(size).fillColor(C.warnInk).text('•', MX + lw + pad + 1, yy, { lineBreak: false });
    L.write(it, MX + lw + pad + ind, yy, vw - pad * 2 - ind, size);
    yy += hs[i] + size * 0.2;
  });
  L.y += h;
  L.gap(0.45);
}

function footer(doc: Doc, d: Digest, s: number) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // 下の余白に書くと pdfkit が改ページしてしまうので、一時的に余白を外す。
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = PAGE_H - 30;
    doc.moveTo(MX, y - 4).lineTo(PAGE_W - MX, y - 4).lineWidth(0.4).strokeColor(C.line).stroke();
    const fs = Math.min(7.5, s * 0.78);
    const id = d.id ? `（議事録ID ${d.id.slice(0, 8)}…）` : '';
    doc.font('R').fontSize(fs).fillColor(C.sub)
      .text(`出典：会議DX「部門会議議事録」${id}　※生徒の氏名は省略`, MX, y, { lineBreak: false });
    const right = `${d.createdAt} 作成${range.count > 1 ? `　${i - range.start + 1} / ${range.count}` : ''}`;
    const rw = doc.widthOfString(right);
    doc.text(right, PAGE_W - MX - rw, y, { lineBreak: false });
    doc.page.margins.bottom = keep;
  }
}

function build(d: Digest, s: number, fonts: { regular: Buffer; bold: Buffer }): Doc {
  // 既定フォントに Noto を渡す（pdfkit 標準の Helvetica はデータファイルを読むので使わない）。
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: TOP, bottom: BOTTOM, left: MX, right: MX },
    bufferPages: true,
    font: fonts.regular as unknown as string,
    info: { Title: `議事録まとめ ${d.title} ${d.date}`, Author: '会議DX', Subject: '部門会議 議事録まとめ' },
  });
  doc.registerFont('R', fonts.regular);
  doc.registerFont('B', fonts.bold);
  const L = new Layout(doc, s);
  header(L, d);
  summaryBox(L, d);
  decisions(L, d);
  todos(L, d);
  lists(L, d);
  strip(L, '次回会議', L.segs(d.next || '【要確認】'), 'navy');
  if (d.checks.length) strip(L, '要確認', d.checks.map((c) => L.segs(c)), 'amber');
  footer(doc, d, s);
  return doc;
}

function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export type DigestPdf = { pdf: Buffer; pages: number; fontSize: number };

/** 1枚に収まる一番大きい文字で PDF を作る。どの大きさでも収まらなければ最小の文字で複数枚にする。 */
export async function renderDigestPdf(d: Digest, fonts = loadFonts()): Promise<DigestPdf> {
  let last: { doc: Doc; s: number } | null = null;
  for (const s of SIZES) {
    const doc = build(d, s, fonts);
    const pages = doc.bufferedPageRange().count;
    if (pages === 1) return { pdf: await toBuffer(doc), pages, fontSize: s };
    if (last) last.doc.end();
    last = { doc, s };
  }
  const { doc, s } = last!;
  const pages = doc.bufferedPageRange().count;
  return { pdf: await toBuffer(doc), pages, fontSize: s };
}
