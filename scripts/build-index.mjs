/**
 * knowledge/00_index/INDEX.md を、各ファイルの front matter から作り直す。
 *
 *   npm run index            … INDEX.md を書き直す
 *   npm run index -- --check … 書き直さずに、INDEX.md が最新かだけ確かめる（古ければ終了コード 1）
 *
 * 手で書く索引は、ファイルを足したときや updated を直したときに必ずずれる。
 * knowledge/ を直したら、最後にこれを流して INDEX.md も一緒にコミットする。
 *
 * 載せないもの：
 * - 00_index/ のファイル（索引・案内そのもの）
 * - 05_作業/（作業の手順書。一覧は智翔館AIのシステムプロンプトと画面のボタンに別に出す）
 * - 名前が _ で始まるファイル・フォルダ（テンプレート、旧要項、統合前の原本）
 * - 90_archive/（参照はできるが、AIが最初に開く候補にはしない）
 * - status があって「確定」でないもの（要項の下書き。案の料金や日付をAIに拾わせない）
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = 'knowledge';
const OUT = join(ROOT, '00_index', 'INDEX.md');
const SKIP_DIRS = new Set(['00_index', '05_作業', '90_archive']);

// lib/core/knowledgeDocs.ts と同じ素朴な読み方（「key: value   # コメント」）。
function frontMatter(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const meta = {};
  for (const line of text.slice(3, end).split('\n')) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (m) meta[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return meta;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('_')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (dir === ROOT && SKIP_DIRS.has(name)) continue;
      out.push(...walk(p));
    } else if (name.endsWith('.md')) {
      out.push(p);
    }
  }
  return out;
}

// 表のセルを壊す文字を逃がす。
const cell = (s) => (s ?? '').replace(/\|/g, '｜').replace(/\s+/g, ' ').trim();
// [a, b] → a, b
const tags = (s) => cell((s ?? '').replace(/^\[|\]$/g, ''));

const rows = [];
let skippedDrafts = 0;
for (const file of walk(ROOT)) {
  const meta = frontMatter(readFileSync(file, 'utf8'));
  if (meta.status && meta.status !== '確定') {
    skippedDrafts++;
    continue;
  }
  const path = relative(ROOT, file).split(sep).join('/');
  rows.push(
    `| ${cell(path)} | ${cell(meta.dept) || '—'} | ${cell(meta.updated) || '—'} | ${cell(meta.summary) || cell(meta.title)} | ${tags(meta.tags)} |`,
  );
}

const body = `# 索引

**このファイルは \`npm run index\`（scripts/build-index.mjs）が各ファイルの front matter から作る。手で編集しない。**
直したいときは、そのファイルの front matter（dept・updated・summary・tags）を直してから \`npm run index\` を流す。

AIはまずこの表を見て、開くべきファイルを判断する。本文は含めない。
00_index/ のファイル、05_作業/（作業の手順書）、名前が _ で始まるもの、90_archive/、確定していない要項は載せていない。

| パス | 部門 | 更新日 | 要約 | タグ |
|---|---|---|---|---|
${rows.join('\n')}
`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {}
  if (current !== body) {
    console.error(`${OUT} が古い。npm run index を流してコミットすること。`);
    process.exit(1);
  }
  console.log(`${OUT} は最新（${rows.length}件）。`);
} else {
  writeFileSync(OUT, body);
  console.log(`${OUT} を書き直した（${rows.length}件、確定していない要項 ${skippedDrafts}件は除外）。`);
}
