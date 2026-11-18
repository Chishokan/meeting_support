/**
 * 智翔館 イベント申込管理 — Apps Script（Web アプリ）
 * -------------------------------------------------------
 * イベント申込管理（総合メニューの「イベント申込管理」 /event）の読み込み・保存先。
 * ★会議DXの Code.gs・成績管理の seiseki.gs とは別のプロジェクトにする（名簿のスプレッドシートに付ける）。
 *
 *   - action:'listEvent'       … 名簿（必要な列だけ）・声掛けの記録・申込フォームの回答をまとめて返す
 *   - action:'saveEventTracks' … 声掛けの記録に、生徒ごとの行を追加、または同じ生徒の行の「変えた列」だけを書く
 *   - action:'saveEventStudent'   … 「イベント追加生徒」に生徒を1人足す、または ID が同じ行を直す（名簿に無い生徒をアプリで足す）
 *   - action:'deleteEventStudent' … 「イベント追加生徒」の「削除」列に 1 を立てる（行は消さない）
 *
 * 【読み書きするもの】
 *   名簿           … このスクリプトを付けたスプレッドシート（「中等部名簿」）の、見出しに「生徒名」と「所属校舎」がある全部のタブ。
 *                     読むだけ。アプリが言ってきた列（所属校舎・中学校名・学年・生徒名・夢・志・志望校・student_id・№）だけを返す
 *                     （面談の記録など、ほかの列はアプリに渡さない）
 *                     RED個別のタブ（「RED個別（イベント用）」）は、部門・所属校舎・学年・生徒名だけの表。「部門」の列に RED個別 と入れる
 *                     （「部門」の列が無いタブ・空の行は、アプリ側で小中等部として扱う）
 *   声掛けの記録   … 同じスプレッドシートのタブ「イベント声掛け記録」（setupEvent で作る）。1行＝イベント×生徒1人
 *   足した生徒     … 同じスプレッドシートのタブ「イベント追加生徒」（setupEvent で作る）。1行＝アプリで足した生徒1人
 *                     （RED個別・高校生・外部生など、名簿に無い生徒。名簿のタブには書き込まない）
 *   申込           … Google フォームの回答のスプレッドシート（下の FORM_BOOK_ID）。読むだけ。見出しと回答をそのまま返す
 *
 * 【セットアップ手順】
 * 1. 名簿のスプレッドシート（「中等部名簿」）を開き、拡張機能 → Apps Script を開いて、このファイルの中身を貼り付ける
 * 2. 下の TOKEN を任意の合言葉にする（会議DX・成績管理の合言葉とは別にする）
 * 3. 下の FORM_BOOK_ID が、Google フォームの回答のスプレッドシートの ID になっているか確かめる（いまのイベントの分は入れてある）
 *    （フォームの「回答」→「スプレッドシートにリンク」で作ったファイル。URL の /d/ と /edit のあいだの文字）
 *    回答のタブが先頭でないときは FORM_SHEET_NAME にタブの名前を入れる
 * 4. エディタで setupEvent を1回「実行」し、権限を承認する → タブ「イベント声掛け記録」「イベント追加生徒」ができる
 * 5. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *      実行するユーザー：自分／アクセスできるユーザー：全員
 * 6. Vercel の環境変数に設定して、再デプロイする
 *      EVENT_SCRIPT_URL   = 発行された Web アプリの URL（/exec で終わる）
 *      EVENT_SCRIPT_TOKEN = 2. の合言葉
 * 7. 確かめ：ブラウザで URL を開くと {"ok":true,"service":"chishokan-event",...} が返る。
 *    エディタで checkEvent を実行すると、読めた名簿の人数・フォームの見出しが「実行ログ」に出る
 * ※ コードを直したら「デプロイを管理 → 編集 → バージョン：新バージョン」で出し直す（保存だけでは反映されない）
 * ※ スタンドアロンのプロジェクトで使うときは、スクリプトのプロパティ EVENT_SPREADSHEET_ID に名簿のスプレッドシートの ID を入れる
 * 決まりと計算はアプリ側（lib/eventList/model.ts）。ここは言われたとおりに読み書きするだけ。
 */

var TOKEN = ''; // 例 'event-2026'。空なら検証しない（本番では必ず設定する）
// Google フォームの回答のスプレッドシートの ID。空にすると、申込は「未設定」としてアプリに返す。
// いまは「東進　トップリーダーと学ぶワークショップ2026　参加申し込み（回答）」。
// ★このスクリプトを実行する人（デプロイした人）が、この回答のスプレッドシートを開けること
var FORM_BOOK_ID = '1RNMkyAfUziQyc4X8-2gbiNaRzJZnf6V-Zlxpewvmri8';
var FORM_SHEET_NAME = ''; // 回答のタブの名前。空なら先頭のタブ

var EVENT_TRACK_SHEET = 'イベント声掛け記録';
// ★lib/eventList/model.ts の TRACK_HEADERS・trackFromSheet と同じ名前
//   「申込」の列は v1.13.0 から使っていない（手で申込済にする項目を外した。申込はフォームの回答だけで決まる）。列は残してある
var EVENT_TRACK_HEADERS = ['イベントID', '生徒キー', '校舎', '氏名', 'チラシ', '声掛け', '反応', '保護者案内', '申込', '申込ひも付け', '重点', 'メモ', '更新日時', '更新者'];
var EVENT_TRACK_FIELDS = ['チラシ', '声掛け', '反応', '保護者案内', '申込', '申込ひも付け', '重点', 'メモ'];
var EVENT_ADDED_SHEET = 'イベント追加生徒';
// ★lib/eventList/model.ts の ADDED_HEADERS・addedFromSheet と同じ名前
var EVENT_ADDED_HEADERS = ['イベントID', 'ID', '部門', '校舎', '中学校', '学年', '氏名', '夢・志', '志望校', '作成日時', '作成者', '更新日時', '更新者', '削除'];
var EVENT_ADDED_FIELDS = ['部門', '校舎', '中学校', '学年', '氏名', '夢・志', '志望校'];
// 名簿のタブだと見分ける見出し（この2つが同じ行にあるタブを名簿として読む）
var EVENT_ROSTER_MARKS = ['生徒名', '所属校舎'];

function doGet() {
  return json_({ ok: true, service: 'chishokan-event', ts: new Date().toISOString() });
}

function doPost(e) {
  try {
    var data = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    if (TOKEN && data.token !== TOKEN) return json_({ ok: false, reason: 'invalid_token' });
    switch (data.action) {
      case 'listEvent': return json_(listEvent_(data));
      case 'saveEventTracks': return json_(saveEventTracks_(data));
      case 'saveEventStudent': return json_(saveEventStudent_(data));
      case 'deleteEventStudent': return json_(deleteEventStudent_(data));
      default: return json_({ ok: false, reason: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, reason: 'script_error', detail: String(err && err.message ? err.message : err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function book_() {
  var id = PropertiesService.getScriptProperties().getProperty('EVENT_SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function nowJp_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

// ---- セットアップ・確かめ ----------------------------------------------------

/** タブ「イベント声掛け記録」「イベント追加生徒」を作る（あれば足りない見出しだけ足す）。エディタで1回実行する。 */
function setupEvent() {
  var ss = book_();
  trackSheet_(ss);
  addedSheet_(ss);
}

/** 読めた名簿の人数と、フォームの回答の見出しを実行ログに出す（セットアップの確かめ用）。 */
function checkEvent() {
  var r = listEvent_({ eventId: '', columns: ['所属校舎', '学年', '生徒名'] });
  var byCampus = {};
  r.roster.forEach(function (x) { var c = x['所属校舎'] || '（校舎なし）'; byCampus[c] = (byCampus[c] || 0) + 1; });
  Logger.log('名簿：%s 人 %s', r.roster.length, JSON.stringify(byCampus));
  Logger.log('フォームの回答：%s', r.form ? (r.form.rows.length + ' 件／見出し ' + JSON.stringify(r.form.headers)) : ('読めていません（' + r.formReason + '）'));
}

function trackSheet_(ss) { return appSheet_(ss, EVENT_TRACK_SHEET, EVENT_TRACK_HEADERS); }
function addedSheet_(ss) { return appSheet_(ss, EVENT_ADDED_SHEET, EVENT_ADDED_HEADERS); }

/** アプリが書くタブを開く。無ければ作り、足りない見出しは右に足す。 */
function appSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // 日付（2026-11-17）や ID をシートが勝手に読み替えないよう、全部の列を書式なしテキストにする
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
  } else {
    var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
    headers.forEach(function (h) {
      if (have.indexOf(h) < 0) { sh.getRange(1, sh.getLastColumn() + 1).setNumberFormat('@').setValue(h).setFontWeight('bold'); have.push(h); }
    });
  }
  return sh;
}

/** タブの中身を「見出し → 値」の行にして返す（イベントID が同じ行だけ）。 */
function readAppRows_(ss, name, eventId, keyHeader) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  var head = values[0];
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var o = {};
    head.forEach(function (h, i) { if (h) o[h] = values[r][i]; });
    if (o[keyHeader] && String(o['イベントID']) === eventId) out.push(o);
  }
  return out;
}

// ---- 読み込み ---------------------------------------------------------------

function listEvent_(data) {
  var ss = book_();
  var columns = (data.columns || []).map(String);
  var eventId = String(data.eventId || '');
  var out = {
    ok: true, saved: 'event-list', roster: readRoster_(ss, columns),
    tracks: readAppRows_(ss, EVENT_TRACK_SHEET, eventId, '生徒キー'),
    added: readAppRows_(ss, EVENT_ADDED_SHEET, eventId, 'ID').filter(function (o) { return String(o['削除']) !== '1'; }),
    form: null, formReason: '',
  };
  if (!FORM_BOOK_ID) {
    out.formReason = 'form_not_set';
  } else {
    try {
      out.form = readForm_();
    } catch (err) {
      out.formReason = 'form_open_failed';
    }
  }
  return out;
}

/** 名簿のタブ（見出しに EVENT_ROSTER_MARKS がある）から、言われた列だけを読む。 */
function readRoster_(ss, columns) {
  var rows = [];
  ss.getSheets().forEach(function (sh) {
    if (sh.getName() === EVENT_TRACK_SHEET || sh.getName() === EVENT_ADDED_SHEET || sh.getLastRow() < 2) return;
    var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
    var hr = -1;
    for (var i = 0; i < Math.min(values.length, 15); i++) {
      var line = values[i].map(function (v) { return String(v).trim(); });
      if (EVENT_ROSTER_MARKS.every(function (m) { return line.indexOf(m) >= 0; })) { hr = i; break; }
    }
    if (hr < 0) return;
    var head = values[hr].map(function (v) { return String(v).trim(); });
    // 同じ見出しが何度も出る（国語・数学…）ので、いちばん左の列を使う
    var idx = {};
    columns.forEach(function (c) { idx[c] = head.indexOf(c); });
    for (var r = hr + 1; r < values.length; r++) {
      var o = {};
      var any = false;
      columns.forEach(function (c) {
        var v = idx[c] >= 0 ? String(values[r][idx[c]]).trim() : '';
        o[c] = v;
        if (v) any = true;
      });
      if (any) rows.push(o);
    }
  });
  return rows;
}

function readForm_() {
  var ss = SpreadsheetApp.openById(FORM_BOOK_ID);
  var sh = FORM_SHEET_NAME ? ss.getSheetByName(FORM_SHEET_NAME) : ss.getSheets()[0];
  if (!sh) throw new Error('form sheet not found');
  if (sh.getLastRow() < 1) return { headers: [], rows: [] };
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  var rows = values.slice(1).filter(function (row) { return row.some(function (v) { return String(v).trim() !== ''; }); });
  return { headers: values[0], rows: rows };
}

// ---- 保存 -------------------------------------------------------------------

/**
 * data.items = [{ key, campus, name, fields: { 見出し: 値 } }]
 * 同じ イベントID＋生徒キー の行があれば fields の列だけを書き、無ければ行を足す。
 */
function saveEventTracks_(data) {
  var items = data.items || [];
  var eventId = String(data.eventId || '');
  if (!eventId || !items.length) return { ok: false, reason: 'bad_request' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = trackSheet_(book_());
    var lastRow = sh.getLastRow();
    var width = sh.getLastColumn();
    var values = sh.getRange(1, 1, Math.max(lastRow, 1), width).getDisplayValues();
    var head = values[0];
    var col = {};
    head.forEach(function (h, i) { if (h) col[h] = i; });
    var rowOf = {};
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][col['イベントID']]) === eventId) rowOf[String(values[r][col['生徒キー']])] = r;
    }
    var ts = nowJp_();
    var user = String(data.user || '');
    var touched = {};
    var saved = [];
    items.forEach(function (it) {
      var key = String(it.key || '');
      if (!key) return;
      var r = rowOf[key];
      if (r == null) {
        var blank = [];
        for (var i = 0; i < width; i++) blank.push('');
        values.push(blank);
        r = values.length - 1;
        rowOf[key] = r;
        values[r][col['イベントID']] = eventId;
        values[r][col['生徒キー']] = key;
      }
      values[r][col['校舎']] = String(it.campus || '');
      values[r][col['氏名']] = String(it.name || '');
      var f = it.fields || {};
      EVENT_TRACK_FIELDS.forEach(function (h) {
        if (Object.prototype.hasOwnProperty.call(f, h)) values[r][col[h]] = String(f[h] == null ? '' : f[h]);
      });
      values[r][col['更新日時']] = ts;
      values[r][col['更新者']] = user;
      touched[r] = true;
    });
    var rowsTouched = Object.keys(touched).map(Number);
    if (values.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), values.length - sh.getMaxRows());
    if (rowsTouched.length > 5) {
      // まとめて付けたとき：1行ずつ書くと遅いので、記録の全体を書き直す（全部の列が文字なので中身は変わらない）
      sh.getRange(2, 1, values.length - 1, width).setNumberFormat('@').setValues(values.slice(1));
    } else {
      rowsTouched.forEach(function (r) { sh.getRange(r + 1, 1, 1, width).setNumberFormat('@').setValues([values[r]]); });
    }
    rowsTouched.forEach(function (r) {
      var o = {};
      head.forEach(function (h, i) { if (h) o[h] = values[r][i]; });
      saved.push(o);
    });
    return { ok: true, saved: 'event-tracks', items: saved };
  } finally {
    lock.releaseLock();
  }
}

// ---- アプリで足した生徒 -------------------------------------------------------

/** 「イベント追加生徒」の、ID が同じ行の番号（0 始まり。見出しが 0）。無ければ -1。 */
function addedRow_(values, col, eventId, id) {
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][col['イベントID']]) === eventId && String(values[r][col['ID']]) === id) return r;
  }
  return -1;
}

/** data.scope（部門）があるときは、その部門の生徒の行だけを直せる・外せる（部門が空の行は data.defaultDept として扱う）。 */
function inScope_(row, col, data) {
  var scope = String(data.scope || '');
  if (!scope) return true;
  var dept = col['部門'] == null ? '' : String(row[col['部門']]);
  return (dept || String(data.defaultDept || '')) === scope;
}

/** data.id が空なら1人足す。あればその行の data.fields（見出し → 値）を書く。 */
function saveEventStudent_(data) {
  var eventId = String(data.eventId || '');
  var f = data.fields || {};
  if (!eventId || !String(f['氏名'] || '').trim()) return { ok: false, reason: 'bad_request' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = addedSheet_(book_());
    var width = sh.getLastColumn();
    var values = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), width).getDisplayValues();
    var head = values[0];
    var col = {};
    head.forEach(function (h, i) { if (h) col[h] = i; });
    var ts = nowJp_();
    var user = String(data.user || '');
    var id = String(data.id || '');
    var r = -1;
    var row;
    if (id) {
      r = addedRow_(values, col, eventId, id);
      if (r < 0 || String(values[r][col['削除']]) === '1') return { ok: false, reason: 'not_found' };
      if (!inScope_(values[r], col, data)) return { ok: false, reason: 'not_found' };
      row = values[r];
    } else {
      row = [];
      for (var i = 0; i < width; i++) row.push('');
      row[col['イベントID']] = eventId;
      row[col['ID']] = 'A-' + Utilities.getUuid().slice(0, 8);
      row[col['作成日時']] = ts;
      row[col['作成者']] = user;
      r = values.length;
    }
    EVENT_ADDED_FIELDS.forEach(function (h) {
      if (Object.prototype.hasOwnProperty.call(f, h)) row[col[h]] = String(f[h] == null ? '' : f[h]);
    });
    row[col['更新日時']] = ts;
    row[col['更新者']] = user;
    if (r + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), r + 1 - sh.getMaxRows());
    sh.getRange(r + 1, 1, 1, width).setNumberFormat('@').setValues([row]);
    var o = {};
    head.forEach(function (h, i) { if (h) o[h] = row[i]; });
    return { ok: true, saved: 'event-student', item: o };
  } finally {
    lock.releaseLock();
  }
}

function deleteEventStudent_(data) {
  var eventId = String(data.eventId || '');
  var id = String(data.id || '');
  if (!eventId || !id) return { ok: false, reason: 'bad_request' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = addedSheet_(book_());
    var values = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), sh.getLastColumn()).getDisplayValues();
    var col = {};
    values[0].forEach(function (h, i) { if (h) col[h] = i; });
    var r = addedRow_(values, col, eventId, id);
    if (r < 0 || !inScope_(values[r], col, data)) return { ok: false, reason: 'not_found' };
    sh.getRange(r + 1, col['削除'] + 1).setValue('1');
    sh.getRange(r + 1, col['更新日時'] + 1).setValue(nowJp_());
    sh.getRange(r + 1, col['更新者'] + 1).setValue(String(data.user || ''));
    return { ok: true, saved: 'event-student-deleted' };
  } finally {
    lock.releaseLock();
  }
}
