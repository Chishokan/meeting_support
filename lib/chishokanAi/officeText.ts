// Word（.docx）・Excel（.xlsx）・PowerPoint（.pptx）から、AIに渡す文字を取り出す。
//
// - ブラウザ（添付したとき）でもサーバ（Googleドライブ上の Office ファイルを読むとき）でも同じものを使う。
// - Office の新しい形式は中身が XML の zip なので、jszip で開いて文字だけを拾う。書式・画像は捨てる。
// - 古い形式（.doc / .xls / .ppt）は読めない。新しい形式か PDF で保存し直してもらう。
// - 長い資料で AI の文脈を食いつぶさないよう、全体を MAX_CHARS で切る（切ったことは本文に書く）。

import JSZip from 'jszip';

export const MAX_CHARS = 60_000;
const MAX_ROWS_PER_SHEET = 300;
const MAX_COLS = 40;

export type OfficeKind = 'docx' | 'xlsx' | 'pptx';

/** ファイル名から種類を判定する。対応しない形式は null。 */
export function officeKind(name: string): OfficeKind | null {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  return ext === 'docx' || ext === 'xlsx' || ext === 'pptx' ? ext : null;
}

/** 古い Office 形式（読めないもの）なら true。画面で案内を出すのに使う。 */
export function isLegacyOffice(name: string): boolean {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  return ext === 'doc' || ext === 'xls' || ext === 'ppt';
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function tidy(s: string): string {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function cap(s: string): string {
  return s.length <= MAX_CHARS ? s : `${s.slice(0, MAX_CHARS)}\n\n（長いため ${MAX_CHARS} 文字で切りました）`;
}

async function readXml(zip: JSZip, path: string): Promise<string> {
  const f = zip.file(path);
  return f ? f.async('string') : '';
}

function byNumber(a: string, b: string): number {
  const na = Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0);
  const nb = Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0);
  return na - nb;
}

// --- Word ---------------------------------------------------------------

/** document.xml を文字にする。段落は改行、表のセルは「 | 」でつなぐ。 */
export function docxXmlToText(xml: string): string {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<\/w:p>|<\/w:tc>|<\/w:tr>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tok = m[0];
    if (m[1] !== undefined) out += decode(m[1]);
    else if (tok === '<w:tab/>') out += '\t';
    else if (tok === '<w:br/>') out += '\n';
    else if (tok === '</w:p>') out += '\n';
    else if (tok === '</w:tc>') out = out.replace(/\n$/, '') + ' | ';
    else if (tok === '</w:tr>') out = out.replace(/ \| $/, '') + '\n';
  }
  return tidy(out);
}

async function docxToText(zip: JSZip): Promise<string> {
  return docxXmlToText(await readXml(zip, 'word/document.xml'));
}

// --- PowerPoint -----------------------------------------------------------

/** スライド1枚の XML を文字にする。段落ごとに改行。 */
export function slideXmlToText(xml: string): string {
  let out = '';
  const re = /<a:t>([^<]*)<\/a:t>|<\/a:p>|<a:br\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) out += decode(m[1]);
    else out += '\n';
  }
  return tidy(out);
}

async function pptxToText(zip: JSZip): Promise<string> {
  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort(byNumber);
  const parts: string[] = [];
  for (const [i, path] of slides.entries()) {
    const body = slideXmlToText(await readXml(zip, path));
    // ノート（話す内容）があれば添える。スライドの rels からノートのファイルを探す。
    const rels = await readXml(zip, path.replace('slides/', 'slides/_rels/') + '.rels');
    const notesTarget = /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(rels)?.[1];
    const notes = notesTarget ? slideXmlToText(await readXml(zip, `ppt/notesSlides/${notesTarget}`)) : '';
    // ノートにはスライド番号だけが入っていることが多いので、数字だけのものは捨てる。
    const notesText = notes && !/^\d+$/.test(notes) ? `\n（ノート）${notes}` : '';
    parts.push(`## スライド ${i + 1}\n${body || '（文字なし）'}${notesText}`);
  }
  return parts.join('\n\n');
}

// --- Excel ----------------------------------------------------------------

/** "AB12" → 列番号（0始まり）。 */
export function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    // ふりがな（<rPh>）は除く
    const body = m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    const texts = [...body.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decode(t[1]));
    out.push(texts.join(''));
  }
  return out;
}

/** シート1枚の XML を、タブ区切りの行の配列にする。 */
export function sheetXmlToRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml)) && rows.length < MAX_ROWS_PER_SHEET) {
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1];
      const inner = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const col = ref ? colIndex(ref) : cells.length;
      if (col >= MAX_COLS) continue;
      let v = '';
      if (type === 'inlineStr') {
        v = [...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decode(t[1])).join('');
      } else {
        const raw = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
        if (raw !== undefined) v = type === 's' ? strings[Number(raw)] ?? '' : type === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : decode(raw);
      }
      while (cells.length < col) cells.push('');
      cells[col] = v.replace(/[\t\n]+/g, ' ');
    }
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    if (cells.length) rows.push(cells);
  }
  return rows;
}

async function xlsxToText(zip: JSZip): Promise<string> {
  const wb = await readXml(zip, 'xl/workbook.xml');
  const rels = await readXml(zip, 'xl/_rels/workbook.xml.rels');
  const strings = sharedStrings(await readXml(zip, 'xl/sharedStrings.xml'));
  const target = new Map<string, string>();
  for (const r of rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) target.set(r[1], r[2]);
  const parts: string[] = [];
  for (const s of wb.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = decode(/\bname="([^"]*)"/.exec(s[1])?.[1] ?? '');
    const rid = /\br:id="([^"]+)"/.exec(s[1])?.[1] ?? '';
    const t = target.get(rid);
    if (!t) continue;
    const path = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
    const rows = sheetXmlToRows(await readXml(zip, path), strings);
    const note = rows.length >= MAX_ROWS_PER_SHEET ? `\n（${MAX_ROWS_PER_SHEET}行で切りました）` : '';
    parts.push(`## シート「${name}」\n${rows.map((r) => r.join('\t')).join('\n') || '（空）'}${note}`);
  }
  return parts.join('\n\n') + '\n\n（日付は数値で表示されることがあります）';
}

// --- まとめ ---------------------------------------------------------------

/** Office ファイルの中身（ArrayBuffer など）から文字を取り出す。読めなければ例外。 */
export async function officeToText(kind: OfficeKind, data: ArrayBuffer | Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const text = kind === 'docx' ? await docxToText(zip) : kind === 'pptx' ? await pptxToText(zip) : await xlsxToText(zip);
  return cap(text || '（文字が見つかりませんでした）');
}
