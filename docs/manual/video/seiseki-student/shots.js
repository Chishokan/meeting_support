// 動画「成績管理 生徒の追加」の画面写真を撮る（赤枠なし。強調する枠の位置は shots/<名前>.json）。
// 使い方：アプリの写しを手元で起動し（.data/moshi.json に架空の回と名簿＝日野校 0001〜0005 を入れておく）、
//   node docs/manual/video/seiseki-student/shots.js http://localhost:3125
// 写真は2倍の解像度、.json の w・h・boxes は CSS の px（slides.html がそのまま使う）。職員は架空（智翔 花子・小中等部）。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
const BASE = process.argv[2] || 'http://localhost:3125';

async function box(page, selector, pad = 4) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error('no box: ' + selector);
  return { x: b.x - pad, y: b.y - pad, w: b.width + pad * 2, h: b.height + pad * 2 };
}
async function shot(page, name, marks, clip) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const boxes = [];
  for (const [n, sel, pad] of marks) {
    const b = await box(page, sel, pad ?? 4);
    boxes.push({ n, x: Math.round(b.x - clip.x), y: Math.round(b.y - clip.y), w: Math.round(b.w), h: Math.round(b.h) });
  }
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip });
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ w: clip.width, h: clip.height, boxes }, null, 1));
  console.log(name, boxes.length);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: 'ja-JP' });
  await ctx.addCookies([{ name: 'chishokan_session', value: Buffer.from(JSON.stringify({ name: '智翔 花子', campus: '小中等部' })).toString('base64'), domain: 'localhost', path: '/' }]);
  // 手元で動かしていることを示す帯（開発環境）は写さない
  await ctx.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '.env-banner { display: none !important; }';
      document.head.appendChild(st);
    });
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await shot(page, 'v01_menu', [[1, '.portal-card:has-text("成績管理")', 8]], { x: 0, y: 0, width: 1280, height: 600 });

  await page.goto(BASE + '/moshi', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ms-bar');
  await page.selectOption('.ms-bar label:nth-child(2) select', '日野校');
  await page.waitForTimeout(500);
  await page.click('.ms-seg button:has-text("名簿・志望校")');
  await page.waitForTimeout(300);
  const clip = { x: 0, y: 0, width: 1280, height: 640 };
  await shot(page, 'v02_entry', [
    [1, '.ms-bar label:nth-child(1) select', 5],
    [2, '.ms-bar label:nth-child(2) select', 5],
    [3, 'button:has-text("＋ 生徒を追加")', 6],
  ], clip);

  await page.click('button:has-text("＋ 生徒を追加")');
  await page.waitForTimeout(500);
  const last = '[data-grid="roster"] tbody tr:last-child';
  await shot(page, 'v03_added', [
    [1, `${last} input[data-c="0"]`, 4],
    [2, `${last} input[data-c="1"]`, 4],
  ], clip);

  await page.fill(`${last} input[data-c="1"]`, '智翔　次郎');
  await page.press(`${last} input[data-c="1"]`, 'Tab');
  await page.selectOption(`${last} select[data-c="2"]`, '男');
  await page.fill(`${last} input[data-c="3"]`, '518-01');
  await page.press(`${last} input[data-c="3"]`, 'Tab');
  await page.fill(`${last} input[data-c="4"]`, '520-01');
  await page.press(`${last} input[data-c="4"]`, 'Tab');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(2500); // 自動で保存されるのを待つ
  await shot(page, 'v04_filled', [
    [1, `${last} input[data-c="1"]`, 4],
    [2, `${last} select[data-c="2"]`, 4],
    [3, `${last} td.ms-c-choice >> nth=0`, 4],
    [4, '.ms-save', 5],
    [5, `${last} button.ms-x`, 4],
    [6, `${last} input[data-c="0"]`, 4],
  ], clip);

  await page.goto(BASE + '/moshi/import', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ms-import-sec');
  await page.waitForTimeout(400);
  const sec = '.ms-import > section:nth-of-type(2)';
  const top = (await page.locator('.ms-bar').boundingBox()).y - 24;
  const sb = await page.locator(sec).boundingBox();
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, top));
  await page.waitForTimeout(300);
  const sy = await page.evaluate(() => window.scrollY);
  const iclip = { x: 0, y: 0, width: 1280, height: Math.min(800, Math.round(sb.y + sb.height + 20 - sy)) };
  const boxes = [];
  for (const [n, sel, pad] of [[1, '.ms-bar', 5], [2, `${sec} input[type=file]`, 5], [3, `${sec} select`, 5], [4, `${sec} button:has-text("名簿に入れる")`, 6]]) {
    const b = await box(page, sel, pad);
    boxes.push({ n, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
  }
  await page.screenshot({ path: path.join(OUT, 'v05_import.png'), clip: iclip });
  fs.writeFileSync(path.join(OUT, 'v05_import.json'), JSON.stringify({ w: iclip.width, h: iclip.height, boxes }, null, 1));
  console.log('v05_import', boxes.length);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
