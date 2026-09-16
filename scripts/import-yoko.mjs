/**
 * 要項ドキュメント（Google ドキュメント）のエクスポートを
 * knowledge/40_要項/ 配下の Markdown へ切り分ける取り込みスクリプト。
 *
 * 使い方:
 *   【手動取り込み】
 *   1. 要項ドキュメントを Markdown で書き出す（ファイル > ダウンロード > Markdown）
 *   2. node scripts/import-yoko.mjs <書き出したファイル> [出力先ディレクトリ]
 *      - すべてのタブを出力先に書く。既にあるファイルは上書きしない（担当者が直した確定済みを壊さない）
 *   3. 生成されたファイルを確認する（node scripts/check-yoko.mjs）
 *
 *   【自動同期（GitHub Actions から呼ばれる）】
 *   node scripts/import-yoko.mjs --sync <書き出したファイル> [要項ルート=knowledge/40_要項]
 *      - ドキュメントが正本。＜基本情報＞の「ステータス：確定」のタブだけを git に反映する
 *      - 既存ファイルは front matter の title と講座名を突き合わせて上書きする
 *      - ドキュメント側で「確定」でなくなったタブは、git 側の status を「下書き」に戻す（AI が答えなくなる）
 *      - ステータス欄が無いタブは触らない（旧形式のタブを誤って下書きに戻さないため）
 *      - 新規は <ルート>/<年>/<YYYY-MM>_<講座名>.md に作る
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
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const SYNC = args.includes('--sync');
const positional = args.filter((a) => !a.startsWith('--'));
const SRC = positional[0];

if (!SRC) {
  console.error('使い方: node scripts/import-yoko.mjs [--sync] <Markdownファイル> [出力先]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 共通：エクスポートの解析
// ---------------------------------------------------------------------------

// 「  - 講座名：2026冬期 中等部」から値を取り出す。全角・半角のコロン両方に対応。
// ※空白は必ず「改行を含まない」クラスで書くこと。\s は改行にマッチするため、
//   値が空欄のときに次の行を拾ってしまう（作成者が空で「- ステータス：…」が入る）。
const H = '[ \\t\\u3000]'; // 横方向の空白だけ
function fieldOf(body, label) {
  const re = new RegExp(`^[${H.slice(1, -1)}\\-*・]*\\*{0,2}${label}\\*{0,2}${H}*[：:]${H}*(.*)$`, 'm');
  const m = re.exec(body);
  if (!m) return null; // 欄そのものが無い
  return m[1]
    .replace(/←.*$/, '')          // 「←あてはまるものだけ残す」などの注記を落とす
    .replace(/\*/g, '')
    .replace(/[\s　]+$/, '')
    .trim();
}

/** エクスポート全文を、タブ（＝1要項）ごとに分解する。 */
export function parseExport(raw) {
  const lines = raw.split('\n');
  const bounds = [];
  lines.forEach((l, i) => {
    const m = /^# (?!\*)(.+?)\s*$/.exec(l);
    if (m && m[1].trim()) bounds.push({ line: i, title: m[1].trim() });
  });

  const entries = [];
  bounds.forEach((b, i) => {
    const end = i + 1 < bounds.length ? bounds[i + 1].line : lines.length;
    let body = lines.slice(b.line + 1, end).join('\n').trim();
    const warnings = [];

    // テンプレート本体（記入用タブ）は取り込まない。
    const isTemplate = /^[_＿]/.test(b.title) || b.title.includes('テンプレート');

    // 記入例の節を落とす。消し忘れると例の金額が実際の受講料として答えられてしまう。
    const exAt = body.search(/^#{1,6}\s*◆?\s*記入例/m);
    if (exAt !== -1) {
      body = body.slice(0, exAt).trim();
      warnings.push('記入例の節が残っていたので取り込み時に削除した');
    }

    const title = fieldOf(body, '講座名') || b.title;
    const owner = fieldOf(body, '作成者') ?? '';
    const statusRaw = fieldOf(body, 'ステータス'); // null＝欄が無い
    const status = statusRaw == null ? null : statusRaw.includes('確定') ? '確定' : '下書き';
    const updated = fieldOf(body, '作成日') ?? '';
    const dept = fieldOf(body, '部門') ?? '';

    if (!owner) warnings.push('作成者が未記入');
    if (statusRaw === '') warnings.push('ステータスが未記入（下書き扱いにした）');
    if (/（例[：:]/.test(body)) warnings.push('「（例：…）」が残っている');

    entries.push({ index: i, tabTitle: b.title, title, owner, status, updated, dept, body, isTemplate, warnings });
  });
  return entries;
}

function frontMatterText({ title, status, owner, updated, dept, source }) {
  return [
    '---',
    `title: ${title}`,
    `status: ${status}`,
    `owner: ${owner}`,
    `updated: ${updated}`,
    dept ? `dept: ${dept}` : null,
    `source: ${source}`,
    '---',
    '',
  ]
    .filter((x) => x !== null)
    .join('\n');
}

function fileText(meta, title, body) {
  return `${frontMatterText(meta)}# ${title}\n\n${body}\n`;
}

// ファイル名に使えない文字を落とす。日本語はそのまま残す（担当者が探しやすいため）。
function slugBase(title) {
  return String(title)
    .replace(/[\\/:*?"<>|#]/g, '')
    .replace(/[\s　]+/g, '_')
    .slice(0, 40) || 'untitled';
}

const today = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// 手動取り込み（従来どおり）
// ---------------------------------------------------------------------------

function runImport(src, out) {
  const entries = parseExport(readFileSync(src, 'utf8'));
  if (!entries.length) {
    console.error('要項の区切り（太字でない # 見出し）が見つかりませんでした。');
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });
  const existing = new Set(existsSync(out) ? readdirSync(out).filter((f) => f.endsWith('.md')) : []);

  let written = 0;
  let skipped = 0;
  const warnings = [];

  for (const e of entries) {
    if (e.isTemplate) {
      console.log(`skip  ${e.tabTitle}（テンプレートのタブ）`);
      skipped++;
      continue;
    }
    for (const w of e.warnings) warnings.push(`${e.title}: ${w}`);

    const name = `${String(e.index + 1).padStart(2, '0')}_${slugBase(e.title)}.md`;
    // すでにある（＝担当者が確定済みかもしれない）ファイルは上書きしない。
    if (existing.has(name)) {
      console.log(`skip  ${name}（既存。上書きしない）`);
      skipped++;
      continue;
    }

    const status = e.status ?? '下書き';
    writeFileSync(
      join(out, name),
      fileText(
        { title: e.title, status, owner: e.owner, updated: e.updated || today, dept: e.dept, source: '要項テンプレート（Google ドキュメント）' },
        e.title,
        e.body,
      ),
      'utf8',
    );
    written++;
    console.log(`write ${name}  [${status}]  ${e.body.length}字`);
  }

  console.log(`\n${written}件を書き出し、${skipped}件をスキップしました。出力先: ${out}`);
  if (warnings.length) {
    console.log('\n確認してください:');
    for (const w of warnings) console.log(`  - ${w}`);
  }
  console.log('\n必須項目の確認: node scripts/check-yoko.mjs');
}

// ---------------------------------------------------------------------------
// 自動同期
// ---------------------------------------------------------------------------

function walkMd(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('_')) continue; // テンプレート・退避フォルダは対象外
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkMd(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

function parseFrontMatter(raw) {
  if (!raw.startsWith('---')) return { meta: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: raw };
  const meta = {};
  for (const line of raw.slice(3, end).split('\n')) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (m) meta[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return { meta, body: raw.slice(end + 4).replace(/^\r?\n/, '') };
}

// 講座名の突き合わせ用。空白と全角半角の違い、末尾の「(0912確定)」のような確定日メモは無視する。
// （「(0912確定)」は旧運用で担当者がタブ名に付けていた印。日付が変わっても同じ要項として扱う）
export function normTitle(t) {
  return String(t)
    .replace(/[（(]\s*\d{3,4}\s*確定\s*[）)]/g, '')
    .replace(/[\s　]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９（）]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

function runSync(src, root) {
  const entries = parseExport(readFileSync(src, 'utf8')).filter((e) => !e.isTemplate);
  if (!entries.length) {
    console.error('要項の区切り（太字でない # 見出し）が見つかりませんでした。書き出しが空の可能性があります。');
    process.exit(1);
  }

  const existing = new Map(); // normTitle → { path, meta, body, raw }
  for (const p of existsSync(root) ? walkMd(root) : []) {
    const raw = readFileSync(p, 'utf8');
    const { meta, body } = parseFrontMatter(raw);
    const key = normTitle(meta.title || '');
    if (!key) continue;
    if (existing.has(key)) console.log(`注意  同じ講座名のファイルが複数あります: ${existing.get(key).path} / ${p}`);
    existing.set(key, { path: p, meta, body, raw });
  }

  const result = { updated: [], created: [], reverted: [], unchanged: [], skipped: [], warnings: [] };
  const seen = new Set();

  for (const e of entries) {
    const key = normTitle(e.title);
    seen.add(key);
    const cur = existing.get(key);

    if (e.status == null) {
      // ＜基本情報＞のステータス欄が無い（旧形式のタブ）。判断できないので触らない。
      result.skipped.push(`${e.title}（ステータス欄なし${cur ? '・git 側は ' + (cur.meta.status || '下書き') : ''}）`);
      continue;
    }

    if (e.status !== '確定') {
      if (cur && cur.meta.status === '確定') {
        // ドキュメント側で確定が取り消された。本文は差し替えず、状態だけ戻す。
        const meta = { ...cur.meta, status: '下書き' };
        writeFileSync(cur.path, `${frontMatterText(fillMeta(meta))}${cur.body}`, 'utf8');
        result.reverted.push(rel(cur.path));
      } else {
        result.skipped.push(`${e.title}（${e.status}）`);
      }
      continue;
    }

    // 確定 → git に反映
    for (const w of e.warnings) result.warnings.push(`${e.title}: ${w}`);
    if (cur) {
      const meta = fillMeta({
        ...cur.meta,
        title: e.title,
        status: '確定',
        owner: e.owner || cur.meta.owner || '',
        updated: e.updated || cur.meta.updated || today,
        dept: e.dept || cur.meta.dept || '',
      });
      const next = fileText(meta, e.title, e.body);
      if (next === cur.raw) {
        result.unchanged.push(rel(cur.path));
      } else {
        writeFileSync(cur.path, next, 'utf8');
        result.updated.push(rel(cur.path));
      }
    } else {
      const ym = /^(\d{4})-(\d{2})/.exec(e.updated) ? e.updated.slice(0, 7) : today.slice(0, 7);
      const dir = join(root, ym.slice(0, 4));
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${ym}_${slugBase(e.title)}.md`);
      const meta = fillMeta({ title: e.title, status: '確定', owner: e.owner, updated: e.updated || today, dept: e.dept });
      writeFileSync(path, fileText(meta, e.title, e.body), 'utf8');
      result.created.push(rel(path));
    }
  }

  // git にあってドキュメントに無い確定済み（タブ名の変更や削除）。自動では消さない。
  for (const [key, cur] of existing) {
    if (!seen.has(key) && cur.meta.status === '確定') {
      result.warnings.push(`${rel(cur.path)}: ドキュメントに同じ講座名のタブが見当たらない（タブ名変更か削除）。手で確認すること`);
    }
  }

  const line = (label, arr) => arr.length && console.log(`${label}（${arr.length}）\n${arr.map((x) => `  - ${x}`).join('\n')}`);
  line('更新', result.updated);
  line('新規', result.created);
  line('下書きに戻した', result.reverted);
  line('変更なし', result.unchanged);
  line('対象外', result.skipped);
  if (result.warnings.length) {
    console.log('\n確認してください:');
    for (const w of result.warnings) console.log(`  - ${w}`);
  }
  const changed = result.updated.length + result.created.length + result.reverted.length;
  console.log(`\n同期完了: 変更 ${changed} 件（ドキュメント ${entries.length} タブ、git ${existing.size} 件）`);

  // GitHub Actions から呼ばれたとき、PR 本文用に結果を渡す。
  if (process.env.GITHUB_OUTPUT) {
    const summary = [
      ...result.updated.map((x) => `- 更新: ${x}`),
      ...result.created.map((x) => `- 新規: ${x}`),
      ...result.reverted.map((x) => `- 下書きに戻した: ${x}`),
      ...result.warnings.map((x) => `- ⚠ ${x}`),
    ].join('\n');
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `changed=${changed}\nsummary<<EOF\n${summary}\nEOF\n`,
      { flag: 'a' },
    );
  }

  function rel(p) {
    const r = relative(process.cwd(), p).split('\\').join('/');
    return r.startsWith('..') ? p : r; // ルートが作業ディレクトリの外なら絶対パスのまま
  }
}

function fillMeta(meta) {
  return {
    title: meta.title || '',
    status: meta.status || '下書き',
    owner: meta.owner || '',
    updated: meta.updated || today,
    dept: meta.dept || '',
    source: meta.source || '要項テンプレート（Google ドキュメント）',
  };
}

// ---------------------------------------------------------------------------

if (SYNC) runSync(SRC, positional[1] ?? 'knowledge/40_要項');
else runImport(SRC, positional[1] ?? 'knowledge/40_要項/2026');
