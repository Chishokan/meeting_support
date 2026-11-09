/**
 * 議事録の1枚まとめ（AI が書いた要点の JSON）から、PDF と Word を1つずつ作る。
 * 毎週月曜の「部門会議議事録の週次まとめ」（Claude のスケジュール実行）で使う。
 *
 *   node --experimental-strip-types --no-warnings scripts/minutes-digest-files.mjs <入力.json> <出力フォルダ>
 *
 * 入力（items は会議ごと。row は「部門会議議事録」シートの1行、digest は AI のまとめ）:
 *   {
 *     "from": "2026-11-02", "to": "2026-11-08",          // 対象期間（保存日・日本時間）。ファイル名と表紙の題に使う
 *     "items": [{
 *       "row": { "id", "ts", "campus", "user", "title", "date", "place", "attendees", "editedAt", "editedBy" },
 *       "digest": { "purpose", "summary", "decisions": [{ "title", "detail", "owner", "due" }],
 *                   "todos": [{ "task", "owner", "due", "status": "" | "done" | "not_done" }],
 *                   "pending": [], "reports": [], "next", "checks": [] }
 *     }]
 *   }
 *   digest の項目の意味・書き方は lib/deptMinutesDigestAi.ts の指示文と同じ。
 *
 * 出力: 部門会議議事録まとめ_20261102-20261108.pdf / .docx（会議は開催日の順、1会議1ページ）
 *       同じ名前の .html（Google ドライブに Google ドキュメントとして保存するためのもの。lib/deptMinutesDigestHtml.ts）
 * 標準出力に結果の JSON（ファイルの場所・枚数・文字の大きさ・Word を確かめたか）を出す。
 *
 * Word が1会議1ページに収まるかは、LibreOffice（soffice）があれば PDF に変換して確かめ、
 * 収まらない会議だけ文字を小さくする（10pt から順に試す。PDF と Word では収まる大きさが少し違う）。フォントは Yu Gothic の代わりに assets/fonts の Noto Sans JP で測り、
 * Word との差の分、下の余白を 8mm 広げたページで測る。soffice が無ければ PDF と同じ大きさにする（未確認）。
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDigest, toDigest, jstStamp } from '../lib/deptMinutesDigest.ts';
import { loadFonts, renderDigestsPdf } from '../lib/deptMinutesDigestPdf.ts';
import { digestsDocx } from '../lib/deptMinutesDigestDocx.ts';
import { digestsHtml } from '../lib/deptMinutesDigestHtml.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [10, 9.5, 9, 8.75, 8.5, 8.25, 8, 7.75, 7.5];
const SAFETY_MM = 8;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const [inPath, outDir] = process.argv.slice(2);
if (!inPath || !outDir) fail('使い方: node --experimental-strip-types scripts/minutes-digest-files.mjs <入力.json> <出力フォルダ>');
const input = JSON.parse(readFileSync(inPath, 'utf8'));
const items = Array.isArray(input.items) ? input.items : [];
if (!items.length) fail('items が空です（対象の議事録が無い週はファイルを作らない）');
const ymd = (s) => String(s || '').replace(/-/g, '');
const md = (s) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? `${+m[1]}/${+m[2]}` : String(s || ''); };
if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(input.to || '')) fail('from / to は YYYY-MM-DD で書く');

const now = new Date();
const str = (v) => (v == null ? '' : String(v));

// 会議ごとに Digest を作る（会議情報はシートの値をそのまま、要点は AI の JSON を検査して使う）
const digests = items.map((it, i) => {
  const row = it.row || {};
  const body = normalizeDigest(it.digest);
  if (!body) fail(`items[${i}]（${str(row.title)}）のまとめが空です`);
  const d = toDigest({
    id: str(row.id), ts: str(row.ts), campus: str(row.campus), user: str(row.user), title: str(row.title),
    date: str(row.date), place: str(row.place), attendees: str(row.attendees), agenda: '', minutes: '-', quality: '',
    editedAt: str(row.editedAt), editedBy: str(row.editedBy), revised: false,
  }, body, now);
  // 並べ替えの鍵：開催日（読めなければ保存日）→ 保存日時
  const t = Date.parse(str(row.ts));
  const saved = Number.isNaN(t) ? '' : jstStamp(new Date(t)).slice(0, 10).replace(/\//g, ''); // YYYYMMDD
  const ymdFull = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(str(row.date).trim());
  const mdOnly = /^(\d{1,2})[/／](\d{1,2})/.exec(str(row.date).trim()); // '10/28㈬11：00' のように年が無い書き方
  let day = saved || '99999999';
  if (ymdFull) day = `${ymdFull[1]}${ymdFull[2].padStart(2, '0')}${ymdFull[3].padStart(2, '0')}`;
  else if (mdOnly && saved) {
    // 年は保存日の年。保存日より後の日付になるなら前の年（12月の会議を1月に保存した場合）
    const y = Number(saved.slice(0, 4));
    const mmdd = `${mdOnly[1].padStart(2, '0')}${mdOnly[2].padStart(2, '0')}`;
    day = `${mmdd > saved.slice(4) ? y - 1 : y}${mmdd}`;
  }
  return { d, key: `${day}|${Number.isNaN(t) ? 0 : t}` };
}).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((x) => x.d);

mkdirSync(outDir, { recursive: true });
const base = `部門会議議事録まとめ_${ymd(input.from)}-${ymd(input.to)}`;
const title = `部門会議 議事録まとめ（${md(input.from)}〜${md(input.to)} 保存分）`;

// ---- PDF ----
const fonts = loadFonts(path.join(ROOT, 'assets', 'fonts'));
const pdf = await renderDigestsPdf(digests, title, fonts);
const pdfPath = path.join(outDir, `${base}.pdf`);
writeFileSync(pdfPath, pdf.pdf);

// ---- Word ----
const pageCount = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
const work = mkdtempSync(path.join(tmpdir(), 'minutes-docx-'));
const hasSoffice = spawnSync('soffice', ['--version'], { encoding: 'utf8' }).status === 0;
const fontConf = path.join(work, 'fonts.conf');
writeFileSync(fontConf, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>${path.join(ROOT, 'assets', 'fonts')}</dir>
  <cachedir>${path.join(work, 'fc-cache')}</cachedir>
  <alias binding="same"><family>Yu Gothic</family><prefer><family>Noto Sans JP</family></prefer></alias>
  <alias binding="same"><family>游ゴシック</family><prefer><family>Noto Sans JP</family></prefer></alias>
</fontconfig>
`);

/** docx を LibreOffice で PDF にして枚数を数える。 */
function wordPages(buf, name) {
  const f = path.join(work, `${name}.docx`);
  writeFileSync(f, buf);
  const r = spawnSync('soffice', [`-env:UserInstallation=file://${path.join(work, 'lo-profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', work, f], {
    encoding: 'utf8', env: { ...process.env, FONTCONFIG_FILE: fontConf }, timeout: 120000,
  });
  const out = path.join(work, `${name}.pdf`);
  if (r.status !== 0 || !existsSync(out)) throw new Error(`LibreOffice の変換に失敗: ${r.stderr || r.stdout}`);
  return pageCount(readFileSync(out));
}

const wordSizes = [];
let wordVerified = false;
let wordTotalPages = null;
if (hasSoffice) {
  for (let i = 0; i < digests.length; i++) {
    let pick = SIZES[SIZES.length - 1];
    for (const s of SIZES) {
      const buf = await digestsDocx([{ digest: digests[i], size: s }], title, SAFETY_MM);
      if (wordPages(buf, `m${i}-${s}`) === 1) { pick = s; break; }
    }
    wordSizes.push(pick);
  }
} else {
  wordSizes.push(...pdf.fontSizes);
}
const docx = await digestsDocx(digests.map((d, i) => ({ digest: d, size: wordSizes[i] })), title);
const docxPath = path.join(outDir, `${base}.docx`);
writeFileSync(docxPath, docx);
if (hasSoffice) {
  wordTotalPages = wordPages(docx, 'all');
  wordVerified = wordTotalPages === digests.length;
}

// ---- Google ドキュメント用の HTML（ドライブには PDF・Word をそのまま上げられないため、この HTML を渡して変換させる）----
const htmlPath = path.join(outDir, `${base}.html`);
writeFileSync(htmlPath, digestsHtml(digests, title));

console.log(JSON.stringify({
  title,
  meetings: digests.map((d, i) => ({ date: d.date, title: d.title, dept: d.dept, pdfFontSize: pdf.fontSizes[i], wordFontSize: wordSizes[i] })),
  pdf: { path: pdfPath, pages: pdf.pages },
  docx: { path: docxPath, pages: wordTotalPages, verified: wordVerified, soffice: hasSoffice },
  html: { path: htmlPath, chars: readFileSync(htmlPath, 'utf8').length, googleDocTitle: base },
}, null, 2));
