// 智翔館AI の回答（Markdown）を、画面に出すための部品に分ける。ほかに依存しない。
//
// - 扱うのは、AIがよく使う形だけ：見出し（#）、段落、箇条書き（- / 1.）、表（| |）、コード枠（```）、引用（>）、区切り線（---）。
//   文中は **太字**、`コード`、[文字](URL)、そのままのURL。
// - HTMLとしては解釈しない（資料や回答の中の文字で画面が崩れたり、スクリプトが動いたりしないように）。画面側は文字として描く。
// - 回答は少しずつ届くので、途中の形（閉じていないコード枠、区切り行がまだ来ていない表）でも崩れないようにする。

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

/** marker は行頭に出す印（番号付きは元の番号「3.」、それ以外は「•」「◦」）。 */
export type ListItem = { level: number; marker: string; ordered: boolean; c: Inline[] };

export type Block =
  | { t: 'heading'; level: number; c: Inline[] }
  | { t: 'para'; lines: Inline[][] }
  | { t: 'list'; items: ListItem[] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; lines: Inline[][] }
  | { t: 'hr' };

// --- 文中（太字・コード・リンク） -------------------------------------------

/** 押せるリンクにしてよいURLか（http / https だけ）。 */
export function safeHref(u: string): string | null {
  return /^https?:\/\/[^\s<>"']+$/i.test(u) ? u : null;
}

// URLの末尾に付きがちな日本語の括弧・句読点は、URLに含めない。
const BARE_URL = /https?:\/\/[^\s<>"'）」』】、。，．)]+/g;

function pushText(out: Inline[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === 'text') last.v += v;
  else out.push({ t: 'text', v });
}

/** そのままのURLをリンクにする（文字の部分は text のまま）。 */
function linkifyBare(text: string, out: Inline[]) {
  let at = 0;
  for (const m of text.matchAll(BARE_URL)) {
    const i = m.index ?? 0;
    pushText(out, text.slice(at, i));
    const href = safeHref(m[0]);
    if (href) out.push({ t: 'link', href, c: [{ t: 'text', v: m[0] }] });
    else pushText(out, m[0]);
    at = i + m[0].length;
  }
  pushText(out, text.slice(at));
}

/** 1行の中の太字・コード・リンクを分ける。 */
export function parseInline(src: string, allowBold = true): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    linkifyBare(buf, out);
    buf = '';
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]|#>-]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (allowBold && ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'bold', c: parseInline(src.slice(i + 2, end), false) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '[') {
      const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m) {
        const href = safeHref(m[2]);
        flush();
        if (href) out.push({ t: 'link', href, c: parseInline(m[1], allowBold) });
        else out.push(...parseInline(m[1], allowBold));
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

// --- かたまり（見出し・表・箇条書きなど） -----------------------------------

const FENCE = /^\s*(```+|~~~+)\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** 表の1行をセルに分ける（\| は区切りにしない）。 */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += s[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

function isTableStart(lines: string[], i: number): boolean {
  return lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-');
}

function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i];
  return FENCE.test(l) || HEADING.test(l) || HR.test(l) || LIST_ITEM.test(l) || QUOTE.test(l) || isTableStart(lines, i);
}

/** Markdown を、画面に出すかたまりの並びにする。 */
export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    // コード枠。閉じていなければ（まだ届いていなければ）最後までを枠にする。
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(mark[0].repeat(3)) && lines[i].trim().replace(/[`~]/g, '') === '')) {
        body.push(lines[i]);
        i++;
      }
      i++; // 閉じの行
      blocks.push({ t: 'code', lang: fence[2] ?? '', v: body.join('\n') });
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ t: 'heading', level: h[1].length, c: parseInline(h[2]) });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(line).map((c) => parseInline(c));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const cells = splitRow(lines[i]).map((c) => parseInline(c));
        while (cells.length < head.length) cells.push([]);
        rows.push(cells.slice(0, Math.max(head.length, 1)));
        i++;
      }
      blocks.push({ t: 'table', head, rows });
      continue;
    }

    const li = LIST_ITEM.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const base = li[1].replace(/\t/g, '  ').length;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (m) {
          const indent = m[1].replace(/\t/g, '  ').length;
          const sameKind = /\d/.test(m[2]) === ordered;
          // 同じ深さで種類が変わったら、別の箇条書きにする
          if (indent <= base && !sameKind) break;
          const level = Math.max(0, Math.min(3, Math.floor((indent - base) / 2)));
          const num = /\d/.test(m[2]);
          items.push({ level, ordered: num, marker: num ? `${parseInt(m[2], 10)}.` : level === 0 ? '•' : '◦', c: parseInline(m[3]) });
          i++;
          continue;
        }
        // 字下げした続きの行は、直前の項目に足す
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length && !startsBlock(lines, i)) {
          const last = items[items.length - 1];
          const more: Inline[] = [...last.c];
          for (const n of [{ t: 'text', v: '\n' } as Inline, ...parseInline(lines[i].trim())]) {
            if (n.t === 'text') pushText(more, n.v);
            else more.push(n);
          }
          last.c = more;
          i++;
          continue;
        }
        break;
      }
      blocks.push({ t: 'list', items });
      continue;
    }

    const q = QUOTE.exec(line);
    if (q) {
      const ql: Inline[][] = [];
      while (i < lines.length) {
        const m = QUOTE.exec(lines[i]);
        if (!m) break;
        ql.push(parseInline(m[1]));
        i++;
      }
      blocks.push({ t: 'quote', lines: ql });
      continue;
    }

    // 段落。1行ずつの改行はそのまま残す（日本語の回答は1行ずつ書くことが多い）。
    const para: Inline[][] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines, i))) {
      para.push(parseInline(lines[i].trim()));
      i++;
    }
    blocks.push({ t: 'para', lines: para });
  }
  return blocks;
}

// --- コピー用の文字 -----------------------------------------------------------

function inlineText(c: Inline[]): string {
  return c
    .map((n) => {
      if (n.t === 'text' || n.t === 'code') return n.v;
      if (n.t === 'bold') return inlineText(n.c);
      const label = inlineText(n.c);
      return label === n.href ? n.href : `${label}（${n.href}）`;
    })
    .join('');
}

/**
 * 回答を、記号（** や #）を外した文字にする。LINE・メール・ドキュメントに貼るとき用。
 * 表はタブ区切り（スプレッドシートに貼ると列に分かれる）、コード枠は中身をそのまま。
 */
export function toPlainText(md: string): string {
  const out: string[] = [];
  for (const b of parseMarkdown(md)) {
    if (b.t === 'heading') out.push(`【${inlineText(b.c)}】`);
    else if (b.t === 'para' || b.t === 'quote') out.push(b.lines.map(inlineText).join('\n'));
    else if (b.t === 'list') {
      out.push(b.items.map((it) => `${'　'.repeat(it.level)}${it.ordered ? `${it.marker} ` : '・'}${inlineText(it.c)}`).join('\n'));
    } else if (b.t === 'table') {
      out.push([b.head, ...b.rows].map((r) => r.map(inlineText).join('\t')).join('\n'));
    } else if (b.t === 'code') out.push(b.v);
    else if (b.t === 'hr') out.push('――――――――');
  }
  return out.join('\n\n');
}
