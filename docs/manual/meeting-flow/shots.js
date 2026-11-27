// 議事録生成の新しい流れ（事前共有の確認・議題の追加・Zoom）マニュアルの写真を撮る。
//   1. リポジトリ Chishokan/meeting_support でアプリを手元で起動する（npx next dev -p 3127）
//   2. リポジトリの直下で node <このファイル> 出力フォルダ http://localhost:3127
// 事前共有の API の応答は data.js の架空の会議に差し替える（本番のスプレッドシート・Zoom には何も書き込まない）。
// 赤枠と番号は、撮る前に画面の上に重ねて描く（docs/manual/event/shots.js と同じやり方）。
const { chromium } = require('playwright');
const { rows, AGENDA_A } = require('./data.js');
const OUT = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:3127';
const cookie = (name, campus) => Buffer.from(JSON.stringify({ name, campus }), 'utf8').toString('base64');
const ADDED = `${AGENDA_A}\n5. 冬期講習チラシの校門前配布の分担（智翔）`;

// VIDEO=1 のときは枠を描かずに位置だけ覚え、写真の横に <名前>.json（動画の強調枠）を書く。
const VIDEO = process.env.VIDEO === '1';
let marked = [];
async function mark(page, marks) {
  for (const [target, n, pad = 4] of marks) {
    const loc = typeof target === 'string' ? page.locator(target).first() : target;
    const b = await loc.boundingBox();
    if (!b) throw new Error('no box: ' + target);
    marked.push({ n, x: b.x - pad, y: b.y - pad, w: b.width + pad * 2, h: b.height + pad * 2 });
    if (VIDEO) continue;
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
const unmark = (page) => { marked = []; return page.evaluate(() => document.querySelectorAll('.manual-mark').forEach((e) => e.remove())); };
const tidy = async (page) => {
  await page.addStyleTag({ content: '@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap"); *{font-family:"Noto Sans JP",sans-serif!important} .env-banner{display:none!important}' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
};
async function box(page, selectors, pad = 14, full = false) {
  let x1 = 1e9, y1 = 1e9, x2 = 0, y2 = 0;
  for (const s of selectors) {
    const b = await (typeof s === 'string' ? page.locator(s).first() : s).boundingBox();
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height);
  }
  const vp = page.viewportSize();
  if (full) return { x: 0, y: Math.max(0, y1 - pad), width: vp.width, height: y2 - y1 + pad * 2 };
  return { x: Math.max(0, x1 - pad), y: Math.max(0, y1 - pad), width: Math.min(vp.width, x2 + pad) - Math.max(0, x1 - pad), height: y2 - y1 + pad * 2 };
}

async function open(browser, who, campus, state) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await ctx.addCookies([{ name: 'chishokan_session', value: cookie(who, campus), url: BASE }]);
  const page = await ctx.newPage();
  // 時計を 2026/11/20 9:30 に合わせる（カードの「今日」を固定する）
  await page.clock.setFixedTime(new Date('2026-11-20T09:30:00+09:00'));
  await page.route('**/api/dept-minutes/preshare', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { ok: true, items: rows(state), zoom: { accounts: [], defaultAccount: '' } } });
    return r.fulfill({ json: { ok: true, id: 'P-A', updated: true, ts: '2026/11/20 10:15' } });
  });
  await page.route('**/api/dept-minutes/preshare/confirm', (r) => r.fulfill({ json: { ok: true, confirmed: ['日野 一郎', '大和 さくら', '智翔 花子'] } }));
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForSelector('.pre-item');
  await tidy(page);
  return page;
}

(async () => {
  const browser = await chromium.launch();
  const fs = require('fs');
  const shot = async (page, name, clip) => {
    await page.screenshot({ path: `${OUT}/${name}.png`, clip });
    if (VIDEO) {
      const boxes = marked.map((m) => ({ n: m.n, x: Math.round(m.x - clip.x), y: Math.round(m.y - clip.y), w: Math.round(m.w), h: Math.round(m.h) }));
      fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ w: Math.round(clip.width), h: Math.round(clip.height), boxes }, null, 1));
    }
  };
  const card = (page, t) => page.locator('.pre-item', { hasText: t });

  // ── 出席者（智翔 花子）として ──
  let page = await open(browser, '智翔 花子', '小中等部', {});
  const A = card(page, '小中等部 定例部門会議');

  // 図1 ダッシュボードの事前共有
  await mark(page, [
    [page.locator('nav a, aside a', { hasText: 'ダッシュボード' }).first(), 1, 2],
    [page.locator('.dash-panel h2', { hasText: '部門会議の事前共有' }), 2, 4],
    [A.locator('.dm-meet-head'), 3, 3],
    [A.locator('.pre-seen'), 4, 3],
    [A.locator('.dm-detail'), 5, 3],
    [A.locator('.zoom-btn'), 6, 3],
  ]);
  await shot(page, 'mt_01_dashboard', { x: 0, y: 0, width: 800, height: 780 });
  await unmark(page);

  // 図2 カード1枚
  await shot(page, 'mt_02_card', await box(page, [A], 10));

  // 図3 詳細（確認する前）
  await A.locator('.dm-detail').click();
  await page.waitForSelector('.pre-modal');
  await page.waitForTimeout(300);
  const M = page.locator('.pre-modal');
  await mark(page, [
    [M.locator('.dm-modal-head > div').first(), 1, 4],
    [M.locator('.pre-agenda'), 2, 4],
    [M.locator('.pre-confirm-head'), 3, 3],
    [M.locator('.pre-confirm-me'), 4, 4],
    [M.locator('.dm-modal-foot .dm-copy', { hasText: '議題の修正' }), 5, 3],
    [M.locator('.dm-modal-foot .zoom-btn').first(), 6, 3],
  ]);
  await shot(page, 'mt_03_detail', await box(page, ['.pre-modal'], 16));
  await unmark(page);

  // 図4 「議題を確認しました」にチェック
  await M.locator('.pre-confirm-me input').check();
  await page.waitForTimeout(600);
  await mark(page, [[M.locator('.pre-confirm-me'), 1, 4], [M.locator('.pre-confirm-list li.ok', { hasText: '智翔 花子' }), 2, 3]]);
  await shot(page, 'mt_04_confirmed', await box(page, [M.locator('.share-detail-sec h3'), M.locator('.pre-confirm')], 14));
  await unmark(page);

  // 図5 議題の修正（書き足しているところ）
  await M.locator('.dm-modal-foot .dm-copy', { hasText: '議題の修正' }).click();
  const ta = M.locator('textarea.pre-agenda-edit');
  await ta.fill(ADDED);
  await ta.evaluate((e) => { e.selectionStart = e.selectionEnd = e.value.length; });
  await page.waitForTimeout(300);
  await mark(page, [
    [ta, 1, 3],
    [M.locator('.dm-hint'), 2, 3],
    [M.locator('.dm-modal-foot .dm-modal-edit'), 3, 3],
    [M.locator('.dm-modal-foot .dm-copy', { hasText: 'やめる' }), 4, 3],
  ]);
  await shot(page, 'mt_05_edit', await box(page, ['.pre-modal'], 16));
  await unmark(page);

  // 図6 保存したところ（更新：日時 名前）
  await M.locator('.dm-modal-foot .dm-modal-edit').click();
  await page.waitForSelector('.dm-modal-edited');
  await page.waitForTimeout(300);
  await mark(page, [[M.locator('.dm-modal-edited'), 1, 3], [M.locator('.pre-agenda'), 2, 4]]);
  await shot(page, 'mt_06_saved', await box(page, [M.locator('.dm-modal-head'), M.locator('.pre-agenda')], 14));
  await unmark(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 図12 Zoom（出席者）：詳細の Zoom の行・ホスト担当・ボタン
  await A.locator('.dm-detail').click();
  await page.waitForSelector('.pre-modal');
  await page.waitForTimeout(300);
  await mark(page, [
    [M.locator('.dm-modal-sub', { hasText: 'Zoom：' }), 1, 0],
    [M.locator('.pre-host'), 2, 0],
    [M.locator('.dm-modal-foot .zoom-btn').first(), 3, 3],
    [M.locator('.dm-modal-foot .dm-copy', { hasText: 'コピー' }), 4, 3],
  ]);
  await shot(page, 'mt_08_zoom_detail', await box(page, [M.locator('.dm-modal-head'), M.locator('.dm-modal-foot')], 14));
  await unmark(page);
  await page.keyboard.press('Escape');
  await page.context().close();

  // 図11 Zoom（出席者）：カードの［Zoomに参加］とホスト担当
  page = await open(browser, '智翔 花子', '小中等部', {});
  const A2 = card(page, '小中等部 定例部門会議');
  await mark(page, [[A2.locator('.zoom-btn'), 1, 3], [A2.locator('.zoom-host'), 2, 3]]);
  await shot(page, 'mt_07_zoom_card', await box(page, [A2], 10));
  await unmark(page);
  await page.context().close();

  // ── ホスト担当（日野 一郎）として：ホストとして開始 ──
  page = await open(browser, '日野 一郎', '小中等部', { host: true, confirmedA: ['日野 一郎', '大和 さくら', '智翔 花子'], agendaA: ADDED, editedA: { at: '2026/11/20 10:15', by: '智翔 花子' } });
  const H = card(page, '小中等部 定例部門会議');
  await mark(page, [[H.locator('.zoom-btn.host'), 1, 3], [H.locator('.zoom-btn.sub'), 2, 3], [H.locator('.zoom-host'), 3, 3]]);
  await shot(page, 'mt_09_host_card', await box(page, [H], 10));
  await unmark(page);
  await H.locator('.dm-detail').click();
  await page.waitForSelector('.pre-modal');
  await page.waitForTimeout(300);
  const MH = page.locator('.pre-modal');
  await mark(page, [[MH.locator('.pre-host'), 1, 2], [MH.locator('.dm-modal-foot .zoom-btn.host'), 2, 3], [MH.locator('.dm-modal-foot .zoom-btn.sub'), 3, 3]]);
  await shot(page, 'mt_10_host_detail', await box(page, [MH.locator('.dm-modal-head'), MH.locator('.dm-modal-foot')], 14));
  await unmark(page);
  await page.context().close();

  // 共通ログインで入っていないホスト担当
  page = await open(browser, '日野 一郎', '小中等部', { hostLoginNeeded: true });
  const L = card(page, '小中等部 定例部門会議');
  await mark(page, [[L.locator('.zoom-err'), 1, 3]]);
  await shot(page, 'mt_11_host_login', await box(page, [L], 10));
  await unmark(page);
  await page.context().close();

  await browser.close();
})();
