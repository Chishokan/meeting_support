// 智翔館AI から議題を追加する画面の写真（マニュアル用：赤枠つき mt_ai_*.png ／ 動画用：枠なし v_ai_*.png と枠の位置 .json）。
//   CHISHOKAN_AI_MEMBERS='*' npx next dev -p 3127 で起動し、リポジトリの直下で node <このファイル> マニュアル写真フォルダ 動画写真フォルダ
// AI の回答（POST /api/chishokan-ai）と議題の追加・事前共有の読み書きは架空の例に差し替える（本番には何も書き込まない）。
const { chromium } = require('playwright');
const fs = require('fs');
const { AGENDA_A } = require('./data.js');
const [OUT, VOUT] = process.argv.slice(2);
const BASE = process.argv[4] || 'http://localhost:3127';
const nd = (evs) => evs.map((e) => JSON.stringify(e)).join('\n') + '\n';
const MEET = { id: 'P-A', campus: '小中等部', title: '小中等部 定例部門会議', date: '2026/11/20 16:00〜17:00' };
const A1 = nd([
  { t: 'status', v: '📋 部門会議の事前共有を読んでいます' },
  { t: 'text', v: '小中等部の次の部門会議は、**今日 11/20（金）16:00〜17:00** の「小中等部 定例部門会議」です（Zoom・共有：日野 一郎）。\n\n予定している議題は次の4つです。\n\n1. 冬期講習の申込状況（各校の動員率・外部生）\n2. 11月 学力テストの結果と、生徒への返し方\n3. 12月の面談の進め方（日程・担当の割り振り）\n4. その他・連絡事項\n\nほかに話し合いたいことがあれば、議題に足せます。\n\n```選択肢\n議題を追加する\n```' },
  { t: 'preshare', items: [MEET] },
]);
const A2 = nd([
  { t: 'text', v: 'どの会議に、どんな議題を足しますか？　会議と議題を1行で教えてください。\n\n例：\n- 小中等部の定例部門会議に「冬期講習チラシの配り方」を足したい\n- 次の RED個別の会議で「12月の振替ルール」を協議したい\n- 高等部の会議に「自習室の年末年始の開け方」を報告として入れて' },
]);
const A3 = nd([
  { t: 'text', v: '議題の追加案を作りました。内容がよければ、下の［議題に追加する］を押してください。押すまでは追加されません。' },
  { t: 'agenda', dept: '小中等部', item: '【協議】冬期講習チラシの校門前配布の分担', detail: '各校の担当と配る日を決めたい', meetingId: 'P-A', meetingTitle: MEET.title, meetingDate: MEET.date },
]);
const boxesOut = {};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 2, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await ctx.addCookies([{ name: 'chishokan_session', value: Buffer.from(JSON.stringify({ name: '智翔 花子', campus: '小中等部' })).toString('base64'), url: BASE }]);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-11-20T09:30:00+09:00'));
  const queue = [A1, A2, A3];
  await page.route('**/api/chishokan-ai', (r) => (r.request().method() === 'POST'
    ? r.fulfill({ status: 200, contentType: 'application/x-ndjson; charset=utf-8', body: queue.shift() || nd([{ t: 'text', v: 'はい' }]) })
    : r.continue()));
  await page.route('**/api/chishokan-ai/agenda', (r) => r.fulfill({ json: { ok: true, target: 'preshare', title: MEET.title, date: MEET.date, line: '' } }));
  const item = { ...MEET, place: 'Zoom（本部会議室からも参加）', attendees: '日野 一郎、智翔 花子、大和 さくら、川辺 健太、森山 ゆか', agenda: AGENDA_A, user: '日野 一郎', editedAt: '', editedBy: '', minutesId: '', targets: AGENDA_A.split('\n'), canEdit: true, hasZoom: true };
  await page.route('**/api/chishokan-ai/preshare*', (r) => r.fulfill({ json: { ok: true, item, locked: '' } }));
  await page.goto(BASE + '/ai', { waitUntil: 'networkidle', timeout: 120000 });
  await page.addStyleTag({ content: '@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap"); *{font-family:"Noto Sans JP",sans-serif!important} .env-banner{display:none!important}' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);

  // 枠の位置を測る（clip の中の CSS px）
  async function measure(marks, clip) {
    const out = [];
    for (const [loc, n, pad = 4] of marks) {
      const b = await loc.boundingBox();
      if (!b) throw new Error('no box ' + n);
      out.push({ n, x: Math.round(b.x - clip.x - pad), y: Math.round(b.y - clip.y - pad), w: Math.round(b.width + pad * 2), h: Math.round(b.height + pad * 2) });
    }
    return out;
  }
  async function overlay(boxes, clip) {
    await page.evaluate(({ boxes, clip }) => {
      for (const b of boxes) {
        const f = document.createElement('div'); f.className = 'manual-mark';
        f.style.cssText = `position:fixed;z-index:9999;pointer-events:none;box-sizing:border-box;left:${b.x + clip.x}px;top:${b.y + clip.y}px;width:${b.w}px;height:${b.h}px;border:2.5px solid #e0262f;border-radius:6px;`;
        const c = document.createElement('div'); c.className = 'manual-mark'; c.textContent = String(b.n);
        c.style.cssText = `position:fixed;z-index:10000;pointer-events:none;left:${Math.max(2, b.x + clip.x - 11)}px;top:${Math.max(2, b.y + clip.y - 11)}px;width:22px;height:22px;border-radius:50%;background:#e0262f;color:#fff;font:700 13px/22px sans-serif;text-align:center;`;
        document.body.append(f, c);
      }
    }, { boxes, clip });
  }
  // 1枚を2通りに撮る（枠なし→動画、枠あり→マニュアル）
  async function both(name, vname, marks, clipOf) {
    const clip = await clipOf();
    const boxes = await measure(marks, clip);
    await page.screenshot({ path: `${VOUT}/${vname}.png`, clip });
    fs.writeFileSync(`${VOUT}/${vname}.json`, JSON.stringify({ w: Math.round(clip.width), h: Math.round(clip.height), boxes }, null, 1));
    await overlay(boxes, clip);
    await page.screenshot({ path: `${OUT}/${name}.png`, clip });
    await page.evaluate(() => document.querySelectorAll('.manual-mark').forEach((e) => e.remove()));
  }
  const vp = () => page.viewportSize();
  const region = async (locs, pad = 22) => {
    let y1 = 1e9, y2 = 0;
    for (const l of locs) { const b = await l.boundingBox(); y1 = Math.min(y1, b.y); y2 = Math.max(y2, b.y + b.height); }
    const top = Math.max(0, y1 - pad);
    const cb = await page.locator('.composer').boundingBox();
    return { x: 0, y: top, width: Math.min(vp().width, cb.x + cb.width + 16), height: Math.min(vp().height, y2 + pad) - top };
  };
  const last = () => page.locator('.msg.assistant').last();

  // 図A1 事前共有を聞く → 回答と［議題を追加する］・［意見を足す］
  await page.fill('.composer textarea', '次の小中等部の部門会議の議題を教えて');
  await page.press('.composer textarea', 'Enter');
  await page.waitForSelector('.md-choice');
  await page.waitForSelector('.ai-preshare');
  await page.waitForTimeout(500);
  await page.evaluate(() => { const el = document.querySelector('.msg.user'); el && el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -20); });
  await page.waitForTimeout(300);
  await both('mt_ai_01_answer', 'v_ai_01_answer', [
    [page.locator('.msg.user .bubble').last(), 1], [page.locator('.md-choice', { hasText: '議題を追加する' }), 2, 3], [page.locator('.ai-preshare'), 3, 4],
  ], () => region([page.locator('.msg.user').last(), page.locator('.ai-preshare')]));

  // 図A2 ［議題を追加する］→ AI が聞き返す
  await page.locator('.md-choice', { hasText: '議題を追加する' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.msg.assistant').length >= 2);
  await page.waitForTimeout(800);
  await page.fill('.composer textarea', '小中等部の定例部門会議に「冬期講習チラシの校門前配布の分担」を足したい。各校の担当と配る日を決めたい');
  await page.evaluate(() => { const l = [...document.querySelectorAll('.msg.user')].pop(); l.scrollIntoView({ block: 'start' }); window.scrollBy(0, -20); });
  await page.waitForTimeout(300);
  await both('mt_ai_02_ask', 'v_ai_02_ask', [
    [last().locator('.bubble'), 1, 4], [page.locator('.composer textarea'), 2, 4],
  ], () => region([page.locator('.msg.user').last(), page.locator('.composer')]));

  // 図A3 追加案のカード
  await page.press('.composer textarea', 'Enter');
  await page.waitForSelector('.ai-agenda:not(.ai-preshare) .ai-agenda-actions');
  await page.waitForTimeout(500);
  const card = page.locator('.ai-agenda').filter({ has: page.locator('.ai-agenda-item') }).last();
  await card.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 120));
  await page.waitForTimeout(300);
  await both('mt_ai_03_card', 'v_ai_03_card', [
    [card.locator('.ai-agenda-where'), 1, 2], [card.locator('.ai-agenda-item'), 2, 1],
    [card.locator('.ai-agenda-actions button').first(), 3, 3], [card.locator('.ai-agenda-cancel'), 4, 3],
  ], () => region([page.locator('.msg.user').last(), card]));

  // 図A4 追加できた
  await card.locator('.ai-agenda-actions button').first().click();
  await page.waitForSelector('.ai-agenda-ok');
  await page.waitForTimeout(300);
  await both('mt_ai_04_done', 'v_ai_04_done', [[card.locator('.ai-agenda-ok'), 1, 3]], () => region([page.locator('.msg.user').last(), card]));

  // 図A5 ［意見を足す］の小窓
  await page.locator('.ai-preshare button', { hasText: '意見を足す' }).first().click();
  await page.waitForSelector('.ai-preshare-modal form');
  const modal = page.locator('.ai-preshare-modal');
  await modal.locator('select').selectOption({ index: 1 });
  await modal.locator('textarea').fill('外部生の申込が少ない校舎（日野校）の対策も一緒に話したいです。');
  await page.waitForTimeout(300);
  await both('mt_ai_05_opinion', 'v_ai_05_opinion', [
    [modal.locator('.ai-report-field').nth(1), 1, 3], [modal.locator('.ai-report-field').nth(2), 2, 3], [modal.locator('.ai-report-note'), 3, 3], [modal.locator('.ai-report-submit'), 4, 3],
  ], async () => { const b = await modal.boundingBox(); return { x: Math.max(0, b.x - 14), y: Math.max(0, b.y - 14), width: b.width + 28, height: Math.min(vp().height - Math.max(0, b.y - 14), b.height + 28) }; });

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
