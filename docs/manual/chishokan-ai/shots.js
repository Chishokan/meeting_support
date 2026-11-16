// 智翔館AI 利用マニュアルの写真を撮る。AI の回答（POST /api/chishokan-ai）は架空の例に差し替える。
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const BASE = 'http://localhost:3124';
const boxes = {};
const nd = (evs) => evs.map((e) => JSON.stringify(e)).join('\n') + '\n';

const ANSWERS = {
  yukyu: nd([
    { t: 'status', v: '📄 就業規則（正社員）第4章 勤務 を読んでいます' },
    { t: 'text', v: '正社員の場合、入社から**6か月**勤務し、所定労働日の8割以上出勤すると、**10日**の年次有給休暇がもらえます。そのあとは1年ごとに増えます。\n\n| 勤続 | 付与日数 |\n|---|---|\n| 6か月 | 10日 |\n| 1年6か月 | 11日 |\n| 2年6か月 | 12日 |\n| 3年6か月 | 14日 |\n| 6年6か月以上 | 20日 |\n\nパートタイマー・契約社員は、週の勤務日数によって日数が変わります（パートタイマー就業規則 第38条）。ご自身の残りの日数は、総務に確認してください。\n\n出典: 60_規程・手続き/就業規則/11_就業規則_第4章_勤務.md（就業規則 第59条（年次有給休暇）、2026-11-13 更新）' },
    { t: 'sources', items: [{ kind: 'knowledge', path: '60_規程・手続き/就業規則/00_使い方.md' }, { kind: 'knowledge', path: '60_規程・手続き/就業規則/11_就業規則_第4章_勤務.md' }] },
    { t: 'context', reads: ['60_規程・手続き/就業規則/00_使い方.md', '60_規程・手続き/就業規則/11_就業規則_第4章_勤務.md'], texts: [] },
  ]),
  quizAsk: nd([
    { t: 'status', v: '🧭 作業の手順書を開いています（math-quiz）' },
    { t: 'text', v: '作る前に、作り直しを減らすために3点だけ確認させてください。そのままでよければ「この前提で作る」を押してください（一部だけ答えても大丈夫です）。\n\n1. 範囲：加法・減法だけ／乗法・除法も入れる　→ 既定：加法・減法・乗法・除法すべて\n2. 難しさ：基本の計算だけ／入試の大問1レベル　→ 既定：基本の計算だけ\n3. 枚の上の題名と No.　→ 既定：志望校合格にむけて　ベーシック　No.1\n\n```選択肢\nこの前提で作る\n加法・減法だけで作る\n入試の大問1レベルで作る\n```' },
    { t: 'sources', items: [{ kind: 'knowledge', path: '05_作業/71_数学の小テストを作る.md' }, { kind: 'knowledge', path: '37_教材制作/数学/41_小テストの書式.md' }] },
    { t: 'context', reads: ['05_作業/71_数学の小テストを作る.md', '37_教材制作/数学/41_小テストの書式.md'], texts: [] },
  ]),
  quizMade: nd([
    { t: 'status', v: '📝 小テストを Word にしています（中1 正負の数 小テスト）' },
    { t: 'text', v: '中1・正負の数の小テスト（B5・1枚・10問）を作りました。答えはすべて計算で確かめています。\n\n| 番号 | 問題 | 答え |\n|---|---|---|\n| (1) | −3＋8 | 5 |\n| (2) | 4＋(−9) | −5 |\n| (3) | −2/3＋1/4 | −5/12 |\n| … | … | … |\n\n- 小テスト：https://drive.google.com/file/d/EXAMPLE1/view\n- 答え入り：https://drive.google.com/file/d/EXAMPLE2/view\n\n## 確認してほしいこと\n- 置いた前提：加法・減法・乗法・除法、基本の計算、No.1\n- 計算で確かめた結果：10問すべて確かめました\n- 先生に見てほしい点：1枚に収まっているか、Word で確かめてください（先生が解いて確かめる下書きです）' },
    { t: 'sources', items: [{ kind: 'knowledge', path: '05_作業/71_数学の小テストを作る.md' }, { kind: 'knowledge', path: '37_教材制作/数学/41_小テストの書式.md' }] },
    { t: 'context', reads: ['05_作業/71_数学の小テストを作る.md', '37_教材制作/数学/41_小テストの書式.md'], texts: [] },
  ]),
};

async function box(page, key, selector, pad = 4) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error('no box: ' + selector);
  boxes[key] = boxes[key] || [];
  return { x: b.x - pad, y: b.y - pad, w: b.width + pad * 2, h: b.height + pad * 2 };
}
async function shot(page, name, marks, opts = {}) {
  // 画面を上に戻してから測る（写真の座標と、枠の座標をそろえる）
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  const list = [];
  for (const [n, sel, pad] of marks) list.push({ n, ...(await box(page, name, sel, pad ?? 4)) });
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: opts.clip });
  boxes[name] = { marks: list, clip: opts.clip || null };
}

(async () => {
  const browser = await chromium.launch();
  const mk = async (w, h, mobile) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: !!mobile, hasTouch: !!mobile });
    await ctx.addCookies([{ name: 'chishokan_session', value: Buffer.from(JSON.stringify({ name: '智翔 花子', campus: '小中等部' })).toString('base64'), domain: 'localhost', path: '/' }]);
    return ctx;
  };
  // 1. メニュー
  let ctx = await mk(1100, 760);
  let page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await shot(page, 'ai_01_menu', [[1, '.portal-card:has-text("智翔館AI")', 6]]);
  // 2. 最初の画面
  let queue = [];
  await page.route('**/api/chishokan-ai', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 200, contentType: 'application/x-ndjson; charset=utf-8', body: queue.shift() || nd([{ t: 'text', v: 'はい' }]) }) : r.continue()));
  await page.setViewportSize({ width: 1100, height: 1180 });
  await page.goto(BASE + '/ai', { waitUntil: 'networkidle' });
  await shot(page, 'ai_02_top', [
    [1, '.ai-about summary', 4], [2, '.ai-report-open:not(.ai-request-open)', 3], [3, '.ai-request-open', 3],
    [4, '.ai-tasks', 6], [5, '.iqa-examples', 6], [6, '.attach-btn', 4], [7, '.ai-task-picker', 4], [8, '.composer textarea', 4],
    [9, '.ai-head-links .ai-panel-toggle', 3],
  ]);
  // 3. 質問と回答
  await page.setViewportSize({ width: 1100, height: 1500 });
  queue.push(ANSWERS.yukyu);
  await page.fill('.composer textarea', '有給休暇は入社何か月後から何日もらえますか？');
  await page.press('.composer textarea', 'Enter');
  await page.waitForSelector('.ai-sources');
  await page.waitForTimeout(400);
  await shot(page, 'ai_03_answer', [
    [1, '.msg.user', 4], [2, '.msg.assistant .bubble', 4], [3, '.ai-sources', 4], [4, '.msg-actions', 4],
    [5, '.yq-toggle', 4], [6, '.ai-carry-note', 4],
  ], { full: true });
  await ctx.close();

  // 4. 作業：数学の小テスト
  ctx = await mk(1100, 1180);
  page = await ctx.newPage();
  queue = [];
  await page.route('**/api/chishokan-ai', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 200, contentType: 'application/x-ndjson; charset=utf-8', body: queue.shift() || nd([{ t: 'text', v: 'はい' }]) }) : r.continue()));
  await page.goto(BASE + '/ai', { waitUntil: 'networkidle' });
  await page.click('.ai-task:has-text("数学の小テストを作る")');
  await page.waitForTimeout(300);
  await shot(page, 'ai_04_task', [[1, '.task-chip', 4], [2, '.composer textarea', 4]], { clip: { x: 0, y: 760, width: 1100, height: 420 } });
  await page.setViewportSize({ width: 1100, height: 1400 });
  queue.push(ANSWERS.quizAsk);
  await page.press('.composer textarea', 'Enter');
  await page.waitForSelector('.msg.assistant button:has-text("この前提で作る")');
  await page.waitForTimeout(300);
  await shot(page, 'ai_05_ask', [[1, '.msg.assistant .bubble', 4], [2, '.msg.assistant button:has-text("この前提で作る")', 4]], { full: true });
  await page.setViewportSize({ width: 1100, height: 1900 });
  queue.push(ANSWERS.quizMade);
  await page.click('.msg.assistant button:has-text("この前提で作る")');
  await page.waitForSelector('text=答え入り：');
  await page.waitForTimeout(400);
  await shot(page, 'ai_06_made', [[1, '.msg.assistant >> nth=-1', 4], [2, '.task-chip', 4]], { full: true });

  // 5. 不具合の報告と要望
  await page.setViewportSize({ width: 1100, height: 1500 });
  await page.click('.ai-head-links .ai-report-open:not(.ai-request-open)');
  await page.click('.ai-report-kinds label:has-text("答えが間違っている")');
  await page.fill('.ai-report textarea >> nth=0', '冬期講習（中3）の日程を聞いたら、去年の日程で答えた');
  await page.fill('.ai-report textarea >> nth=1', '要項の日程（12月26日〜1月7日）で答えてほしかった');
  await shot(page, 'ai_07_report', [[1, '.ai-report-kinds', 4], [2, '.ai-report textarea >> nth=0', 4], [3, '.ai-report-auto', 4], [4, '.ai-report-submit', 4]]);
  await page.click('.dm-modal-close');
  await page.click('.ai-request-open');
  await page.click('.ai-report-kinds label:has-text("ナレッジに入れてほしい")');
  await page.fill('.ai-report textarea >> nth=0', '冬期講習のカリキュラム表（中1・2）を入れてほしい');
  await page.fill('.ai-report textarea >> nth=1', '保護者から講習の内容を聞かれたときに、AIで確かめたい');
  await page.fill('.ai-report textarea >> nth=2', 'https://drive.google.com/drive/folders/EXAMPLE');
  await shot(page, 'ai_08_request', [[1, '.ai-report-kinds', 4], [2, '.ai-report textarea >> nth=0', 4], [3, '.ai-report textarea >> nth=2', 4], [4, '.ai-report-submit', 4]]);
  await ctx.close();

  // 6. 右の欄（コンテキスト）と、AIの直し案（広い画面では右に常に出る）
  ctx = await mk(1366, 1240);
  page = await ctx.newPage();
  queue = [];
  await page.route('**/api/chishokan-ai', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 200, contentType: 'application/x-ndjson; charset=utf-8', body: queue.shift() || nd([{ t: 'text', v: 'はい' }]) }) : r.continue()));
  await page.goto(BASE + '/ai', { waitUntil: 'networkidle' });
  await page.click('.ai-pin-add');
  await page.fill('.ai-pin-form input', '冬期講習（中3）の前提');
  await page.fill('.ai-pin-form textarea', '対象：中学3年生（外部生）\n日程：12月26日〜1月7日\n定員：各校舎20名\nねらい：講習から入会につなげる');
  await page.click('.ai-pin-form button:has-text("追加する")');
  queue.push(nd([
    { t: 'status', v: '📄 冬期講習の要項を読んでいます' },
    { t: 'text', v: '## 外部生募集の計画（冬期講習・中3）\n\nコンテキストの前提（中3・各校舎20名・入会につなげる）で立てました。\n\n| 時期 | やること |\n|---|---|\n| 11月第3週 | チラシ・サイネージを掲示、在籍生の紹介を案内 |\n| 12月第1週 | 中学校前での門配、体験授業の案内 |\n| 12月第2週 | 申込の締切、席の調整 |\n\n入会の面談は、講習の最終日の前の週に入れます。' },
    { t: 'sources', items: [{ kind: 'knowledge', path: '40_要項/2026/2026-12_冬期_中等部_中3.md' }] },
    { t: 'context', reads: ['40_要項/2026/2026-12_冬期_中等部_中3.md'], texts: [] },
  ]));
  await page.fill('.composer textarea', 'この前提で、外部生募集の計画を立てて');
  await page.press('.composer textarea', 'Enter');
  await page.waitForSelector('.ai-sources');
  await page.waitForTimeout(300);
  await page.click('.msg.assistant .msg-actions button:has-text("コンテキストに入れる")');
  await page.click('.ai-pin-form button:has-text("追加する")');
  queue.push(nd([
    { t: 'status', v: '📌 コンテキストの直し案を作っています（冬期講習（中3）の前提）' },
    { t: 'pin', id: 'c1', name: '冬期講習（中3）の前提', text: '対象：中学2・3年生（外部生）\n日程：12月26日〜1月7日\n定員：各校舎25名\nねらい：講習から入会につなげる', summary: '対象に中2を足し、定員を各校舎25名にしました。' },
    { t: 'text', v: 'c1「冬期講習（中3）の前提」の直し案を、右の欄に出しました。対象に中2を足し、定員を各校舎25名にしています。見比べて、よければ「置き換える」を押してください。' },
  ]));
  await page.fill('.composer textarea', 'c1 の定員を25名にして、中2も対象に入れて');
  await page.press('.composer textarea', 'Enter');
  await page.waitForSelector('.ai-pin-card');
  await page.waitForTimeout(300);
  await shot(page, 'ai_10_panel', [
    [1, '.ai-panel-head', 4], [2, '.ai-pin >> nth=0', 3], [3, '.ai-pin-add', 3], [4, '.ai-carry-list', 4], [5, '.ai-panel-file', 4],
    [6, '.msg.assistant .msg-actions >> nth=0', 3], [7, '.ai-pin-card', 3],
  ]);
  await page.click('.ai-pin-card button');
  await page.waitForSelector('.ai-diff');
  await page.waitForTimeout(300);
  await shot(page, 'ai_11_diff', [
    [1, '.ai-diff-cols section >> nth=0', 4], [2, '.ai-diff-cols section >> nth=1', 4], [3, '.ai-diff-actions .ai-report-submit', 4], [4, '.ai-diff-actions button:has-text("案を捨てる")', 4],
  ]);
  await ctx.close();

  // 7. スマートフォン
  ctx = await mk(390, 844, true);
  page = await ctx.newPage();
  await page.goto(BASE + '/ai', { waitUntil: 'networkidle' });
  await shot(page, 'ai_09_phone', []);
  await ctx.close();
  fs.writeFileSync(`${OUT}/boxes.json`, JSON.stringify(boxes, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
