/**
 * 要項ドキュメント（Google ドキュメント）のエクスポートを
 * knowledge/40_要項/ 配下の Markdown へ切り分ける取り込みスクリプト。
 *
 * 使い方:
 *   1. 要項ドキュメントを Markdown で書き出す（ファイル > ダウンロード > Markdown）
 *   2. node scripts/import-yoko.mjs <書き出したファイル> [出力先ディレクトリ]
 *   3. 生成されたファイルの status を、担当者が確認できたものだけ「確定」に変える
 *
 * ※ status が「確定」のものだけを要項QAが読む。下書きはAIに渡さない。
 *   受講料や申込期限は案ごとに違うため、未確定のものを混ぜると回答が矛盾する。
 *
 * 区切りの判定：太字でない「# 見出し」を1件の要項の先頭とみなす
 * （ドキュメント上のタブ見出し。本文中の装飾見出しは「# **…**」と太字になっている）。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.argv[2];
const OUT = process.argv[3] ?? 'knowledge/40_要項/2026';
if (!SRC) {
  console.error('使い方: node scripts/import-yoko.mjs <Markdownファイル> [出力先]');
  process.exit(1);
}

// ファイル名に使えない文字を落とす。日本語はそのまま残す（担当者が探しやすいため）。
function slug(title, i) {
  const t = title
    .replace(/[\\/:*?"<>|#]/g, '')
    .replace(/[\s　]+/g, '_')
    .slice(0, 40);
  return `${String(i + 1).padStart(2, '0')}_${t || 'untitled'}.md`;
}

const raw = readFileSync(SRC, 'utf8');
const lines = raw.split('\n');

const bounds = [];
lines.forEach((l, i) => {
  const m = /^# (?!\*)(.+?)\s*$/.exec(l);
  if (m && m[1].trim()) bounds.push({ line: i, title: m[1].trim() });
});
if (!bounds.length) {
  console.error('要項の区切り（太字でない # 見出し）が見つかりませんでした。');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const existing = new Set(readdirSync(OUT).filter((f) => f.endsWith('.md')));

let written = 0;
bounds.forEach((b, i) => {
  const end = i + 1 < bounds.length ? bounds[i + 1].line : lines.length;
  const body = lines.slice(b.line + 1, end).join('\n').trim();
  const name = slug(b.title, i);

  // すでにある（＝担当者が確定済みかもしれない）ファイルは上書きしない。
  if (existing.has(name)) {
    console.log(`skip  ${name}（既存。上書きしない）`);
    return;
  }

  const fm = [
    '---',
    `title: ${b.title}`,
    'status: 下書き   # 担当者が内容を確認したら「確定」に変える。確定だけがAIに渡る',
    'owner:           # 確定させた人の名前',
    `updated: ${today}`,
    'source: 要項ドキュメント（Google ドキュメント）',
    '---',
    '',
  ].join('\n');

  writeFileSync(join(OUT, name), `${fm}# ${b.title}\n\n${body}\n`, 'utf8');
  written++;
  console.log(`write ${name}  (${body.length}字)`);
});

console.log(`\n${written}件を書き出しました（全${bounds.length}件中）。出力先: ${OUT}`);
console.log('すべて status: 下書き です。確認できたものを「確定」に変えてください。');
