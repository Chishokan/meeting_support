/**
 * apps_script/MinutesNotify.gs（議事録の社長送付）を Node で確認する。
 *
 *   node scripts/test-minutes-notify.mjs
 *
 * GAS のサービス（SpreadsheetApp・UrlFetchApp・PropertiesService など）を最小限の偽物に差し替え、
 * 「どの議事録を送るか」「どの順で何を呼ぶか」「シートに何を書くか」を確かめる。
 * LINE WORKS・会議DX への実際の送信はしない（UrlFetchApp の呼び出しを記録して決まった応答を返す）。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const SRC = readFileSync(new URL('../apps_script/MinutesNotify.gs', import.meta.url), 'utf8');

const HEADERS = ['日時', '部門', '入力者', '会議名', '開催日時', '場所', '出席者', '予定議題', '議事録', '会議の質チェック', '議事録ID', '修正日時', '修正者'];
const NOW = Date.parse('2026-11-02T12:00:00+09:00');
const minAgo = (m) => new Date(NOW - m * 60000).toISOString();

function row(over) {
  const r = {
    日時: minAgo(60), 部門: 'RED個別', 入力者: '瀬戸山理恵', 会議名: '中高連携会議', 開催日時: '2026/10/28',
    場所: '佐世保駅前校', 出席者: '瀬戸山、太田', 予定議題: '', 議事録: '■ 決定事項\n1. 件名：テスト', 会議の質チェック: '',
    議事録ID: 'id-' + Math.random().toString(36).slice(2, 8), 修正日時: '', 修正者: '', ...over,
  };
  return HEADERS.map((h) => r[h]);
}

/** 偽物の GAS 一式。opts で応答を変える。 */
function makeEnv(rows, opts = {}) {
  const data = [HEADERS.slice(), ...rows.map((r) => r.slice())];
  const calls = [];
  const logs = [];
  const props = {
    APP_BASE_URL: 'https://app.example/',
    MINUTES_DIGEST_SECRET: 's3cret',
    MINUTES_NOTIFY_USER_IDS: 'president@chishokan',
    LW_CLIENT_ID: 'cid', LW_CLIENT_SECRET: 'csec', LW_SERVICE_ACCOUNT: 'sa@x', LW_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----',
    LW_BOT_ID: 'bot1',
    ...(opts.props || {}),
  };
  const width = () => Math.max(...data.map((r) => r.length));
  const cell = (r, c) => (data[r - 1] && data[r - 1][c - 1] !== undefined ? data[r - 1][c - 1] : '');
  const range = (r, c, nr = 1, nc = 1) => {
    const self = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
      getValue: () => cell(r, c),
      setValue: (v) => { while (data.length < r) data.push([]); const rr = data[r - 1]; while (rr.length < c) rr.push(''); rr[c - 1] = v; return self; },
      setNumberFormat: () => self,
      setFontWeight: () => self,
    };
    return self;
  };
  const sheet = {
    getLastColumn: () => width(),
    getLastRow: () => data.length,
    getRange: range,
    getDataRange: () => ({ getValues: () => data.map((r) => Array.from({ length: width() }, (_, j) => (r[j] === undefined ? '' : r[j]))) }),
  };
  const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const fetch = (url, o) => {
    calls.push({ url, o });
    if (url.endsWith('/api/dept-minutes/digest')) {
      if (opts.digestFail) return res(502, { ok: false, reason: 'ai_error_500' });
      const p = JSON.parse(o.payload);
      return res(200, { ok: true, fileName: `議事録_${p.title}.pdf`, pdf: Buffer.from('%PDF-1.3').toString('base64'), message: `【議事録】${p.title}`, pages: 1, fontSize: 10 });
    }
    if (url.startsWith('https://auth.worksmobile.com')) return res(200, { access_token: 'tok' });
    if (url.endsWith('/attachments')) return opts.uploadFail ? res(403, 'forbidden') : res(200, { uploadUrl: 'https://upload.example/u1', fileId: 'f-meta' });
    if (url.startsWith('https://upload.example')) return res(200, { fileId: 'f-up' });
    if (url.endsWith('/messages')) {
      const c = JSON.parse(o.payload).content;
      if (opts.textFail && c.type === 'text') return res(500, 'boom');
      return res(201, '');
    }
    throw new Error('unexpected url ' + url);
  };
  const pad = (n) => String(n).padStart(2, '0');
  const ctx = {
    SPREADSHEET_ID: '',
    DEPT_MINUTES_HEADERS: HEADERS,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => (n === '部門会議議事録' ? sheet : null) }) },
    UrlFetchApp: { fetch },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (props[k] === undefined ? null : props[k]),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: (k) => { delete props[k]; },
    }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    Utilities: {
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      base64EncodeWebSafe: (v) => Buffer.from(typeof v === 'string' ? v : Uint8Array.from(v)).toString('base64url'),
      computeRsaSha256Signature: () => [1, 2, 3],
      newBlob: (bytes, type, name) => { const b = { getName: () => name, type, bytes, copyBlob: () => b }; return b; },
      formatDate: (d, tz, fmt) => {
        const j = new Date(d.getTime() + 9 * 3600000);
        return fmt.replace('yyyy', j.getUTCFullYear()).replace('MM', pad(j.getUTCMonth() + 1)).replace('dd', pad(j.getUTCDate()))
          .replace('HH', pad(j.getUTCHours())).replace('mm', pad(j.getUTCMinutes()));
      },
      Charset: { UTF_8: 'UTF-8' },
    },
    DriveApp: { getFolderById: () => ({ createFile: (b) => calls.push({ url: 'drive:createFile', o: b.getName() }) }) },
    ScriptApp: { getProjectTriggers: () => [] },
    Logger: { log: (m) => logs.push(String(m)) },
    Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } },
    JSON, Math, String, Number, Object, RegExp, Error, isNaN, encodeURIComponent, Array, Buffer,
  };
  ctx.Date.parse = Date.parse;
  ctx.Date.UTC = Date.UTC;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const col = (name) => data[0].indexOf(name);
  return { ctx, data, calls, logs, props, col };
}

test('送る行の選び方：対象期間・保存直後の待ち・送付済み・失敗回数', () => {
  const rows = [
    row({ 会議名: '前日以前', 日時: '2026-11-01T14:00:00Z' }), // 11/1 23:00 JST（対象外）
    row({ 会議名: '保存直後', 日時: minAgo(5) }),
    row({ 会議名: '直した直後', 日時: minAgo(60), 修正日時: minAgo(3), 修正者: '太田' }),
    row({ 会議名: '送る', 日時: minAgo(30) }),
    row({ 会議名: '本文なし', 議事録: '  ' }),
  ];
  const env = makeEnv(rows);
  env.ctx.notifyMinutesToPresident();
  const digests = env.calls.filter((c) => c.url.endsWith('/digest')).map((c) => JSON.parse(c.o.payload).title);
  assert.deepEqual(digests, ['送る']);
  // 列が右端に足され、送った行だけに日時とメモが入る
  assert.equal(env.col('社長送付日時'), 13);
  assert.equal(env.col('社長送付メモ'), 14);
  const sent = env.data.slice(1).map((r) => [r[3], r[13] instanceof Date, r[14] || '']);
  assert.deepEqual(sent.find((x) => x[0] === '送る'), ['送る', true, '送付（1枚・10pt）']);
  assert.ok(sent.filter((x) => x[0] !== '送る').every((x) => !x[1]));

  // 2回目は何も送らない（送付済み・まだ待ち）
  env.calls.length = 0;
  env.ctx.notifyMinutesToPresident();
  assert.equal(env.calls.filter((c) => c.url.endsWith('/digest')).length, 0);
});

test('呼び出しの順番：まとめ → 認証 → アップロード → PDF → 本文。合言葉と送り先が正しい', () => {
  const env = makeEnv([row({ 会議名: '中高連携会議', 修正日時: minAgo(20), 修正者: '太田' })]);
  env.ctx.notifyMinutesToPresident();
  const seq = env.calls.map((c) => {
    if (c.url.endsWith('/digest')) return 'digest';
    if (c.url.startsWith('https://auth')) return 'token';
    if (c.url.endsWith('/attachments')) return 'attach';
    if (c.url.startsWith('https://upload')) return 'upload';
    return 'msg:' + JSON.parse(c.o.payload).content.type;
  });
  assert.deepEqual(seq, ['digest', 'token', 'attach', 'upload', 'msg:file', 'msg:text']);
  const digest = env.calls[0];
  assert.equal(digest.url, 'https://app.example/api/dept-minutes/digest');
  assert.equal(digest.o.headers.Authorization, 'Bearer s3cret');
  const p = JSON.parse(digest.o.payload);
  assert.equal(p.revised, false);
  assert.equal(p.editedBy, '太田');
  assert.ok(p.editedAt.endsWith('Z'));
  const fileMsg = env.calls.find((c) => c.url.endsWith('/messages'));
  assert.equal(fileMsg.url, 'https://www.worksapis.com/v1.0/bots/bot1/users/president%40chishokan/messages');
  assert.deepEqual(JSON.parse(fileMsg.o.payload).content, { type: 'file', fileId: 'f-up' });
  const upload = env.calls.find((c) => c.url.startsWith('https://upload'));
  assert.equal(upload.o.payload.resourceName, '議事録_中高連携会議.pdf');
  assert.equal(upload.o.payload.FileData.getName(), '議事録_中高連携会議.pdf');
});

test('失敗したらメモに回数を残して次の回にやり直す。3回失敗したら止まる', () => {
  const env = makeEnv([row({ 会議名: '失敗する' })], { digestFail: true });
  const memo = () => env.data[1][env.col('社長送付メモ')];
  for (let i = 1; i <= 3; i++) {
    env.ctx.notifyMinutesToPresident();
    assert.match(memo(), new RegExp(`^失敗\\(${i}\\) 11/02 12:00 まとめを作れませんでした（502 ai_error_500）`));
  }
  env.calls.length = 0;
  env.ctx.notifyMinutesToPresident();
  assert.equal(env.calls.length, 0, '3回失敗したら呼ばない');
  assert.equal(env.data[1][env.col('社長送付日時')], '');
});

test('PDF が送れなければ何も送らず失敗。本文だけ失敗したときは送付済みにする（PDF を二重に送らない）', () => {
  const up = makeEnv([row({ 会議名: 'アップロード失敗' })], { uploadFail: true });
  up.ctx.notifyMinutesToPresident();
  assert.equal(up.calls.filter((c) => c.url.endsWith('/messages')).length, 0);
  assert.match(up.data[1][up.col('社長送付メモ')], /^失敗\(1\).*LINE WORKS 403/);

  const tx = makeEnv([row({ 会議名: '本文失敗' })], { textFail: true });
  tx.ctx.notifyMinutesToPresident();
  assert.ok(tx.data[1][tx.col('社長送付日時')] instanceof Date);
  assert.match(tx.data[1][tx.col('社長送付メモ')], /^送付（1枚・10pt） ※一部失敗: .*本文の送信に失敗（PDF は送付済み）/);
});

test('送ったあとで直された議事録は、設定したときだけ修正版として送り直す', () => {
  const sentRow = row({ 会議名: '直された', 修正日時: minAgo(30), 修正者: '冨田' });
  sentRow.push(new Date(NOW - 120 * 60000), '送付（1枚・10pt）'); // 2時間前に送付済み
  const off = makeEnv([sentRow.slice()]);
  off.ctx.notifyMinutesToPresident();
  assert.equal(off.calls.length, 0);

  const on = makeEnv([sentRow.slice()], { props: { MINUTES_NOTIFY_RESEND_EDITS: 'true' } });
  on.ctx.notifyMinutesToPresident();
  const p = JSON.parse(on.calls.find((c) => c.url.endsWith('/digest')).o.payload);
  assert.equal(p.revised, true);
  assert.match(on.data[1][on.col('社長送付メモ')], /^修正版を送付/);
});

test('1回に送るのは3件まで。前の回が動いている間は見送る。控えのフォルダがあれば保存する', () => {
  const env = makeEnv([1, 2, 3, 4, 5].map((i) => row({ 会議名: `会議${i}` })), { props: { MINUTES_PDF_FOLDER_ID: 'folder1' } });
  env.ctx.notifyMinutesToPresident();
  assert.equal(env.calls.filter((c) => c.url.endsWith('/digest')).length, 3);
  assert.equal(env.calls.filter((c) => c.url === 'drive:createFile').length, 3);
  assert.equal(env.props.MN_RUNNING_AT, undefined, '終わったら印を消す');

  env.calls.length = 0;
  env.props.MN_RUNNING_AT = String(NOW - 60000); // 1分前に始まった回がまだ動いている
  env.ctx.notifyMinutesToPresident();
  assert.equal(env.calls.length, 0);
});

test('設定が足りなければ分かる言葉で止まる', () => {
  const env = makeEnv([row({})], { props: { APP_BASE_URL: '', MINUTES_NOTIFY_USER_IDS: '' } });
  assert.throws(() => env.ctx.notifyMinutesToPresident(), /スクリプト プロパティが未設定です: APP_BASE_URL, MINUTES_NOTIFY_USER_IDS/);
  assert.equal(env.props.MN_RUNNING_AT, undefined);
});
