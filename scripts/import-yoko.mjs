/**
 * 要項ドキュメント（Google ドキュメント）のエクスポートを
 * knowledge/40_要項/ 配下の Markdown へ切り分ける取り込みスクリプト。
 *
 * 使い方:
 *   1. 要項ドキュメントを Markdown で書き出す（ファイル > ダウンロード > Markdown）
 *   2. node scripts/import-yoko.mjs <書き出したファイル> [出力先ディレクトリ]
 *   3. 生成されたファイルを確認する（node scripts/check-yoko.mjs）
 *
 * 区切りの判定：太字でない「# 見出し」を1件の要項の先頭とみなす
 * （ドキュメント上のタブ見出し。本文中の装飾見出しは「# **…**」と太字になっている）。
 * テンプレートの「やってはいけないこと」に
 * 「本文に見出し1を使わない」と書いてあるのはこのため。
 *
 * ＜基本情報＞ から front matter を作る:
 *   講座名   → title
 *   作成者   → owner
 *   ステータス → status（「確定」のものだけが要項QAの回答に使われる）
 *   作成日   → updated
 *   部門     → dept
 *
 * 記入例の節（◆記入例…◆）は自動で落とす。
 * 消し忘れたまま取り込むと、AIが例の金額（25,300円など）を実際の受講料として
 * 答えてしまうため。落としたときは警告を出す。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.argv[2];
const OUT = process.argv[3] ?? 'knowledge/40_要項/2026';
if (!SRC) {
  console.error('使い方: node scripts/import-yoko.mjs <Markdownファイル> [出力先]');
  process.exit(1);
}

// ファイル名に使えない文字を落とす。日本語はそのまま残す（担当者が探しやすいため）。
function slug(title, i) {
  const t = String(title)
    .replace(/[\\/:*?"<>|#]/g, '')
    .replace(/[\s　]+/g, '_')
    .slice(0, 40);
  return `${String(i + 1).padStart(2, '0')}_${t || 'untitled'}.md`;
}

// 「  - 講座名：2026冬期 中等部」から値を取り出す。全角・半角のコロン両方に対応。
// ※空白は必ず「改行を含まない」クラスで書くこと。\s は改行にマッチするため、
//   値が空欄のときに次の行を拾ってしまう（作成者が空で「- ステータス：…」が入る）。
const H = '[ \\t\\u3000]'; // 横方向の空白だけ
function fieldOf(body, label) {
  const re = new RegExp(`^[${H.slice(1, -1)}\\-*・]*\\*{0,2}${label}\\*{0,2}${H}*[：:]${H}*(.*)$`, 'm');
  const m = re.exec(body);
  if (!m) return '';
  return m[1]
    .replace(/←.*$/, '')          // 「←あてはまるものだけ残す」などの注記を落とす
    .replace(/\*/g, '')
    .replace(/[\s　]+$/, '')
    .trim();
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
const existing = new Set(existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith('.md')) : []);

let written = 0;
let skipped = 0;
const warnings = [];

bounds.forEach((b, i) => {
  const end = i + 1 < bounds.length ? bounds[i + 1].line : lines.length;
  let body = lines.slice(b.line + 1, end).join('\n').trim();

  // テンプレート本体（記入用タブ）は取り込まない。
  if (/^[_＿]/.test(b.title) || b.title.includes('テンプレート')) {
    console.log(`skip  ${b.title}（テンプレートのタブ）`);
    skipped++;
    return;
  }

  // 記入例の節を落とす。消し忘れると例の金額が実際の受講料として答えられてしまう。
  const exAt = body.search(/^#{1,6}\s*◆?\s*記入例/m);
  if (exAt !== -1) {
    body = body.slice(0, exAt).trim();
    warnings.push(`${b.title}: 記入例の節が残っていたので取り込み時に削除した`);
  }

  const title = fieldOf(body, '講座名') || b.title;
  const owner = fieldOf(body, '作成者');
  const statusRaw = fieldOf(body, 'ステータス');
  const status = statusRaw.includes('確定') ? '確定' : '下書き';
  const updated = fieldOf(body, '作成日') || today;
  const dept = fieldOf(body, '部門');

  if (!owner) warnings.push(`${title}: 作成者が未記入`);
  if (!statusRaw) warnings.push(`${title}: ステータスが未記入（下書き扱いにした）`);
  if (/（例[：:]/.test(body)) warnings.push(`${title}: 「（例：…）」が残っている`);

  const name = slug(title, i);
  // すでにある（＝担当者が確定済みかもしれない）ファイルは上書きしない。
  if (existing.has(name)) {
    console.log(`skip  ${name}（既存。上書きしない）`);
    skipped++;
    return;
  }

  const fm = [
    '---',
    `title: ${title}`,
    `status: ${status}`,
    `owner: ${owner}`,
    `updated: ${updated}`,
    dept ? `dept: ${dept}` : null,
    'source: 要項テンプレート（Google ドキュメント）',
    '---',
    '',
  ]
    .filter((x) => x !== null)
    .join('\n');

  writeFileSync(join(OUT, name), `${fm}# ${title}\n\n${body}\n`, 'utf8');
  written++;
  console.log(`write ${name}  [${status}]  ${body.length}字`);
});

console.log(`\n${written}件を書き出し、${skipped}件をスキップしました。出力先: ${OUT}`);
if (warnings.length) {
  console.log('\n確認してください:');
  for (const w of warnings) console.log(`  - ${w}`);
}
console.log('\n必須項目の確認: node scripts/check-yoko.mjs');
