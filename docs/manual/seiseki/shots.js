// 成績管理「生徒の追加」マニュアルの写真を撮る（架空の生徒・架空の職員）。
// 使い方：アプリを手元で起動し（.data/moshi.json に架空の回（時間割の時刻も）と名簿＝日野校 0001〜0005 を入れておく）、
//   node docs/manual/seiseki/shots.js 出力フォルダ http://localhost:3125
// 出力フォルダに写真（2倍）と boxes.json（赤枠の位置）ができる。赤枠は annotate.py で付ける。
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:3125';
const boxes = {};

async function box(page, selector, pad = 4) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error('no box: ' + selector);
  return { x: b.x - pad, y: b.y - pad, w: b.width + pad * 2, h: b.height + pad * 2 };
}
async function shot(page, name, marks, opts = {}) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  const list = [];
  for (const [n, sel, pad] of marks) list.push({ n, ...(await box(page, sel, pad ?? 4)) });
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: opts.clip });
  boxes[name] = { marks: list, clip: opts.clip || null };
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

  // 1. メニュー：成績管理のカード
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await shot(page, 'seiseki_01_menu', [[1, '.portal-card:has-text("成績管理")', 6]], { clip: { x: 0, y: 0, width: 1280, height: 520 } });

  // 2. 成績入力：回・校舎・生徒を追加
  await page.goto(BASE + '/moshi', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ms-bar');
  await page.selectOption('.ms-bar label:nth-child(2) select', '日野校');
  await page.waitForTimeout(500);
  await page.click('.ms-seg button:has-text("名簿・志望校")');
  await page.waitForTimeout(300);
  await shot(page, 'seiseki_02_entry', [
    [1, '.ms-bar label:nth-child(1) select', 4],
    [2, '.ms-bar label:nth-child(2) select', 4],
    [3, 'button:has-text("＋ 生徒を追加")', 5],
  ], { clip: { x: 0, y: 0, width: 1280, height: 560 } });

  // 3. ＋ 生徒を追加 → 0301 の行。氏名・性別・志望校を入れる
  await page.click('button:has-text("＋ 生徒を追加")');
  await page.waitForTimeout(500);
  const last = '[data-grid="roster"] tbody tr:last-child';
  await shot(page, 'seiseki_03_added', [
    [1, `${last} input[data-c="0"]`, 3],
    [2, `${last} input[data-c="1"]`, 3],
  ], { clip: { x: 0, y: 0, width: 1280, height: 620 } });
  await page.fill(`${last} input[data-c="1"]`, '智翔 次郎');
  await page.press(`${last} input[data-c="1"]`, 'Tab');
  await page.selectOption(`${last} select[data-c="2"]`, '男');
  await page.fill(`${last} input[data-c="3"]`, '518-01');
  await page.press(`${last} input[data-c="3"]`, 'Tab');
  await page.fill(`${last} input[data-c="4"]`, '佐世保西');
  await page.waitForTimeout(200);
  // 学校名の一部を打つと候補が出る（候補の一覧は写真に写らないので、コードで決める）
  await page.fill(`${last} input[data-c="4"]`, '520-01');
  await page.press(`${last} input[data-c="4"]`, 'Tab');
  await page.evaluate(() => (document.activeElement)?.blur?.());
  await page.waitForTimeout(2500); // 自動で保存されるのを待つ
  await shot(page, 'seiseki_04_filled', [
    [1, `${last} input[data-c="1"]`, 3],
    [2, `${last} select[data-c="2"]`, 3],
    [3, `${last} td.ms-c-choice >> nth=0`, 3],
    [4, '.ms-save', 4],
    [5, `${last} button.ms-x`, 3],
  ], { clip: { x: 0, y: 0, width: 1280, height: 620 } });

  // 4. 受験票：回・校舎・生徒の一覧・印刷する
  await page.goto(BASE + '/moshi/ticket', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ms-bar');
  await page.selectOption('.ms-bar label:nth-child(2) select', '日野校');
  await page.waitForTimeout(600);
  await shot(page, 'seiseki_05_ticket', [
    [1, '.ms-bar label:nth-child(1) select', 4],
    [2, '.ms-bar label:nth-child(2) select', 4],
    [3, '.ms-ticket-pick', 4],
    [4, 'button:has-text("印刷する")', 5],
  ], { clip: { x: 0, y: 0, width: 1280, height: 700 } });

  fs.writeFileSync(`${OUT}/boxes.json`, JSON.stringify(boxes, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
