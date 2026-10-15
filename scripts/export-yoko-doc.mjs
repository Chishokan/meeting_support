/**
 * Google ドキュメント（documents.get の JSON）を、タブごとの Markdown に書き出す。
 * 要項テンプレートのドキュメント（04要項 フォルダ）を取り込むときに使う。
 *
 *   node scripts/export-yoko-doc.mjs <documents.get の JSON> <出力ディレクトリ> [--list]
 *
 *   --list  書き出さず、タブ名・講座名・ステータスの一覧だけ出す
 *
 * 出力は「タブ名.md」。テンプレート本体のタブ（名前が _ で始まる／「テンプレ」を含む）は飛ばす。
 * 書き出した Markdown は、そのまま import-yoko.mjs に渡せる形（## ＜…＞ 見出し＋箇条書き）。
 *
 * JSON の取り方: Google Docs コネクタの read_doc、または Docs API の documents.get。
 * 「ファイル > ダウンロード > Markdown」で落とした場合は、このスクリプトは不要で、
 * 直接 import-yoko.mjs に渡せる（ただしタブは1つずつ）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [src, outDir, flag] = process.argv.slice(2);
if (!src || (!outDir && flag !== '--list' && process.argv[3] !== '--list')) {
  console.error('使い方: node scripts/export-yoko-doc.mjs <JSON> <出力ディレクトリ> [--list]');
  process.exit(1);
}
const listOnly = process.argv.includes('--list');

const raw = JSON.parse(readFileSync(src, 'utf8'));
const doc = raw.content ?? raw;

function isTemplateTab(title) {
  return /^[_＿]/.test(title) || title.includes('テンプレ');
}

function flattenTabs(tabs) {
  const out = [];
  for (const t of tabs ?? []) {
    if (t.documentTab) out.push(t);
    out.push(...flattenTabs(t.childTabs));
  }
  return out;
}

function runText(el) {
  if (el.textRun) {
    let t = el.textRun.content ?? '';
    const url = el.textRun.textStyle?.link?.url;
    // リンクは URL を本文に残す（AIが申込ページを答えられるように）
    if (url && !t.includes(url)) t = t.replace(/\n$/, '') + `（${url}）` + (t.endsWith('\n') ? '\n' : '');
    return t;
  }
  if (el.horizontalRule) return '';
  return '';
}

function paragraphToMd(p, lists) {
  const text = (p.elements ?? []).map(runText).join('').replace(/\n$/, '');
  const style = p.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT';
  if (p.bullet) {
    const level = p.bullet.nestingLevel ?? 0;
    const listId = p.bullet.listId;
    const glyph = lists?.[listId]?.listProperties?.nestingLevels?.[level]?.glyphType;
    const ordered = glyph && /DECIMAL|ALPHA|ROMAN/.test(glyph);
    return `${'  '.repeat(level)}${ordered ? '1.' : '-'} ${text}`;
  }
  if (!text.trim()) return '';
  switch (style) {
    case 'TITLE':
    case 'HEADING_1':
      // 本文に見出し1は使わない約束だが、使われていたら見出し2に落とす（取り込みで別要項に割れないように）
      return `## ${text}`;
    case 'HEADING_2':
      return `## ${text}`;
    case 'HEADING_3':
      return `### ${text}`;
    case 'HEADING_4':
    case 'HEADING_5':
    case 'HEADING_6':
      return `#### ${text}`;
    default:
      return text;
  }
}

function tableToMd(table) {
  const rows = (table.tableRows ?? []).map((r) =>
    (r.tableCells ?? []).map((c) =>
      (c.content ?? [])
        .map((e) => (e.paragraph ? (e.paragraph.elements ?? []).map(runText).join('').replace(/\n$/, '') : ''))
        .join(' ')
        .trim()
    )
  );
  if (!rows.length) return '';
  const w = Math.max(...rows.map((r) => r.length));
  const line = (r) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), `| ${Array.from({ length: w }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

function tabToMd(tab) {
  const body = tab.documentTab.body?.content ?? [];
  const lists = tab.documentTab.lists ?? {};
  const out = [];
  let prevBullet = false;
  for (const el of body) {
    if (el.paragraph) {
      const md = paragraphToMd(el.paragraph, lists);
      const isBullet = Boolean(el.paragraph.bullet);
      if (md === '') {
        if (out.length && out[out.length - 1] !== '') out.push('');
      } else {
        // 見出しの前後、箇条書きと本文の境目に空行を入れて Markdown として読みやすくする
        if (/^#{2,4} /.test(md) && out.length && out[out.length - 1] !== '') out.push('');
        if (!isBullet && prevBullet && out[out.length - 1] !== '') out.push('');
        out.push(md);
        if (/^#{2,4} /.test(md)) out.push('');
      }
      prevBullet = isBullet;
    } else if (el.table) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(tableToMd(el.table), '');
      prevBullet = false;
    }
  }
  let md = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  // テンプレートを複製したタブには、冒頭の「この文書の使い方」「記入ルール」が残っていることがある。
  // 要項の本文ではないので、最初の「## ＜基本情報＞」より前は落とす。
  const start = md.search(/^## ＜基本情報＞/m);
  if (start > 0) md = md.slice(start);
  return md;
}

// 「  - 講座名：…」から値を取る（import-yoko.mjs と同じ規則）
function fieldOf(md, label) {
  const re = new RegExp(`^[ \\t\\u3000\\-*・]*\\*{0,2}${label}\\*{0,2}[ \\t\\u3000]*[：:][ \\t\\u3000]*(.*)$`, 'm');
  const m = re.exec(md);
  return m ? m[1].replace(/←.*$/, '').replace(/\*/g, '').trim() : '';
}

const tabs = flattenTabs(doc.tabs);
if (!listOnly) mkdirSync(outDir, { recursive: true });
const rows = [];
for (const tab of tabs) {
  const title = tab.tabProperties?.title ?? '';
  const md = tabToMd(tab);
  const name = fieldOf(md, '講座名');
  const statusRaw = fieldOf(md, 'ステータス');
  const status = statusRaw.includes('確定') ? '確定' : '下書き';
  const template = isTemplateTab(title) || !name || /（例/.test(name);
  rows.push({ title, name, status, statusRaw, template, chars: md.length });
  if (!listOnly && !template) {
    const file = join(outDir, `${title.replace(/[\\/:*?"<>|#]/g, '').replace(/[\s　]+/g, '_')}.md`);
    writeFileSync(file, md, 'utf8');
  }
}
for (const r of rows) {
  console.log(
    `${r.template ? 'skip ' : r.status === '確定' ? '確定 ' : '下書き'}  ${r.title}  ${r.name ? '／ ' + r.name : ''}${
      r.statusRaw && r.statusRaw !== r.status ? '  [' + r.statusRaw + ']' : ''
    }  (${r.chars}字)`
  );
}
