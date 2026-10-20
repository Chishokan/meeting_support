// 門配管理マニュアルの PDF を作る。使い方: node pdf.mjs <原稿の絶対パス> <PDF の出力先>
const { chromium } = await import('playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'));
const [src, out, screen] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1400 } });
await p.goto('file://' + src, { waitUntil: 'networkidle' });
await p.evaluate(async () => { document.querySelectorAll('img').forEach((i) => { i.loading = 'eager'; }); await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))); await document.fonts.ready; });
if (screen) { await p.screenshot({ path: screen, fullPage: true }); }
await p.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;font-size:8pt;color:#777;padding:0 16mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>門配管理 操作マニュアル</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>' });
await b.close();
