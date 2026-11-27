// イベント申込管理 教室担当者マニュアルの写真を撮る（赤枠と番号は、撮る前に画面の上に重ねて描く）。
//   1. 手元のアプリの .data/event.json に docs/manual/event/data.json を写す（架空の名簿・記録・フォームの回答）
//   2. アプリを起動する（npx next dev -p 3126）
//   3. node docs/manual/event/shots.js docs/manual/images http://localhost:3126
// 職員は架空（智翔 花子・小中等部）のログイン。手元の開発用の帯・「架空の名簿」の注意は、写真に入れないよう消してから撮る。
const { chromium } = require('playwright');
const OUT = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:3126';
const cookie = (name, campus) => Buffer.from(JSON.stringify({ name, campus }), 'utf8').toString('base64');

// 赤枠と番号を重ねる。marks = [[セレクタ（または Locator）, 番号, 余白]]
async function mark(page, marks) {
  for (const [target, n, pad = 4] of marks) {
    const loc = typeof target === 'string' ? page.locator(target).first() : target;
    const b = await loc.boundingBox();
    if (!b) throw new Error('no box: ' + target);
    await page.evaluate(({ b, n, pad }) => {
      const sx = window.scrollX, sy = window.scrollY;
      const f = document.createElement('div');
      f.className = 'manual-mark';
      f.style.cssText = `position:absolute;z-index:9999;pointer-events:none;box-sizing:border-box;left:${b.x + sx - pad}px;top:${b.y + sy - pad}px;width:${b.width + pad * 2}px;height:${b.height + pad * 2}px;border:2.5px solid #e0262f;border-radius:6px;`;
      const c = document.createElement('div');
      c.className = 'manual-mark';
      c.textContent = String(n);
      c.style.cssText = `position:absolute;z-index:10000;pointer-events:none;left:${Math.max(2, b.x + sx - pad - 11)}px;top:${Math.max(2, b.y + sy - pad - 11)}px;width:22px;height:22px;border-radius:50%;background:#e0262f;color:#fff;font:700 13px/22px sans-serif;text-align:center;`;
      document.body.append(f, c);
    }, { b, n, pad });
  }
}
const unmark = (page) => page.evaluate(() => document.querySelectorAll('.manual-mark').forEach((e) => e.remove()));
// 写真に入れないもの：手元の開発用の帯と「架空の名簿」の注意
const tidy = (page) => page.addStyleTag({ content: '.env-banner{display:none!important}.ev-warn{display:none!important}' });
// 要素のまわりだけを撮る（上下に余白）
async function clipOf(page, selectors, pad = 14) {
  let x1 = 1e9, y1 = 1e9, x2 = 0, y2 = 0;
  for (const s of selectors) {
    const b = await (typeof s === 'string' ? page.locator(s).first() : s).boundingBox();
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height);
  }
  const vp = page.viewportSize();
  return { x: 0, y: Math.max(0, y1 - pad), width: vp.width, height: Math.min(vp.height, y2 + pad) - Math.max(0, y1 - pad) };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'chishokan_session', value: cookie('智翔 花子', '小中等部'), url: BASE }]);
  const page = await ctx.newPage();
  const fld = (label) => page.locator(`.ev-fld:has(span:text-is("${label}"))`);
  const sel = (label) => fld(label).locator('select');
  const rowOf = (name) => page.locator(`.ev-list tbody tr:has-text("${name}")`);
  const shot = (name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...opts });

  // 図1 総合メニュー
  await page.goto(`${BASE}/`);
  await tidy(page);
  await page.waitForSelector('.portal-card');
  const card = page.locator('.portal-card:has-text("イベント申込管理")');
  await mark(page, [[card, 1]]);
  await shot('event_01_menu', { clip: await clipOf(page, ['.portal-card >> nth=0', card], 70) });

  // 図2 声掛け名簿（画面の全体）
  await page.goto(`${BASE}/event`);
  await tidy(page);
  await page.waitForSelector('.ev-list');
  await sel('校舎').selectOption('駅前校');
  await sel('表示する生徒').selectOption('all');
  await page.waitForTimeout(300);
  await mark(page, [
    ['.ev-tabs', 1], ['.ev-toolbar', 2], ['.ev-result', 3],
    [page.locator('.ev-actions button', { hasText: '一括で記録' }), 4], [page.locator('.ev-actions button', { hasText: '生徒を追加' }), 5],
    ['.ev-fetched', 6], ['.ev-scroll', 7, 2], [page.locator('.ev-actions button', { hasText: 'CSVで取り出す' }), 8],
  ]);
  await shot('event_02_list', { clip: { x: 0, y: 0, width: 1366, height: 860 } });
  await unmark(page);

  // 図3 名簿の1行（列の見方）
  const r1 = rowOf('森 いつき');
  const td = (n) => r1.locator('td').nth(n);
  await mark(page, [[td(0), 1, 0], [td(1), 2, 0], [td(2), 3, 0], [td(3), 4, 0], [td(4), 5, 0], [td(5), 6, 0], [td(6), 7, 0], [td(7), 8, 0], [td(8), 9, 0], [td(9), 10, 0]]);
  await shot('event_03_row', { clip: await clipOf(page, ['.ev-list thead', r1], 16) });
  await unmark(page);

  // 図4 スイッチを押した直後（保存中）→ 保存できたところ。保存を遅らせて撮る
  let hold = true;
  await page.route('**/api/event', async (route) => {
    if (route.request().method() === 'POST' && hold) await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  const r2 = rowOf('川上 りく');
  await r2.locator('[role=switch]').nth(1).click();
  await page.waitForTimeout(500);
  await mark(page, [[r2.locator('[role=switch]').nth(1), 1, 2], ['.ev-saving', 2], ['.ev-toast', 3]]);
  const clip4 = await clipOf(page, ['.ev-bar', '.ev-toast'], 12);
  await shot('event_04_saving', { clip: clip4 });
  await unmark(page);
  await page.waitForSelector('.ev-tick', { timeout: 8000 });
  await mark(page, [[r2.locator('[role=switch]').nth(1), 1, 2]]);
  await shot('event_05_saved', { clip: await clipOf(page, ['.ev-list thead', r2], 14) });
  await unmark(page);
  hold = false;
  await page.waitForTimeout(2200);

  // 図6 一括で記録
  await page.locator('.ev-actions button', { hasText: '一括で記録' }).click();
  await page.waitForSelector('.ev-bulk');
  for (const n of ['海野 そら', '山本 ゆい', '谷口 かなた', '花田 こはる']) await page.locator(`.ev-bulk-list li:has-text("${n}") input`).check();
  await page.locator('.ev-bulk-items label').nth(0).click();
  await page.waitForTimeout(200);
  await mark(page, [
    ['.ev-bulk-head', 1, 2], ['.ev-bulk-list', 2, 2], ['.ev-seg', 3, 2], ['.ev-bulk-items', 4, 2], ['.ev-bulk-summary', 5, 2],
    [page.locator('.ev-bulk .ev-modal-foot .ev-btn').last(), 6],
  ]);
  await shot('event_06_bulk', { clip: await clipOf(page, ['.ev-bulk'], 16) });
  await unmark(page);
  await page.locator('.ev-bulk .ev-modal-foot .ev-btn').last().click();
  await page.waitForSelector('.ev-bulk', { state: 'detached' });
  await page.waitForTimeout(2200);

  // 図7 申込の状況（申込済の印 → フォームの回答）
  const r3 = rowOf('青空 はな');
  await mark(page, [[r3.locator('.ev-badge.ok'), 1, 3], [rowOf('森 いつき').locator('.ev-noapply'), 2, 3]]);
  await shot('event_07_apply', { clip: await clipOf(page, ['.ev-list thead', r3], 14) });
  await unmark(page);
  await r3.locator('.ev-badge.ok').click();
  await page.waitForSelector('.ev-modal');
  const cancelBtn = page.locator('.ev-modal button', { hasText: 'この申込をキャンセルにする' });
  await mark(page, [[cancelBtn, 1]]);
  await shot('event_08_answer', { clip: await clipOf(page, ['.ev-modal-body'], 16) });
  await unmark(page);

  // 図12 申込をキャンセルにした行（撮ったら、キャンセルを取り消して元に戻す）
  await cancelBtn.click();
  await page.locator('.ev-ask button', { hasText: 'キャンセルにする' }).click();
  await page.waitForSelector('.ev-modal', { state: 'detached' });
  await page.waitForTimeout(2200);
  await mark(page, [[r3.locator('.ev-badge.off'), 1, 3], [r3.locator('.ev-stage.cancelled'), 2, 3]]);
  await shot('event_12_cancelled', { clip: await clipOf(page, ['.ev-list thead', r3], 14) });
  await unmark(page);
  await r3.locator('.ev-badge.off').click();
  await page.locator('.ev-modal button', { hasText: 'キャンセルを取り消す' }).click();
  await page.waitForSelector('.ev-modal', { state: 'detached' });
  await page.waitForTimeout(2200);

  // 図9 名簿外の申込
  await page.locator('.ev-tabs button', { hasText: '名簿外の申込' }).click();
  await page.waitForSelector('.ev-linker');
  await mark(page, [
    [page.locator('.ev-tabs button', { hasText: '名簿外の申込' }), 1, 2], [page.locator('.ev-linker').first(), 2, 6],
    [page.locator('button', { hasText: '名簿に足す' }), 3], [page.locator('button', { hasText: '回答を見る' }), 4],
  ]);
  await shot('event_09_outside', { clip: await clipOf(page, ['.ev-bar', '.ev-scroll'], 14) });
  await unmark(page);

  // 図10 生徒を追加（名簿外の申込から）
  await page.locator('button', { hasText: '名簿に足す' }).click();
  await page.waitForSelector('.ev-form');
  await mark(page, [['.ev-form-grid', 1, 4], [page.locator('.ev-form button[type=submit]'), 2]]);
  await shot('event_10_add', { clip: await clipOf(page, ['.ev-form'], 16) });
  await unmark(page);
  await page.locator('.ev-form button', { hasText: 'やめる' }).click();

  // 図11 スマホ
  const m = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  await m.addCookies([{ name: 'chishokan_session', value: cookie('智翔 花子', '小中等部'), url: BASE }]);
  const mp = await m.newPage();
  await mp.goto(`${BASE}/event`);
  await tidy(mp);
  await mp.waitForSelector('.ev-list');
  await mp.evaluate(() => window.scrollTo(0, 300));
  await mp.screenshot({ path: `${OUT}/event_11_phone.png` });
  await browser.close();
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
