/**
 * 要項ファイルの必須項目チェック。
 *
 *   node scripts/check-yoko.mjs            … 全件を確認
 *   node scripts/check-yoko.mjs --confirmed … 確定のものだけ確認
 *
 * 要項QA は書かれていることしか答えられない。項目が抜けていると
 * 「記載がありません」としか返せず、職員が結局シートを見に行くことになる。
 * 確定にする前にこれを通し、抜けを潰しておくための道具。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'knowledge/40_要項';

// 見出しの表記ゆれ（＜＞の有無、全角半角）を吸収して探すためのキーワード。
const REQUIRED = [
  { label: '対象', keys: ['対象'] },
  { label: '日程', keys: ['日程', '実施内容および日程', '実施日'] },
  { label: '受講料', keys: ['受講料', '参加費', '受験料', '無料'] },
  { label: '申込開始日', keys: ['申込開始', '受付開始', '開始日'] },
  { label: '申込期限', keys: ['申込期限', '締切', '締め切り', '申込締'] },
  { label: '申込方法', keys: ['申込方法', 'お申込み方法', 'お申し込み方法', '申込受付'] },
  { label: '支払い方法', keys: ['支払', '引き落と', '引落', '払込'] },
  { label: '連絡先', keys: ['連絡先', 'お問い合わせ', 'フリーダイヤル'] },
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('_')) continue; // テンプレート等
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

function frontMatter(raw) {
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return {};
  const meta = {};
  for (const line of raw.slice(3, end).split('\n')) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (m) meta[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return meta;
}

const onlyConfirmed = process.argv.includes('--confirmed');
let files;
try {
  files = walk(ROOT);
} catch {
  console.error(`${ROOT} がありません。`);
  process.exit(1);
}

let checked = 0;
let incomplete = 0;
const missCount = {};

for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const meta = frontMatter(raw);
  const confirmed = meta.status === '確定';
  if (onlyConfirmed && !confirmed) continue;

  checked++;
  // 見出しだけでなく本文も見る（表で書かれている要項があるため）。
  const body = raw.replace(/[*＜＞<>#\s　]/g, '');
  const missing = REQUIRED.filter((r) => !r.keys.some((k) => body.includes(k.replace(/\s/g, ''))));

  const mark = confirmed ? '確定' : '下書き';
  if (missing.length === 0) {
    console.log(`OK   [${mark}] ${f.replace(ROOT + '/', '')}`);
  } else {
    incomplete++;
    for (const m of missing) missCount[m.label] = (missCount[m.label] ?? 0) + 1;
    const level = confirmed ? '要修正' : '未記入';
    console.log(`${level} [${mark}] ${f.replace(ROOT + '/', '')}`);
    console.log(`       不足: ${missing.map((m) => m.label).join('、')}`);
  }
}

// どの項目が全体として弱いかを出す。1件ずつ直すより、書式を揃える判断に使う。
console.log(`\n${checked}件を確認、${incomplete}件に不足あり。`);
const tally = REQUIRED.map((r) => ({ label: r.label, n: missCount[r.label] ?? 0 }))
  .filter((x) => x.n > 0)
  .sort((a, b) => b.n - a.n);
if (tally.length) {
  console.log('\n項目別の不足件数:');
  for (const t of tally) console.log(`  ${t.label.padEnd(6, '　')} ${t.n}/${checked}件`);
}
if (onlyConfirmed && incomplete > 0) {
  console.log('確定済みに不足があります。要項QAはその項目を「記載なし」としか答えられません。');
  process.exit(1);
}
