/**
 * Color HRM の講師情報 CSV を knowledge/20_組織・人事/講師一覧.md に取り込むスクリプト。
 *
 * 使い方:
 *   1. Color HRM（https://chishokan.co.jp/colorhrm/）に admin でログインし、
 *      「講師情報 CSVエクスポート」（staff_io.php）から CSV をダウンロードする
 *   2. node scripts/import-instructors.mjs <ダウンロードした staff_YYYYMMDD.csv>
 *   3. 生成された knowledge/20_組織・人事/講師一覧.md を確認して commit & push
 *      （Vercel が再デプロイし、会議AI・部門会議議事録・文字起こしが講師名を参照できる）
 *   4. ★ダウンロードした CSV は必ず削除する（ログイン情報が入っているため。下記）
 *
 * 【個人情報の扱い（重要）】
 * Color HRM の CSV エクスポートには、メールアドレス・ログイン用メール・**平文パスワード**・
 * メンター・紹介者・応募媒体・入社日・育成目標などが含まれる。
 * このスクリプトは下の KEEP に挙げた列**だけ**を書き出し、それ以外は読み捨てる。
 * git に入るのは「氏名・社員コード・部門・校舎・雇用形態・カラー」のみ。
 * 退職者（在籍=0）も書き出さない。
 *
 * 列は見出し名で拾う（Color HRM の snake_case でも日本語見出しでも可）。
 * 列の並びが変わっても動く。氏名の列が見つからなければ止まる。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SRC = process.argv[2];
const OUT = process.argv[3] ?? 'knowledge/20_組織・人事/講師一覧.md';
if (!SRC) {
  console.error('使い方: node scripts/import-instructors.mjs <Color HRM の講師情報CSV> [出力先.md]');
  process.exit(1);
}

// 書き出す列（この順）。ここに無い列は CSV にあっても捨てる。
// ★連絡先・ログイン情報・給与・育成目標・紹介者は絶対に足さないこと（git の履歴から消せない）。
const KEEP = [
  { key: 'name',            label: '氏名',       aliases: ['name', '氏名', '名前', '講師名'] },
  { key: 'employee_code',   label: '社員コード', aliases: ['employee_code', '社員コード', '講師コード', '社員番号'] },
  { key: 'departments',     label: '部門',       aliases: ['departments', '部門', '部署', '所属'] },
  // 配属教室（classrooms）が出力されていればそちらを優先し、無ければ校舎（school）を使う。
  { key: 'classrooms',      label: '校舎',       aliases: ['classrooms', '配属教室', '教室'] },
  { key: 'school',          label: '校舎',       aliases: ['school', '校舎'] },
  { key: 'employment_type', label: '雇用形態',   aliases: ['employment_type', '雇用形態'] },
  { key: 'color_rank',      label: 'カラー',     aliases: ['color_rank', 'カラー', '現在カラー', '現在のカラー'] },
];
// 在籍判定にだけ使う（書き出さない）
const ACTIVE_ALIASES = ['is_active', '在籍', '有効', '在籍状況'];
// 入っていたら「CSV を消すこと」を強く警告する列
const SENSITIVE = ['login_password', 'password', 'plain_password', 'パスワード'];

const OUTPUT_COLS = ['氏名', '社員コード', '部門', '校舎', '雇用形態', 'カラー'];

// --- CSV --------------------------------------------------------------------
// RFC4180 相当（"" のエスケープ、セル内改行、CRLF）。ライブラリを足すほどではないので自前。
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  // 完全な空行は落とす
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const raw = readFileSync(SRC, 'utf8').replace(/^﻿/, '');
const rows = parseCsv(raw);
if (rows.length < 2) {
  console.error('CSV にデータ行がありません。');
  process.exit(1);
}
const header = rows[0].map((h) => h.trim());
const lower = header.map((h) => h.toLowerCase());
const colIndex = (aliases) => {
  for (const a of aliases) {
    const i = lower.indexOf(a.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
};

const idx = Object.fromEntries(KEEP.map((k) => [k.key, colIndex(k.aliases)]));
if (idx.name < 0) {
  console.error(`氏名の列が見つかりません。見出し: ${header.join(', ')}`);
  process.exit(1);
}
const activeIdx = colIndex(ACTIVE_ALIASES);
if (activeIdx < 0) console.warn('警告: 在籍（is_active）の列が無いため、全員を在籍として扱います。');

const sensitiveFound = header.filter((h) => SENSITIVE.some((s) => h.toLowerCase().includes(s)));
if (sensitiveFound.length) {
  console.warn(`警告: CSV にログイン情報の列があります（${sensitiveFound.join(', ')}）。書き出しには含めませんが、取り込み後に CSV を必ず削除してください。`);
}

const dropped = header.filter((h, i) => !Object.values(idx).includes(i) && i !== activeIdx);

// --- 行の整形 -----------------------------------------------------------------
const cell = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
const isActive = (r) => {
  if (activeIdx < 0) return true;
  const v = cell(r, activeIdx).toLowerCase();
  if (v === '') return true; // 空は Color HRM 側の既定（在籍）に合わせる
  return ['1', 'true', '○', '〇', 'yes', 'y', '有効', '在籍', 'はい'].includes(v);
};
// 「RED,ネクスタ」のようなカンマ区切りは「・」で見せる（Markdown の表で読みやすいため）
const list = (s) => s.split(/[,、]/).map((x) => x.trim()).filter(Boolean).join('・');
const esc = (s) => s.replace(/\|/g, '｜').replace(/\r?\n/g, ' ');

let retired = 0;
let nameless = 0;
const people = [];
for (const r of rows.slice(1)) {
  const name = cell(r, idx.name).replace(/[\s　]+/g, ' ');
  if (!name) { nameless++; continue; }
  if (!isActive(r)) { retired++; continue; }
  const classrooms = list(cell(r, idx.classrooms)) || list(cell(r, idx.school));
  people.push({
    氏名: name,
    社員コード: cell(r, idx.employee_code),
    部門: list(cell(r, idx.departments)),
    校舎: classrooms,
    雇用形態: cell(r, idx.employment_type),
    カラー: cell(r, idx.color_rank).toUpperCase(),
  });
}

// 校舎 → 氏名の順に並べる（校舎ごとに眺めやすく、差分も安定する）
const collator = new Intl.Collator('ja');
people.sort((a, b) => collator.compare(a.校舎, b.校舎) || collator.compare(a.氏名, b.氏名));

const dup = people.map((p) => p.氏名).filter((n, i, arr) => arr.indexOf(n) !== i);
if (dup.length) console.warn(`警告: 同姓同名があります: ${Array.from(new Set(dup)).join(', ')}（社員コードで区別してください）`);

// --- Markdown -----------------------------------------------------------------
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD
const md = `---
title: 講師一覧（Color HRM）
dept: 全社
owner: 総務・人事
updated: ${today}
source: colorhrm:staff   # Color HRM（Xサーバー）の staff テーブル。CSVエクスポートから取り込み
source_type: csv
tags: [講師, スタッフ, 人事, ColorHRM]
visibility: all
summary: Color HRM に登録されている在籍中の講師・スタッフの一覧（氏名・部門・校舎・雇用形態・カラー）。連絡先や給与は含まない
---

# 講師一覧（Color HRM より）

Color HRM の講師マスタ（staff）から書き出したもの。**在籍中のみ・${people.length}名**（${today} 取り込み）。

- **このファイルは \`scripts/import-instructors.mjs\` が生成する。手で直さない**（次の取り込みで上書きされる）。
  直したいときは Color HRM 側を直してから取り込み直す。
- 連絡先・ログイン情報・給与・入社日・育成目標・紹介者は**意図的に含めていない**。足さないこと。
- カラーは Color HRM の育成段階（WHITE → GREEN → BLUE → YELLOW → RED の順）。

| ${OUTPUT_COLS.join(' | ')} |
|${OUTPUT_COLS.map(() => '---').join('|')}|
${people.map((p) => `| ${OUTPUT_COLS.map((c) => esc(p[c])).join(' | ')} |`).join('\n')}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, md);

console.log(`書き出し: ${OUT}`);
console.log(`  在籍 ${people.length}名（退職 ${retired}名は除外${nameless ? `、氏名なし ${nameless}行は無視` : ''}）`);
console.log(`  読み捨てた列: ${dropped.length ? dropped.join(', ') : '（なし）'}`);
console.log('★ 取り込みに使った CSV は削除してください（git に add しないこと）。');
