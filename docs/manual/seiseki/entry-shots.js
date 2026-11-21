// 成績管理「成績入力」マニュアルの写真を撮る（架空の生徒・架空の職員）。
// 使い方：架空のデータを作ってからアプリを手元で起動し（成績管理の保存先は設定しない＝ .data/moshi.json を使う）、
//   node --experimental-strip-types docs/manual/seiseki/entry-seed.mjs
//   npx next dev -p 3125
//   node docs/manual/seiseki/entry-shots.js 出力フォルダ http://localhost:3125
// 出力フォルダに写真（2倍）と boxes.json（赤枠の位置）ができる。赤枠は entry-annotate.py で付ける。
// 写真の中で得点を入れたり取り込んだりするので、撮り直すときは entry-seed.mjs からやり直す。
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:3125';
const boxes = {};
const W = 1280;

// 赤枠の位置。selector を配列で渡すと、それらを囲む1つの枠にする
async function box(page, selector, pad = 4) {
  const list = [];
  for (const sel of [].concat(selector)) {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error('no box: ' + sel);
    list.push(b);
  }
  const x = Math.min(...list.map((b) => b.x));
  const y = Math.min(...list.map((b) => b.y));
  const r = Math.max(...list.map((b) => b.x + b.width));
  const btm = Math.max(...list.map((b) => b.y + b.height));
  return { x: x - pad, y: y - pad, w: r - x + pad * 2, h: btm - y + pad * 2 };
}
// 左のメニューを除いた、top の要素の上から bottom の要素の下までを切り取る
async function band(page, top, bottom, padTop = 12, padBottom = 14) {
  const t = await page.locator(top).first().boundingBox();
  const b = await page.locator(bottom).first().boundingBox();
  return { x: 236, y: Math.max(0, t.y - padTop), width: W - 236, height: b.y + b.height + padBottom - Math.max(0, t.y - padTop) };
}
const LAST_ROW = '[data-grid] tbody tr:last-child';
async function shot(page, name, marks, clip) {
  await page.waitForTimeout(250);
  const list = [];
  for (const [n, sel, pad] of marks) list.push({ n, ...(await box(page, sel, pad ?? 4)) });
  await page.screenshot({ path: `${OUT}/${name}.png`, clip });
  boxes[name] = { marks: list, clip };
}
const cell = (row, k, i) => `[data-grid="scores"] tbody tr:nth-child(${row}) td.ms-s-${k}.ms-cell-td >> nth=${i}`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: 1000 }, deviceScaleFactor: 2, locale: 'ja-JP', acceptDownloads: true });
  // 架空の職員（小中等部）。手元（SESSION_SECRET なし）では Cookie に名前と部門をそのまま入れればよい
  await ctx.addCookies([{ name: 'chishokan_session', value: Buffer.from(JSON.stringify({ name: '智翔 花子', campus: '小中等部' })).toString('base64'), domain: new URL(BASE).hostname, path: '/' }]);
  // 手元で動かしていることを示す帯（開発環境）は写さない
  await ctx.addInitScript(() => {
    try { localStorage.clear(); } catch {}
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '.env-banner { display: none !important; } input { caret-color: transparent; }';
      document.head.appendChild(st);
    });
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());

  // 1. 成績入力の画面（5教科）
  await page.goto(BASE + '/moshi', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ms-bar');
  await page.selectOption('.ms-bar label:nth-child(1) select', 'exam-2026-11');
  await page.selectOption('.ms-bar label:nth-child(2) select', '日野校');
  await page.waitForTimeout(600);
  await shot(page, 'seiseki_in_01_screen', [
    [1, '.ms-bar label:nth-child(1) select', 4],
    [2, '.ms-bar label:nth-child(2) select', 4],
    [3, '.ms-save', 5],
    [4, '.ms-toolbar .ms-seg >> nth=0', 4],
    [5, '.ms-toolbar .ms-seg >> nth=1', 4],
    [6, '.ms-toolbar .ms-check', 4],
    [7, '.ms-actions', 4],
    [8, '.ms-progress', 4],
  ], { x: 236, y: 0, width: W - 236, height: 640 });

  // 2. 大問ごとに入れる（0007 の英語を Tab で右へ入れ、自動で保存されたところ）
  const vals = ['21', '24', '7', '25'];
  await page.click(`${cell(7, 'en', 0)} >> input`);
  for (const v of vals) { await page.keyboard.type(v); await page.keyboard.press('Tab'); }
  await page.locator('[data-grid="scores"] thead').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(2400); // 自動で保存されるのを待つ
  await shot(page, 'seiseki_in_02_type', [
    [1, [cell(7, 'en', 0), cell(7, 'en', 3)], 3],
    [2, '[data-grid="scores"] tbody tr:nth-child(7) td.ms-sum-td.ms-s-en', 3],
    [3, '.ms-save', 5],
  ], await band(page, '.ms-bar', LAST_ROW));

  // 3. 教科を数学に絞る：分野が出る。途中（黄色）と赤いセル
  await page.click('.ms-toolbar .ms-seg >> nth=1 >> button:has-text("数学")');
  await page.waitForTimeout(400);
  await page.click(`${cell(6, 'ma', 0)} >> input`);
  await page.keyboard.type('45'); // 数学1 は30点まで → 赤いセル
  await page.locator('[data-grid="scores"] thead').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, 'seiseki_in_03_subject', [
    [1, '.ms-toolbar .ms-seg >> nth=1 >> button:has-text("数学")', 3],
    [2, '[data-grid="scores"] thead tr:nth-child(2) th >> nth=0', 2],
    [3, '[data-grid="scores"] tbody tr:nth-child(5) input.gap >> nth=0', 3],
    [4, '[data-grid="scores"] input.bad', 3],
    [5, '.ms-progress', 4],
  ], await band(page, '.ms-toolbar', LAST_ROW, 6));
  // 赤いセルを直しておく
  await page.fill(`${cell(6, 'ma', 0)} >> input`, '');
  await page.click('.ms-toolbar .ms-seg >> nth=1 >> button:has-text("5教科")');
  await page.waitForTimeout(2200);

  // 4. 操作のボタン（名簿・取り込み・書き出し）
  const a = await page.locator('.ms-actions').boundingBox();
  await shot(page, 'seiseki_in_04_actions', [
    [1, 'button:has-text("入力シートを書き出す（CSV）")', 4],
    [2, 'button:has-text("入力シートを取り込む（CSV）")', 4],
    [3, 'button:has-text("貼り付けで取り込む")', 4],
  ], { x: a.x - 14, y: a.y - 8, width: a.width + 28, height: a.height + 16 });

  // 5. 書き出した CSV に社会の得点を入れて（Excel で入れた想定）取り込む。0003 の社会2 は配点を超える値にしておく
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("入力シートを書き出す（CSV）")')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^\uFEFF/, '');
  const lines = csv.trim().split(/\r?\n/).map((l) => l.split(','));
  const head = lines[0];
  const so = [1, 2, 3, 4, 5].map((i) => head.indexOf(`社会${i}`));
  const SO = [[15, 12, 18, 10, 14], [20, 15, 21, 13, 17], [12, 30, 16, 9, 11], [18, 14, 20, 12, 16], [10, 8, 13, 7, 9], [16, 13, 19, 11, 15], [19, 16, 22, 14, 16], [13, 11, 15, 9, 12]];
  lines.slice(1).forEach((r, ri) => so.forEach((ci, j) => { r[ci] = String(SO[ri % SO.length][j]); }));
  // 日本語のファイル名はパスで渡すと読まれないことがあるので、中身で渡す
  const buffer = Buffer.from('\uFEFF' + lines.map((l) => l.join(',')).join('\r\n') + '\r\n', 'utf8');
  await page.locator('.ms-actions input[type=file]').setInputFiles({ name: dl.suggestedFilename().endsWith('.csv') ? dl.suggestedFilename() : '2026 本番レベル模試 11月_日野校_入力シート.csv', mimeType: 'text/csv', buffer });
  await page.waitForSelector('.ms-modal-box');
  await page.waitForTimeout(300);
  const m = await page.locator('.ms-modal-box').boundingBox();
  await shot(page, 'seiseki_in_05_import', [
    [1, '.ms-file', 3],
    [2, '.ms-paste-sum > p >> nth=0', 3],
    [3, '.ms-paste-sum .warn >> nth=0', 3],
    [4, '.ms-modal-actions .ms-btn-in', 4],
  ], { x: m.x - 12, y: m.y - 12, width: m.width + 24, height: m.height + 24 });

  // 6. 取り込んだあと：知らせと進み具合
  await page.click('.ms-modal-actions .ms-btn-in');
  await page.click('.ms-toolbar .ms-seg >> nth=1 >> button:has-text("社会")');
  await page.waitForTimeout(2600);
  await shot(page, 'seiseki_in_06_done', [
    [1, '.ms-notice', 3],
    [2, '.ms-progress span:has-text("社会")', 3],
    [3, '[data-grid="scores"] tbody tr:nth-child(3) td.ms-s-so.ms-cell-td >> nth=1', 2],
    [4, '.ms-save', 5],
  ], await band(page, '.ms-bar', LAST_ROW));
  await page.click('.ms-toolbar .ms-seg >> nth=1 >> button:has-text("5教科")');

  // 7. 受験しない（取り込みの知らせは押して消しておく）
  await page.click('.ms-notice');
  await page.click('.ms-toolbar .ms-seg >> nth=0 >> button:has-text("名簿・志望校")');
  await page.waitForTimeout(400);
  await page.locator('[data-grid="roster"] tbody tr:nth-child(8) td.ms-c-absent input').check();
  await page.waitForTimeout(2400);
  await shot(page, 'seiseki_in_07_absent', [
    [1, '.ms-toolbar .ms-seg >> nth=0 >> button:has-text("名簿・志望校")', 3],
    [2, '[data-grid="roster"] thead th.ms-c-absent', 3],
    [3, '[data-grid="roster"] tbody tr:nth-child(8) td.ms-c-absent', 3],
    [4, '.ms-progress span >> nth=0', 3],
  ], await band(page, '.ms-bar', LAST_ROW, 12, 6));

  fs.writeFileSync(`${OUT}/boxes.json`, JSON.stringify(boxes, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
