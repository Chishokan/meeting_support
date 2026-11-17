/**
 * 智翔館 イベント申込管理 — Apps Script（Web アプリ）
 * -------------------------------------------------------
 * イベント申込管理（総合メニューの「イベント申込管理」 /event）の読み込み・保存先。
 * ★会議DXの Code.gs・成績管理の seiseki.gs とは別のプロジェクトにする（名簿のスプレッドシートに付ける）。
 *
 *   - action:'listEvent'       … 名簿（必要な列だけ）・声掛けの記録・申込フォームの回答をまとめて返す
 *   - action:'saveEventTracks' … 声掛けの記録に、生徒ごとの行を追加、または同じ生徒の行の「変えた列」だけを書く
 *
 * 【読み書きするもの】
 *   名簿           … このスクリプトを付けたスプレッドシート（「中等部名簿」）の、見出しに「生徒名」と「所属校舎」がある全部のタブ。
 *                     読むだけ。アプリが言ってきた列（所属校舎・中学校名・学年・生徒名・夢・志・志望校・student_id・№）だけを返す
 *                     （面談の記録など、ほかの列はアプリに渡さない）
 *   声掛けの記録   … 同じスプレッドシートのタブ「イベント声掛け記録」（setupEvent で作る）。1行＝イベント×生徒1人
 *   申込           … Google フォームの回答のスプレッドシート（下の FORM_BOOK_ID）。読むだけ。見出しと回答をそのまま返す
 *
 * 【セットアップ手順】
 * 1. 名簿のスプレッドシート（「中等部名簿」）を開き、拡張機能 → Apps Script を開いて、このファイルの中身を貼り付ける
 * 2. 下の TOKEN を任意の合言葉にする（会議DX・成績管理の合言葉とは別にする）
 * 3. 下の FORM_BOOK_ID に、Google フォームの回答のスプレッドシートの ID を入れる
 *    （フォームの「回答」→「スプレッドシートにリンク」で作ったファイル。URL の /d/ と /edit のあいだの文字）
 *    回答のタブが先頭でないときは FORM_SHEET_NAME にタブの名前を入れる
 * 4. エディタで setupEvent を1回「実行」し、権限を承認する → タブ「イベント声掛け記録」ができる
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
var FORM_BOOK_ID = ''; // Google フォームの回答のスプレッドシートの ID。空のあいだは、申込は「未設定」としてアプリに返す
var FORM_SHEET_NAME = ''; // 回答のタブの名前。空なら先頭のタブ

var EVENT_TRACK_SHEET = 'イベント声掛け記録';
// ★lib/eventList/model.ts の TRACK_HEADERS・trackFromSheet と同じ名前
var EVENT_TRACK_HEADERS = ['イベントID', '生徒キー', '校舎', '氏名', 'チラシ', '声掛け', '反応', '保護者案内', '申込', '申込ひも付け', '重点', 'メモ', '更新日時', '更新者'];
var EVENT_TRACK_FIELDS = ['チラシ', '声掛け', '反応', '保護者案内', '申込', '申込ひも付け', '重点', 'メモ'];
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

/** タブ「イベント声掛け記録」を作る（あれば足りない見出しだけ足す）。エディタで1回実行する。 */
function setupEvent() {
  trackSheet_(book_());
}

/** 読めた名簿の人数と、フォームの回答の見出しを実行ログに出す（セットアップの確かめ用）。 */
function checkEvent() {
  var r = listEvent_({ eventId: '', columns: ['所属校舎', '学年', '生徒名'] });
  var byCampus = {};
  r.roster.forEach(function (x) { var c = x['所属校舎'] || '（校舎なし）'; byCampus[c] = (byCampus[c] || 0) + 1; });
  Logger.log('名簿：%s 人 %s', r.roster.length, JSON.stringify(byCampus));
  Logger.log('フォームの回答：%s', r.form ? (r.form.rows.length + ' 件／見出し ' + JSON.stringify(r.form.headers)) : ('読めていません（' + r.formReason + '）'));
}

function trackSheet_(ss) {
  var sh = ss.getSheetByName(EVENT_TRACK_SHEET);
  if (!sh) {
    sh = ss.insertSheet(EVENT_TRACK_SHEET);
    sh.getRange(1, 1, 1, EVENT_TRACK_HEADERS.length).setValues([EVENT_TRACK_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // 日付（2026-11-17）や ID をシートが勝手に読み替えないよう、全部の列を書式なしテキストにする
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
  } else {
    var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
    EVENT_TRACK_HEADERS.forEach(function (h) {
      if (have.indexOf(h) < 0) { sh.getRange(1, sh.getLastColumn() + 1).setNumberFormat('@').setValue(h).setFontWeight('bold'); have.push(h); }
    });
  }
  return sh;
}

// ---- 読み込み ---------------------------------------------------------------

function listEvent_(data) {
  var ss = book_();
  var columns = (data.columns || []).map(String);
  var out = { ok: true, saved: 'event-list', roster: readRoster_(ss, columns), tracks: readTracks_(ss, String(data.eventId || '')), form: null, formReason: '' };
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
    if (sh.getName() === EVENT_TRACK_SHEET || sh.getLastRow() < 2) return;
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

function readTracks_(ss, eventId) {
  var sh = ss.getSheetByName(EVENT_TRACK_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  var head = values[0];
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var o = {};
    head.forEach(function (h, i) { if (h) o[h] = values[r][i]; });
    if (o['生徒キー'] && String(o['イベントID']) === eventId) out.push(o);
  }
  return out;
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
