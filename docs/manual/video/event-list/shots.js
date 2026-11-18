// 動画「イベント申込管理 声掛け名簿の使い方」の画面写真を撮る（赤枠なし。強調する枠の位置は shots/<名前>.json）。
// 使い方：手元のアプリの .data/event.json に docs/manual/event/data.json を写してから起動し（npx next dev -p 3126）、
//   node docs/manual/video/event-list/shots.js http://localhost:3126
// 写真は2倍の解像度、.json の w・h・boxes は CSS の px（slides.html がそのまま使う）。職員は架空（智翔 花子・小中等部）。
// 保存中の写真は、保存の返事を遅らせて撮る。撮るたびに .data/event.json を data.json で上書きすること（途中で記録を付けるため）。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
const BASE = process.argv[2] || 'http://localhost:3126';
const W = 1366, H = 800;
// 写真に入れる範囲。名簿の写真は、右端の「メモ」の列を外して大きく見せる（LIST）。窓の写真は窓のまわりだけ（DIALOG）
const FULL = { x: 0, y: 0, width: W, height: H };
const LIST = { x: 14, y: 0, width: 1136, height: H };
const DIALOG = { x: 300, y: 0, width: 766, height: H };

// marks = [[番号, セレクタ（または Locator）, 余白]]。scrollY は、撮る前に画面を下へ送る量
async function shot(page, name, marks, clip = FULL, scrollY = 0) {
  await page.evaluate((y) => window.scrollTo(0, y), scrollY);
  await page.waitForTimeout(250);
  const boxes = [];
  for (const [n, target, pad = 4] of marks) {
    const b = await (typeof target === 'string' ? page.locator(target).first() : target).boundingBox();
    if (!b) throw new Error(`no box: ${name} ${n}`);
    boxes.push({ n, x: Math.round(b.x - pad - clip.x), y: Math.round(b.y - pad - clip.y), w: Math.round(b.width + pad * 2), h: Math.round(b.height + pad * 2) });
  }
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip });
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ w: clip.width, h: clip.height, boxes }, null, 1));
  console.log(name, boxes.length);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'ja-JP' });
  await ctx.addCookies([{ name: 'chishokan_session', value: Buffer.from(JSON.stringify({ name: '智翔 花子', campus: '小中等部' })).toString('base64'), url: BASE }]);
  const page = await ctx.newPage();
  // 手元で動かしていることを示す帯と「架空の名簿」の注意は写さない
  const tidy = () => page.addStyleTag({ content: '.env-banner{display:none!important}.ev-warn{display:none!important}' });
  const fld = (label) => page.locator(`.ev-fld:has(span:text-is("${label}"))`);
  const rowOf = (name) => page.locator(`.ev-list tbody tr:has-text("${name}")`);

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await tidy();
  await shot(page, 'v01_menu', [[1, page.locator('.portal-card:has-text("イベント申込管理")'), 8]], { x: 0, y: 0, width: W, height: 640 });

  await page.goto(BASE + '/event', { waitUntil: 'networkidle' });
  await tidy();
  await page.waitForSelector('.ev-list');
  await fld('校舎').locator('select').selectOption('駅前校');
  await fld('表示する生徒').locator('select').selectOption('all');
  await page.waitForTimeout(300);
  const r1 = rowOf('海野 そら'), r2 = rowOf('森 いつき');
  await shot(page, 'v02_list', [
    [1, fld('校舎'), 6], [2, fld('表示する生徒'), 6], [3, fld('並び順'), 6],
    [4, r1.locator('td').nth(0), 0], [4, r2.locator('td').nth(0), 0],
    [5, r1.locator('td').nth(8), 0], [5, r2.locator('td').nth(8), 0],
  ], LIST);

  // スイッチを押した直後（保存中）→ 保存できたところ
  let hold = true;
  await page.route('**/api/event', async (route) => {
    if (route.request().method() === 'POST' && hold) await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  const r3 = rowOf('川上 りく');
  const talk = r3.locator('[role=switch]').nth(1);
  await talk.click();
  await page.waitForTimeout(500);
  await shot(page, 'v03_saving', [[1, talk, 6], [2, '.ev-toast', 6]], LIST);
  await page.waitForSelector('.ev-tick', { timeout: 8000 });
  await shot(page, 'v04_saved', [[1, talk, 6]], LIST);
  hold = false;
  await page.waitForTimeout(2200);

  // 反応とメモ
  await r3.locator('select.ev-reaction').selectOption('検討中');
  await r3.locator('.ev-memo').fill('部活の予定を確かめるとのこと');
  await r3.locator('.ev-memo').blur();
  await page.waitForTimeout(2500);
  await shot(page, 'v05_reaction', [[1, r3.locator('td').nth(5), 0], [2, r3.locator('td').nth(9), 0], [3, r3.locator('td').nth(6), 0]]);

  // 一括で記録
  await page.locator('.ev-actions button', { hasText: '一括で記録' }).click();
  await page.waitForSelector('.ev-bulk');
  for (const n of ['海野 そら', '山本 ゆい', '谷口 かなた', '花田 こはる']) await page.locator(`.ev-bulk-list li:has-text("${n}") input`).check();
  await page.locator('.ev-bulk-items label').nth(0).click();
  await page.waitForTimeout(200);
  const run = page.locator('.ev-bulk .ev-modal-foot .ev-btn').last();
  await shot(page, 'v06_bulk', [[1, '.ev-bulk-list', 4], [2, '.ev-bulk-action', 4], [3, run, 6]], DIALOG);
  await run.click();
  await page.waitForSelector('.ev-bulk', { state: 'detached' });
  await page.waitForTimeout(2500);

  // 申込の状況
  await shot(page, 'v07_apply', [[1, rowOf('青空 はな').locator('.ev-badge.ok'), 6], [2, r2.locator('.ev-noapply'), 6]], LIST, 250);

  // 名簿外の申込
  await page.locator('.ev-tabs button', { hasText: '名簿外の申込' }).click();
  await page.waitForSelector('.ev-linker');
  await shot(page, 'v08_outside', [
    [1, page.locator('.ev-tabs button', { hasText: '名簿外の申込' }), 4], [2, page.locator('.ev-linker').first(), 6],
    [3, page.locator('button', { hasText: '名簿に足す' }), 6],
  ]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
