// 門配管理マニュアルの画面写真。架空データ（.data/monpai.json）で起動した手元のアプリを撮る。
const { chromium } = await import('playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'));
const OUT = process.argv[2];
const only = process.argv[3];
const BASE = 'http://localhost:3100';
const b = await chromium.launch({ args: ['--lang=ja-JP'], env: { ...process.env, LANG: 'ja_JP.UTF-8', LANGUAGE: 'ja' } });
const sess = (campus) => Buffer.from(JSON.stringify({ name: '青木 健', campus })).toString('base64');
const HIDE = `.env-banner{display:none!important}`;

async function newPage({ w = 1280, h = 900, campus = 'RED個別', mobile = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', isMobile: mobile, hasTouch: mobile });
  await ctx.addCookies([{ name: 'chishokan_session', value: sess(campus), url: BASE }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('monpai.district', '大野'); } catch {} });
  const p = await ctx.newPage();
  await p.route('**/api/monpai/plan', (r) => r.fulfill({ json: PLAN }));
  return p;
}
async function go(p, url) {
  await p.goto(BASE + url, { waitUntil: 'networkidle', timeout: 120000 });
  await p.addStyleTag({ url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=block' });
  await p.addStyleTag({ content: HIDE + `body, button, input, select, textarea { font-family: 'Noto Sans JP', sans-serif !important; }` });
  await p.evaluate(() => document.fonts.ready);
  // 手元の保存先の注意書きは本番では出ないので消す
  await p.evaluate(() => document.querySelectorAll('.mp-note').forEach((e) => { if (e.textContent.includes('.data/')) e.remove(); }));
  await p.waitForTimeout(400);
}
// 赤枠と番号。marks: [{ loc, n, pad, at: 'tl'|'tr'|'l'|'r' }]
async function mark(p, marks) {
  for (const m of marks) {
    let bb = await m.loc.boundingBox();
    if (!bb) throw new Error('not found: ' + m.n);
    if (m.loc2) { const b2 = await m.loc2.boundingBox(); bb = { x: bb.x, y: bb.y, width: b2.x + b2.width - bb.x, height: bb.height }; }
    await p.evaluate(({ bb, n, pad, at }) => {
      const x = bb.x + scrollX - pad, y = bb.y + scrollY - pad, w = bb.width + pad * 2, h = bb.height + pad * 2;
      const box = document.createElement('div');
      box.className = 'shot-mark';
      Object.assign(box.style, { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', border: '3px solid #e0262f', borderRadius: '8px', zIndex: 99999, pointerEvents: 'none', boxSizing: 'border-box' });
      const c = document.createElement('div');
      c.textContent = n;
      const pos = { tl: [x - 13, y - 13], tr: [x + w - 13, y - 13], l: [x - 30, y + h / 2 - 13], r: [x + w + 4, y + h / 2 - 13], bl: [x - 13, y + h - 13] }[at];
      Object.assign(c.style, { position: 'absolute', left: pos[0] + 'px', top: pos[1] + 'px', width: '26px', height: '26px', borderRadius: '50%', background: '#e0262f', color: '#fff', font: '700 15px/26px sans-serif', textAlign: 'center', zIndex: 100000, boxShadow: '0 0 0 2px #fff' });
      document.body.append(box, c);
    }, { bb, n: String(m.n), pad: m.pad ?? 4, at: m.at ?? 'tl' });
  }
}
async function clipShot(p, name, clip) {
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!clip, clip });
  console.log('shot', name);
}
const want = (n) => !only || only.split(',').includes(n);

const PLAN = {
  ok: true, dropped: 1, basis: { months: 6, visits: 64, staff: 4 },
  summary: '大野小・中里小・春日小の計画がボトムに届いていないため、小学校の下校時刻（15:15）に3回足しました。過去の実績で受け取りの良い火・木を優先しています。',
  items: [
    { date: '2026-10-23', time: '15:15-15:45', school: '大野小', staff1: '森本', staff2: '', material: '冬期講習チラシ、ノート', planned: 45, why: '大野小は計画150部でボトム191部に41部足りない' },
    { date: '2026-10-26', time: '15:15-15:45', school: '中里小', staff1: '川口', staff2: '', material: '冬期講習チラシ', planned: 45, why: '中里小は10/9が雨で中止になり、ボトム128部に対して計画が45部' },
    { date: '2026-10-30', time: '15:15-15:45', school: '春日小', staff1: '', staff2: '', material: '冬期講習チラシ', planned: 10, why: '春日小はボトム137部に7部足りない。担当の候補が同じ時間に別の予定があるため未定' },
  ],
};

// ---- 1 メニュー画面 ----
if (want('01')) {
  const p = await newPage();
  await go(p, '/');
  const card = p.locator('a[href="/monpai"]').first();
  await card.scrollIntoViewIfNeeded();
  await mark(p, [{ loc: card, n: 1, pad: 4 }]);
  const bb = await card.boundingBox();
  await clipShot(p, '50_mp_portal', { x: 0, y: Math.max(0, bb.y + (await p.evaluate(() => scrollY)) - 260), width: 1280, height: 520 });
  await p.context().close();
}
// ---- 2 月間一覧（上） ----
if (want('02')) {
  const p = await newPage();
  await go(p, '/monpai');
  await mark(p, [
    { loc: p.locator('.app-header nav, header nav').first(), n: 1, pad: 4, at: 'r' },
    { loc: p.locator('.mp-tabs').first(), n: 2, pad: 4, at: 'tl' },
    { loc: p.locator('.mp-month').first(), n: 3, pad: 4, at: 'tr' },
    { loc: p.locator('.mp-summary-wrap'), n: 4, pad: 4, at: 'bl' },
    { loc: p.locator('.mp-rate-btn').first(), n: 5, pad: 3, at: 'r' },
  ]);
  const tb = await p.locator('.mp-legend').first().boundingBox();
  await clipShot(p, '51_mp_board_top', { x: 0, y: 0, width: 1280, height: tb.y + tb.height + 16 });
  await p.context().close();
}
// ---- 3 月間一覧（表） ----
if (want('03')) {
  const p = await newPage({ h: 2600 });
  await go(p, '/monpai');
  const conf = p.locator('.mp-conflicts');
  const grid = p.locator('.mp-grid');
  const r = (d) => grid.locator('tbody tr').nth(d - 1);
  await mark(p, [
    { loc: conf, n: 1, pad: 4, at: 'tl' },
    { loc: r(8).locator('.mp-cell').nth(0), n: 2, pad: 2, at: 'r' },
    { loc: r(16).locator('.mp-cell').nth(5), n: 3, pad: 2, at: 'l' },
    { loc: r(9).locator('.mp-cell').nth(4), n: 4, pad: 2, at: 'l' },
    { loc: r(22).locator('.mp-cell').nth(0), n: 5, pad: 2, at: 'r' },
    { loc: r(27).locator('.mp-cell').nth(2), n: 6, pad: 2, at: 'r' },
  ]);
  const cb = await conf.boundingBox();
  const lg = await p.locator('.mp-legend').nth(1).boundingBox();
  await clipShot(p, '52_mp_board_grid', { x: 0, y: cb.y - 20, width: 1280, height: lg.y + lg.height - cb.y + 36 });
  await p.context().close();
}
// ---- 4 記録の入力 ----
if (want('04')) {
  const p = await newPage({ h: 1300 });
  await go(p, '/monpai');
  await p.locator('.mp-grid tbody tr').nth(5).locator('.mp-cell').nth(1).click();
  await p.waitForTimeout(300);
  const f = p.locator('.mp-modal .mp-form > *');
  const modal = p.locator('.mp-modal');
  await mark(p, [
    { loc: p.locator('.mp-modal .mp-form > label').nth(0), n: 1, pad: 3, at: 'l' },
    { loc: p.locator('.mp-modal .mp-form > .mp-form-row').nth(0), n: 2, pad: 3, at: 'l' },
    { loc: p.locator('.mp-modal .mp-form > label').nth(3), n: 3, pad: 3, at: 'l' },
    { loc: p.locator('.mp-modal .mp-form > .mp-form-row').nth(1), n: 4, pad: 3, at: 'l' },
    { loc: p.locator('.mp-modal .mp-check'), n: 5, pad: 3, at: 'l' },
    { loc: p.locator('.mp-modal .mp-form > label').filter({ hasText: '理由' }), n: 6, pad: 3, at: 'l' },
    { loc: p.locator('.mp-modal .mp-modal-foot .primary'), n: 7, pad: 3, at: 'r' },
  ]);
  const mb = await modal.boundingBox();
  await clipShot(p, '53_mp_record_form', { x: mb.x - 44, y: mb.y - 14, width: mb.width + 88, height: mb.height + 28 });
  await p.context().close();
}
// ---- 5 AIの計画案 ----
if (want('05')) {
  const p = await newPage({ h: 1300 });
  await go(p, '/monpai');
  await p.locator('.mp-btn.ai').click();
  await p.locator('.mp-modal.wide').waitFor();
  await p.locator('.mp-plan-item input').nth(2).uncheck();
  await p.waitForTimeout(200);
  const modal = p.locator('.mp-modal.wide');
  await mark(p, [
    { loc: p.locator('.mp-plan-summary'), n: 1, pad: 3, at: 'l' },
    { loc: p.locator('.mp-plan-item').nth(0), n: 2, pad: 3, at: 'l' },
    { loc: p.locator('.mp-plan-item input').nth(2), n: 3, pad: 4, at: 'l' },
    { loc: p.locator('.mp-modal.wide .mp-modal-foot .primary'), n: 4, pad: 3, at: 'r' },
  ]);
  const mb = await modal.boundingBox();
  await clipShot(p, '54_mp_ai_plan', { x: mb.x - 44, y: mb.y - 14, width: mb.width + 88, height: mb.height + 28 });
  await p.context().close();
}
// ---- 6 実績報告（スマホ） ----
if (want('06')) {
  const p = await newPage({ w: 390, h: 844, mobile: true });
  await go(p, '/monpai/report');
  const card = p.locator('.mp-card:not(.upcoming):not(.done)').first();
  await card.locator('input').nth(1).fill('雨上がりで受け取りが少なめ');
  await card.locator('input').nth(0).fill('40');
  await p.waitForTimeout(200);
  await mark(p, [
    { loc: p.locator('.mp-report .mp-check').first(), n: 1, pad: 3, at: 'l' },
    { loc: card.locator('.mp-card-form'), n: 2, pad: 4, at: 'tl' },
    { loc: card.locator('.mp-card-actions .primary'), n: 3, pad: 3, at: 'bl' },
    { loc: card.locator('.mp-card-actions .mp-btn').first(), n: 4, pad: 3, at: 'bl' },
  ]);
  await clipShot(p, '55_mp_report', { x: 0, y: 0, width: 390, height: 1240 });
  await p.context().close();
}
// ---- 7 集計 ----
if (want('07')) {
  const p = await newPage();
  await go(p, '/monpai/summary');
  await mark(p, [
    { loc: p.locator('.mp-month [aria-label="前の月"]'), loc2: p.locator('.mp-month [aria-label="次の月"]'), n: 1, pad: 4, at: 'tl' },
    { loc: p.locator('.mp-btn', { hasText: '集計CSV' }), n: 2, pad: 3, at: 'tl' },
    { loc: p.locator('.mp-btn', { hasText: '記録CSV' }), n: 3, pad: 3, at: 'tr' },
    { loc: p.locator('.mp-note.warn'), n: 4, pad: 3, at: 'tl' },
    { loc: p.locator('.mp-kpis'), n: 5, pad: 4, at: 'tl' },
    { loc: p.locator('.mp-summary').first(), n: 6, pad: 4, at: 'tl' },
  ]);
  const lb = await p.locator('.mp-legend').first().boundingBox();
  await clipShot(p, '56_mp_summary', { x: 0, y: 0, width: 1280, height: lb.y + lb.height + 16 });
  // 下のほう（担当別・未報告・中止）
  const h2 = p.locator('h2.mp-h2', { hasText: '担当別' });
  const sy0 = await h2.boundingBox();
  const full = await p.evaluate(() => document.documentElement.scrollHeight);
  await clipShot(p, '57_mp_summary_lists', { x: 0, y: sy0.y - 10, width: 1280, height: Math.min(full - sy0.y + 10, 1600) });
  await p.context().close();
}
// ---- 8 配布物 ----
if (want('08')) {
  const p = await newPage();
  await go(p, '/monpai/materials');
  await mark(p, [
    { loc: p.locator('.mp-usage-head select'), n: 1, pad: 3, at: 'l' },
    { loc: p.locator('.mp-summary').nth(0), n: 2, pad: 4, at: 'tl' },
    { loc: p.locator('.mp-summary').nth(1), n: 3, pad: 4, at: 'tl' },
    { loc: p.locator('.mp-panels .mp-card').nth(0), n: 4, pad: 4, at: 'tl' },
    { loc: p.locator('.mp-panels .mp-card').nth(1), n: 5, pad: 4, at: 'tl' },
  ]);
  const pb = await p.locator('.mp-panels').boundingBox();
  await clipShot(p, '58_mp_materials', { x: 0, y: 0, width: 1280, height: pb.y + pb.height + 20 });
  await p.context().close();
}
// ---- 9 学校マスタ ----
if (want('09')) {
  const p = await newPage({ campus: '総務・人事・支援・管理', h: 1200 });
  await go(p, '/monpai/schools');
  await p.locator('.mp-schools .mp-tab', { hasText: '大野' }).click();
  await p.waitForTimeout(200);
  await mark(p, [
    { loc: p.locator('.mp-schools .mp-tabs'), n: 1, pad: 4, at: 'tl' },
    { loc: p.locator('.mp-edit-table'), n: 2, pad: 4, at: 'tl' },
    { loc: p.locator('.mp-schools > section.mp-card'), n: 3, pad: 4, at: 'tl' },
    { loc: p.locator('.mp-summary').nth(1), n: 4, pad: 4, at: 'tl' },
    { loc: p.locator('.mp-add-row').nth(1), n: 5, pad: 4, at: 'tl' },
  ]);
  const lb = await p.locator('.mp-legend').last().boundingBox();
  await clipShot(p, '59_mp_schools', { x: 0, y: 0, width: 1280, height: lb.y + lb.height + 16 });
  await p.context().close();
}
await b.close();
