/**
 * apps_script/YokoNotify.gs の純粋関数（解析・差分・出来事判定・通知文）を Node で確認する。
 *
 *   node scripts/test-yoko-notify.mjs
 *
 * GAS の API（DocumentApp など）は使わない関数だけを対象にする。
 * PropertiesService だけは prop_ が参照するので空の代替を差し込む。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../apps_script/YokoNotify.gs', import.meta.url), 'utf8');
const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '', setProperty: () => {} }) },
  Logger: { log: () => {} },
  Date,
  JSON,
  Math,
  String,
  Number,
  Object,
  RegExp,
  Error,
  isNaN,
  encodeURIComponent,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const g = ctx;

// --- 要項の本文（Google ドキュメントの getText() 相当）
const base = `
＜基本情報＞
  - 講座名：2026冬期 中等部
  - 実施年度：2026年度
  - 部門：中等部
  - 講座区分：有料講座
  - 作成者：安藤純平
  - 作成日：2026年9月17日（水）
  - 更新履歴：
  - ステータス：下書き　←内容を確認できたら「確定」に書き換える

＜受講料＞（税込）
■ 塾生
  - 中1・中2　25,300円
■ 一般生
  - 中1・中2　29,700円
※使わない割引は行を消さずに「なし」と書く

＜申込＞
■ 申込開始日
2026年11月1日（日）
■ 支払い方法
  - 塾生：授業料として口座より引き落とし
  - 一般生：コンビニ払込票にてお支払い
※請求方法は経理が決めます

＜経理連絡事項＞
■ 講座担当が記入
  - 請求対象：両方
  - 教材費：受講料に含む
■ 経理記入欄（経理担当が記入。講座担当は空欄のままにする）
  - 塾生の請求方法：
  - 経理記入日：
`;

const confirmed = base.replace('ステータス：下書き', 'ステータス：確定');
const corrected = confirmed
  .replace('中1・中2　29,700円', '中1・中2　30,800円')
  .replace('更新履歴：', '更新履歴：2026年9月18日 一般生受講料 29,700→30,800円（安藤）');
const acctDone = corrected.replace('経理記入日：', '経理記入日：2026年9月19日');
const acctOnly = confirmed.replace('塾生の請求方法：', '塾生の請求方法：口座引き落とし');

// vm の中で作られた配列は Node 側の Array と prototype が違うので、値だけを比べる
function same(actual, expected) { assert.equal(JSON.stringify(actual), JSON.stringify(expected)); }

let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok  ' + name); }

ok('解析：基本情報を読む', () => {
  const info = g.parseYoko_(base);
  assert.equal(info.title, '2026冬期 中等部');
  assert.equal(info.kind, '有料講座');
  assert.equal(info.status, '下書き');
  assert.equal(info.owner, '安藤純平');
  assert.equal(info.isTemplate, false);
  assert.equal(info.keiriDate, '');
  assert.match(info.moneyText, /29,700円/);
  assert.match(info.moneyText, /コンビニ払込票/);
  assert.match(info.moneyText, /請求対象：両方/);
  assert.doesNotMatch(info.moneyText, /経理記入日/);
  assert.doesNotMatch(info.moneyText, /※/);
});

ok('解析：講座名が空ならテンプレート扱い', () => {
  assert.equal(g.parseYoko_(base.replace('講座名：2026冬期 中等部', '講座名：')).isTemplate, true);
  assert.equal(g.parseYoko_(base.replace('講座名：2026冬期 中等部', '講座名：（例：冬期）')).isTemplate, true);
});

ok('解析：「確定（9/18訂正）」も確定扱い', () => {
  assert.equal(g.parseYoko_(base.replace('ステータス：下書き', 'ステータス：確定（2026年9月18日 訂正）')).status, '確定');
});

ok('出来事：初めて確定', () => {
  same(g.detectEvents_(null, g.parseYoko_(confirmed)), ['確定']);
  const prevDraft = g.nextRow_(null, 'd', 't', g.parseYoko_(base), 'link', []);
  same(g.detectEvents_(prevDraft, g.parseYoko_(confirmed)), ['確定']);
});

ok('出来事：下書きのままなら何もしない', () => {
  const prev = g.nextRow_(null, 'd', 't', g.parseYoko_(base), 'link', []);
  same(g.detectEvents_(prev, g.parseYoko_(base)), []);
});

ok('出来事：確定済みで金額が変わると金額訂正', () => {
  const prev = g.nextRow_(null, 'd', 't', g.parseYoko_(confirmed), 'link', ['確定']);
  assert.equal(prev['経理確認'], '未');
  same(g.detectEvents_(prev, g.parseYoko_(corrected)), ['金額訂正']);
});

ok('出来事：経理が経理記入欄を書いても金額訂正にはならない', () => {
  const prev = g.nextRow_(null, 'd', 't', g.parseYoko_(confirmed), 'link', ['確定']);
  same(g.detectEvents_(prev, g.parseYoko_(acctOnly)), []);
});

ok('出来事：経理記入日が入ると経理記入完了', () => {
  const prev = g.nextRow_(null, 'd', 't', g.parseYoko_(corrected), 'link', ['金額訂正']);
  same(g.detectEvents_(prev, g.parseYoko_(acctDone)), ['経理記入完了']);
  const row = g.nextRow_(prev, 'd', 't', g.parseYoko_(acctDone), 'link', ['経理記入完了']);
  assert.equal(row['経理確認'], '済');
  assert.equal(row['経理記入日'], '2026年9月19日');
});

ok('出来事：確定 → 下書き は確定取り下げ', () => {
  const prev = g.nextRow_(null, 'd', 't', g.parseYoko_(confirmed), 'link', ['確定']);
  same(g.detectEvents_(prev, g.parseYoko_(base)), ['確定取り下げ']);
});

ok('リマインド：経理記入待ちが20時間を超えたら', () => {
  const t0 = Date.parse('2026-09-17T00:00:00Z');
  const prev = g.nextRow_(null, 'd', 't', g.parseYoko_(confirmed), 'link', ['確定'], new Date(t0).toISOString());
  assert.equal(g.needsReminder_(prev, t0 + 19 * 3600 * 1000, 20), false);
  assert.equal(g.needsReminder_(prev, t0 + 21 * 3600 * 1000, 20), true);
  const done = g.nextRow_(prev, 'd', 't', g.parseYoko_(acctDone), 'link', ['経理記入完了'], new Date(t0).toISOString());
  assert.equal(g.needsReminder_(done, t0 + 48 * 3600 * 1000, 20), false);
});

ok('差分：変わった行だけを前後で出す', () => {
  const d = g.diffLines_(g.parseYoko_(confirmed).moneyText, g.parseYoko_(corrected).moneyText);
  same(d, ['− - 中1・中2 29,700円', '＋ - 中1・中2 30,800円']);
});

ok('通知文：金額訂正は至急・更新履歴・差分を含む', () => {
  const prev = g.nextRow_(null, 'd', 't', g.parseYoko_(confirmed), 'link', ['確定']);
  const msg = g.buildMessage_('金額訂正', g.parseYoko_(corrected), prev, 'https://example/link');
  assert.match(msg, /^【至急】【要項 金額訂正】2026冬期 中等部（有料講座）/);
  assert.match(msg, /更新履歴\n2026年9月18日 一般生受講料 29,700→30,800円（安藤）/);
  assert.match(msg, /− - 中1・中2 29,700円\n＋ - 中1・中2 30,800円/);
  assert.match(msg, /https:\/\/example\/link$/);
});

ok('通知文：確定は経理連絡事項の担当者記入部分を載せる', () => {
  const msg = g.buildMessage_('確定', g.parseYoko_(confirmed), null, 'L');
  assert.match(msg, /^【要項 確定】/);
  assert.match(msg, /請求対象：両方/);
  assert.doesNotMatch(msg, /経理記入日/);
});

ok('テンプレートのタブ名は飛ばす', () => {
  assert.equal(g.isTemplateTabTitle_('_要項テンプレート（記入用）'), true);
  assert.equal(g.isTemplateTabTitle_('有料講座_要項テンプレート（記入用）'), true);
  assert.equal(g.isTemplateTabTitle_('2026冬期_中等部'), false);
});

ok('ハッシュは同じ本文で同じ値', () => {
  assert.equal(g.hashText_('abc'), g.hashText_('abc'));
  assert.notEqual(g.hashText_('abc'), g.hashText_('abd'));
});

ok('初回登録（seed）：通知なしで登録し、次回は変化だけ拾う', () => {
  const seeded = g.nextRow_(null, 'd', 't', g.parseYoko_(confirmed), 'link', []);
  assert.equal(seeded['ステータス'], '確定');
  assert.equal(seeded['経理確認'], '');
  assert.equal(g.needsReminder_(seeded, Date.now() + 1e9, 20), false);
  same(g.detectEvents_(seeded, g.parseYoko_(confirmed)), []);
  same(g.detectEvents_(seeded, g.parseYoko_(corrected)), ['金額訂正']);
});

console.log(`\n${n} 件すべて通りました。`);
