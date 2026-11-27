// 原稿の HTML を A4 の PDF にする。 node pdf.js 原稿の絶対パス 出力.pdf
const { chromium } = require('playwright');
(async () => {
  const [src, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + src, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => { document.querySelectorAll('img').forEach((i) => { i.loading = 'eager'; }); return document.fonts.ready; });
  await page.waitForTimeout(500);
  await page.pdf({
    path: out, format: 'A4', printBackground: true,
    margin: { top: '14mm', bottom: '16mm', left: '15mm', right: '15mm' },
    displayHeaderFooter: true, headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#888;text-align:center;font-family:sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span>　部門会議 事前共有の確認・議題の追加・Zoom参加 マニュアル</div>',
  });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
