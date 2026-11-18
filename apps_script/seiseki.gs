/**
 * 智翔館 成績管理 — Apps Script（Web アプリ）
 * -------------------------------------------------------
 * 成績管理（総合メニューの「成績管理」。いまは本番レベル模試 /moshi）の保存先。
 * ★会議DXの Code.gs とは別のプロジェクト・別のスプレッドシートにする（門配管理の monpai.gs と同じ形）。
 *   生徒の氏名と成績だけが入るファイルにして、共有・保管・将来の DB への移行を会議DXのログと切り離すため。
 *
 *   - action:'listMoshi'          … 「模試の回」「模試成績」「県一斉成績」をすべて返す（削除した行は除く）
 *   - action:'saveMoshiExam'      … 「模試の回」に1回を追加、または ID が同じ行を上書き
 *   - action:'deleteMoshiExam'    … 「模試の回」の「削除」列に 1 を立てる（行は消さない）
 *   - action:'saveMoshiResults'   … 「模試成績」に1回×1人の行を追加、または ID が同じ行の「変えた列（fields）」だけを書く
 *   - action:'deleteMoshiResults' … 「模試成績」の「削除」列に 1 を立てる
 *   - action:'saveMoshiKenitsu'   … 「県一斉成績」に取り込んだ県一斉模試の1回分を入れる（同じ回ID の行は入れかえる。氏名の列は無い）
 *   - action:'deleteMoshiKenitsu' … 「県一斉成績」から1回分の行を消す
 *
 * 【セットアップ手順】（本番用と dev 用で2回行う）
 * 1. 新しいスプレッドシートを作る（例「成績管理DB（本番）」「成績管理DB（dev）」）。
 *    ★生徒の氏名と成績が入るので、共有は必要な人だけにする（リンクの共有はしない）
 * 2. 拡張機能 → Apps Script を開き、このファイルの中身を貼り付ける
 * 3. 下の TOKEN を任意の合言葉にする（本番と dev で別の値にする。会議DXの合言葉とも別にする）
 * 4. エディタで setupSeiseki を1回「実行」し、権限を承認する
 *    → 「模試の回」「模試成績」「県一斉成績」のシートができる
 * 5. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *      実行するユーザー：自分／アクセスできるユーザー：全員
 * 6. Vercel の環境変数に設定する
 *      SEISEKI_SCRIPT_URL   = 発行された Web アプリの URL（/exec で終わる）
 *      SEISEKI_SCRIPT_TOKEN = 3. の合言葉
 *    本番用は Production、dev 用は Preview と Development に登録し、再デプロイする
 * 7. 確かめ：ブラウザで URL を開くと {"ok":true,"service":"chishokan-seiseki",...} が返る
 * ※ コードを直したら「デプロイを管理 → 編集 → バージョン：新バージョン」で出し直す（保存だけでは反映されない）
 * ※ スタンドアロンのプロジェクトで使うときは、スクリプトのプロパティ SEISEKI_SPREADSHEET_ID にスプレッドシートの ID を入れる
 *
 * 【シートの形】（1枚＝1つの表。1行目が見出し。読み書きは見出しの名前で引くので、列の順は変えてもよい）
 *   模試の回   … 1行＝1回。主キー「ID」。配点・分野・時間割・参考データなどは「設定」列に JSON
 *   模試成績   … 1行＝1回×1人。主キー「ID」、「模試ID」で模試の回を指す。「受験しない」が 1 の生徒は、その回を受けない（v1.10〜）。大問ごとの得点は教科ごとに「29,15,32,18」
 *                （空欄は「29,,32,18」）。「国語計」〜「合計」はシートで見るための列（保存のたびにここで計算し直す。アプリは使わない）
 *   県一斉成績 … 1行＝取り込んだ県一斉模試の1回×1人。「回ID＋校舎＋受験番号」で1行。氏名の列は持たない（名簿とは校舎＋受験番号で結ぶ）
 *   どの表も、消すときは「削除」列に 1 を立てる（県一斉成績は回ごとに入れかえるので行を消す）。日時は「2026/11/17 09:30」（日本時間）
 * 決まりと計算はアプリ側（lib/moshi/model.ts・lib/moshi/store.ts）。ここは言われたとおりに読み書きするだけ。
 * ★DB（Supabase）へ移すときは、lib/moshi/store.ts の保存先を足すだけでよい（画面と API は store.ts だけを使う。README「成績管理のDB」）。
 */

var TOKEN = ''; // 例 'seiseki-2026'。空なら検証しない（本番では必ず設定する）

var MOSHI_EXAM_SHEET = '模試の回';
var MOSHI_EXAM_HEADERS = ['ID', '模試名', '学年', '実施日', '設定', '作成日時', '作成者', '更新日時', '更新者', '削除'];
var MOSHI_RESULT_SHEET = '模試成績';
var MOSHI_SUBJECT_HEADERS = ['国語', '英語', '数学', '社会', '理科'];
var MOSHI_RESULT_HEADERS = ['ID', '模試ID', '校舎', '受験番号', '氏名', '性別', '第一志望', '第二志望', '第三志望', '第四志望',
  '国語', '英語', '数学', '社会', '理科', '国語計', '英語計', '数学計', '社会計', '理科計', '合計', 'コメント', '受験しない',
  '作成日時', '作成者', '更新日時', '更新者', '削除'];
var MOSHI_TOTAL_HEADERS = ['国語計', '英語計', '数学計', '社会計', '理科計', '合計'];
var MOSHI_KEN_SHEET = '県一斉成績';
// ★lib/moshi/store.ts の KEN_HEADERS と同じ。取り込みのときはアプリが見出しを送ってくるので、ここは最初のシート作りだけに使う
var MOSHI_KEN_STATS = ['国語', '英語', '数学', '社会', '理科', '3科合計', '5科合計'];
var MOSHI_KEN_SLOTS = ['公立第1', '公立第2', '国・私立第1', '国・私立第2'];

function moshiKenHeaders_() {
  var h = ['回ID', '回名', '実施日', '校舎', '受験番号', '性別', '内申点'];
  MOSHI_KEN_STATS.forEach(function (s) { h.push(s + ' 得点', s + ' 偏差値', s + ' 順位'); });
  MOSHI_KEN_SLOTS.forEach(function (s) { h.push(s + ' コード', s + ' 志望校名称', s + ' 判定', s + ' 合格確率'); });
  h.push('取込日時', '取込者');
  return h;
}

function doPost(e) {
  try {
    var data = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    if (TOKEN && data.token !== TOKEN) return json_({ ok: false, reason: 'invalid_token' });
    switch (data.action) {
      case 'listMoshi': return json_(listMoshi_(data));
      case 'saveMoshiExam': return json_(saveMoshiExam_(data));
      case 'deleteMoshiExam': return json_(deleteMoshiExam_(data));
      case 'saveMoshiResults': return json_(saveMoshiResults_(data));
      case 'deleteMoshiResults': return json_(deleteMoshiResults_(data));
      case 'saveMoshiKenitsu': return json_(saveMoshiKenitsu_(data));
      case 'deleteMoshiKenitsu': return json_(deleteMoshiKenitsu_(data));
      default: return json_({ ok: false, reason: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, reason: String(err) });
  }
}

function doGet() {
  return json_({ ok: true, service: 'chishokan-seiseki', ts: new Date().toISOString() });
}

/** 最初に1回だけエディタで実行する：シートを作り、権限を承認する（何度実行しても、今ある行は消さない）。 */
function setupSeiseki() {
  moshiSheet_(MOSHI_EXAM_SHEET, MOSHI_EXAM_HEADERS);
  moshiSheet_(MOSHI_RESULT_SHEET, MOSHI_RESULT_HEADERS);
  moshiSheet_(MOSHI_KEN_SHEET, moshiKenHeaders_());
  var first = book_().getSheets()[0];
  // 新しいスプレッドシートの空の「シート1」は消す
  if (first && first.getName() !== MOSHI_EXAM_SHEET && first.getLastRow() === 0 && book_().getSheets().length > 1) book_().deleteSheet(first);
  Logger.log('成績管理のシートを用意しました：' + book_().getSheets().map(function (s) { return s.getName(); }).join('・'));
}

// ---- 共通 -------------------------------------------------------------------

function book_() {
  var id = PropertiesService.getScriptProperties().getProperty('SEISEKI_SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function nowJp_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

// 見出し → 列番号（0始まり）。読み書きは見出しの名前で引く（列の追加・並べかえに強くするため）。
function colMap_(sh) {
  var headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var map = {};
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] == null ? '' : headers[c]).trim();
    if (h && map[h] === undefined) map[h] = c;
  }
  return map;
}

function cell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

// ---- 模試 -------------------------------------------------------------------

function moshiSheet_(name, headers) {
  var ss = book_();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    return sh;
  }
  var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var have = {};
  for (var i = 0; i < cur.length; i++) have[String(cur[i]).trim()] = true;
  for (var c = 0; c < headers.length; c++) {
    if (have[headers[c]]) continue;
    var at = sh.getLastColumn() + 1;
    sh.getRange(1, at).setValue(headers[c]);
    sh.getRange(1, at, sh.getMaxRows(), 1).setNumberFormat('@');
    have[headers[c]] = true;
  }
  return sh;
}

function moshiRows_(sh, headers) {
  if (sh.getLastRow() < 2) return [];
  var col = colMap_(sh);
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var obj = {};
    for (var i = 0; i < headers.length; i++) obj[headers[i]] = col[headers[i]] === undefined ? '' : cell_(values[r][col[headers[i]]]);
    if (!obj['ID']) continue;
    out.push({ row: r + 2, obj: obj });
  }
  return out;
}

function moshiToRow_(obj, col, width, headers) {
  var row = [];
  for (var i = 0; i < width; i++) row.push('');
  for (var j = 0; j < headers.length; j++) {
    var h = headers[j];
    if (col[h] === undefined) continue;
    row[col[h]] = obj[h] == null ? '' : obj[h];
  }
  return row;
}

function listMoshi_(data) {
  try {
    var exams = moshiRows_(moshiSheet_(MOSHI_EXAM_SHEET, MOSHI_EXAM_HEADERS), MOSHI_EXAM_HEADERS)
      .filter(function (x) { return x.obj['削除'] !== '1'; })
      .map(function (x) { delete x.obj['削除']; return x.obj; });
    var results = moshiRows_(moshiSheet_(MOSHI_RESULT_SHEET, MOSHI_RESULT_HEADERS), MOSHI_RESULT_HEADERS)
      .filter(function (x) { return x.obj['削除'] !== '1'; })
      .map(function (x) { delete x.obj['削除']; return x.obj; });
    // 県一斉成績タブは取り込んだときに作る（無ければ空）。見出しはアプリが送ってくる（lib/moshi/store.ts の KEN_HEADERS）
    var kenitsu = [];
    var ksh = book_().getSheetByName(MOSHI_KEN_SHEET);
    if (ksh && ksh.getLastRow() >= 2) {
      var kh = ksh.getRange(1, 1, 1, ksh.getLastColumn()).getValues()[0];
      var kv = ksh.getRange(2, 1, ksh.getLastRow() - 1, ksh.getLastColumn()).getValues();
      for (var r = 0; r < kv.length; r++) {
        var ko = {};
        for (var c = 0; c < kh.length; c++) if (kh[c] !== '') ko[String(kh[c]).trim()] = cell_(kv[r][c]);
        if (ko['回ID']) kenitsu.push(ko);
      }
    }
    return { ok: true, saved: 'moshi', exams: exams, results: results, kenitsu: kenitsu, fetchedAt: nowJp_() };
  } catch (err) {
    return { ok: false, reason: 'db_open_failed:' + err };
  }
}

function saveMoshiExam_(data) {
  var rec = data.exam || {};
  var id = String(rec['ID'] || '').trim();
  if (!id) return { ok: false, reason: 'bad_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = moshiSheet_(MOSHI_EXAM_SHEET, MOSHI_EXAM_HEADERS);
    var col = colMap_(sh);
    var width = Math.max(sh.getLastColumn(), MOSHI_EXAM_HEADERS.length);
    var rows = moshiRows_(sh, MOSHI_EXAM_HEADERS);
    var cur = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].obj['ID'] === id) cur = rows[i];
    var ts = nowJp_();
    rec['更新日時'] = ts;
    rec['削除'] = '';
    if (cur) {
      if (cur.obj['削除'] === '1') return { ok: false, reason: 'not_found' };
      rec['作成日時'] = cur.obj['作成日時'];
      rec['作成者'] = cur.obj['作成者'];
      sh.getRange(cur.row, 1, 1, width).setNumberFormat('@').setValues([moshiToRow_(rec, col, width, MOSHI_EXAM_HEADERS)]);
    } else {
      rec['作成日時'] = ts;
      rec['作成者'] = rec['更新者'] || '';
      sh.getRange(sh.getLastRow() + 1, 1, 1, width).setNumberFormat('@').setValues([moshiToRow_(rec, col, width, MOSHI_EXAM_HEADERS)]);
    }
    delete rec['削除'];
    return { ok: true, saved: 'moshiExam', item: rec };
  } catch (err) {
    return { ok: false, reason: 'db_open_failed:' + err };
  } finally {
    lock.releaseLock();
  }
}

function deleteMoshiExam_(data) {
  var id = String(data.id || '').trim();
  if (!id) return { ok: false, reason: 'bad_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = moshiSheet_(MOSHI_EXAM_SHEET, MOSHI_EXAM_HEADERS);
    var col = colMap_(sh);
    var rows = moshiRows_(sh, MOSHI_EXAM_HEADERS);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].obj['ID'] !== id) continue;
      sh.getRange(rows[i].row, col['削除'] + 1).setValue('1');
      sh.getRange(rows[i].row, col['更新日時'] + 1).setValue(nowJp_());
      sh.getRange(rows[i].row, col['更新者'] + 1).setValue(String(data.user || ''));
      return { ok: true, saved: 'moshiExam' };
    }
    return { ok: false, reason: 'not_found' };
  } catch (err) {
    return { ok: false, reason: 'db_open_failed:' + err };
  } finally {
    lock.releaseLock();
  }
}

// 「29,,32,18」→ 合計（数字が1つも無ければ ''）
function moshiCellSum_(v) {
  var parts = String(v == null ? '' : v).split(',');
  var sum = 0, any = false;
  for (var i = 0; i < parts.length; i++) {
    var s = parts[i].trim();
    if (s === '' || isNaN(Number(s))) continue;
    sum += Number(s);
    any = true;
  }
  return any ? sum : '';
}

function moshiTotals_(obj) {
  var all = 0, complete = true;
  for (var i = 0; i < MOSHI_SUBJECT_HEADERS.length; i++) {
    var t = moshiCellSum_(obj[MOSHI_SUBJECT_HEADERS[i]]);
    obj[MOSHI_SUBJECT_HEADERS[i] + '計'] = t;
    if (t === '') complete = false; else all += t;
  }
  obj['合計'] = complete ? all : '';
}

// data.rows = [{ record: {見出し名: 値}, fields: [この保存で変えた見出し名] }]。fields が無い・新しい行なら行まるごと書く。
function saveMoshiResults_(data) {
  var list = data.rows || [];
  if (!list.length) return { ok: true, saved: 'moshiResults', items: [] };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = moshiSheet_(MOSHI_RESULT_SHEET, MOSHI_RESULT_HEADERS);
    var col = colMap_(sh);
    var width = Math.max(sh.getLastColumn(), MOSHI_RESULT_HEADERS.length);
    var rows = moshiRows_(sh, MOSHI_RESULT_HEADERS);
    var byId = {};
    for (var i = 0; i < rows.length; i++) byId[rows[i].obj['ID']] = rows[i];
    var ts = nowJp_();
    var user = String(data.user || '');
    var appended = [];
    var items = [];
    var skip = { 'ID': 1, '作成日時': 1, '作成者': 1, '更新日時': 1, '更新者': 1, '削除': 1 };
    for (var n = 0; n < list.length; n++) {
      var rec = list[n].record || {};
      var id = String(rec['ID'] || '').trim();
      if (!id) continue;
      var cur = byId[id];
      var obj;
      if (cur && cur.obj['削除'] !== '1') {
        obj = {};
        for (var k in cur.obj) obj[k] = cur.obj[k];
        var fields = list[n].fields;
        if (fields && fields.length) {
          for (var f = 0; f < fields.length; f++) {
            if (!skip[fields[f]] && MOSHI_RESULT_HEADERS.indexOf(fields[f]) !== -1) obj[fields[f]] = rec[fields[f]] == null ? '' : String(rec[fields[f]]);
          }
        } else {
          for (var h = 0; h < MOSHI_RESULT_HEADERS.length; h++) {
            var hh = MOSHI_RESULT_HEADERS[h];
            if (!skip[hh]) obj[hh] = rec[hh] == null ? '' : String(rec[hh]);
          }
        }
        obj['更新日時'] = ts;
        obj['更新者'] = user;
        moshiTotals_(obj);
        sh.getRange(cur.row, 1, 1, width).setNumberFormat('@').setValues([moshiToRow_(obj, col, width, MOSHI_RESULT_HEADERS)]);
      } else if (cur) {
        continue; // 消した行は戻さない
      } else {
        obj = {};
        for (var a = 0; a < MOSHI_RESULT_HEADERS.length; a++) {
          var ah = MOSHI_RESULT_HEADERS[a];
          obj[ah] = rec[ah] == null ? '' : String(rec[ah]);
        }
        obj['作成日時'] = ts;
        obj['作成者'] = user;
        obj['更新日時'] = ts;
        obj['更新者'] = user;
        obj['削除'] = '';
        moshiTotals_(obj);
        appended.push(moshiToRow_(obj, col, width, MOSHI_RESULT_HEADERS));
        byId[id] = { row: -1, obj: obj };
      }
      var out = {};
      for (var o in obj) out[o] = obj[o];
      delete out['削除'];
      items.push(out);
    }
    if (appended.length) {
      sh.getRange(sh.getLastRow() + 1, 1, appended.length, width).setNumberFormat('@').setValues(appended);
    }
    return { ok: true, saved: 'moshiResults', items: items };
  } catch (err) {
    return { ok: false, reason: 'db_open_failed:' + err };
  } finally {
    lock.releaseLock();
  }
}

function deleteMoshiResults_(data) {
  var ids = data.ids || [];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = moshiSheet_(MOSHI_RESULT_SHEET, MOSHI_RESULT_HEADERS);
    var col = colMap_(sh);
    var rows = moshiRows_(sh, MOSHI_RESULT_HEADERS);
    var want = {};
    for (var i = 0; i < ids.length; i++) want[String(ids[i])] = true;
    var n = 0;
    for (var r = 0; r < rows.length; r++) {
      if (!want[rows[r].obj['ID']]) continue;
      sh.getRange(rows[r].row, col['削除'] + 1).setValue('1');
      sh.getRange(rows[r].row, col['更新日時'] + 1).setValue(nowJp_());
      sh.getRange(rows[r].row, col['更新者'] + 1).setValue(String(data.user || ''));
      n++;
    }
    return { ok: true, saved: 'moshiResults', deleted: n };
  } catch (err) {
    return { ok: false, reason: 'db_open_failed:' + err };
  } finally {
    lock.releaseLock();
  }
}

// 県一斉模試の成績を取り込む。data = { examId, headers: [見出し], rows: [{見出し: 値}], user }。
// その回（回ID）の行を消してから足す（取り込み直しても二重にならない）。氏名の列は持たない（アプリも送らない）。
function saveMoshiKenitsu_(data) {
  var examId = String(data.examId || '').trim();
  var headers = data.headers || [];
  var rows = data.rows || [];
  if (!examId || !headers.length) return { ok: false, reason: 'bad_input' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = moshiSheet_(MOSHI_KEN_SHEET, headers);
    var removed = moshiDeleteKenRows_(sh, examId);
    var col = colMap_(sh);
    var width = Math.max(sh.getLastColumn(), headers.length);
    if (rows.length) {
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var line = [];
        for (var w = 0; w < width; w++) line.push('');
        for (var h in rows[i]) if (col[h] !== undefined) line[col[h]] = rows[i][h] == null ? '' : rows[i][h];
        out.push(line);
      }
      // 受験番号の先頭の 0 が落ちないよう、先に文字列書式にしてから書く
      sh.getRange(sh.getLastRow() + 1, 1, out.length, width).setNumberFormat('@').setValues(out);
    }
    return { ok: true, saved: 'moshiKenitsu', count: rows.length, removed: removed };
  } catch (err) {
    return { ok: false, reason: 'db_open_failed:' + err };
  } finally {
    lock.releaseLock();
  }
}

function deleteMoshiKenitsu_(data) {
  var examId = String(data.examId || '').trim();
  if (!examId) return { ok: false, reason: 'bad_input' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = book_().getSheetByName(MOSHI_KEN_SHEET);
    var removed = sh ? moshiDeleteKenRows_(sh, examId) : 0;
    return { ok: true, saved: 'moshiKenitsu', removed: removed };
  } catch (err) {
    return { ok: false, reason: 'db_open_failed:' + err };
  } finally {
    lock.releaseLock();
  }
}

// 回ID が同じ行を消す。消した行の数を返す。
// 1つの回の行はまとめて足すので続いていることが多い。続いている行はまとめて1回で消す（1行ずつだと遅い）
function moshiDeleteKenRows_(sh, examId) {
  if (sh.getLastRow() < 2) return 0;
  var col = colMap_(sh);
  if (col['回ID'] === undefined) return 0;
  var ids = sh.getRange(2, col['回ID'] + 1, sh.getLastRow() - 1, 1).getValues();
  var n = 0;
  var i = ids.length - 1;
  while (i >= 0) {
    if (String(ids[i][0]).trim() !== examId) { i--; continue; }
    var end = i;
    while (i - 1 >= 0 && String(ids[i - 1][0]).trim() === examId) i--;
    sh.deleteRows(i + 2, end - i + 1);
    n += end - i + 1;
    i--;
  }
  return n;
}
