/**
 * 智翔館 門配管理 — Apps Script（Web アプリ）
 * -------------------------------------------------------
 * 門配管理（/monpai）の保存先。会議DXの Code.gs とは別のプロジェクト・別のスプレッドシートにする。
 *   - action:'monpaiMaster' … 「学校マスタ」「月別設定」を返す
 *   - action:'monpaiList'   … 「門配記録」のうち指定した月（months）の行を返す
 *   - action:'monpaiSave'   … 「門配記録」に1行追加、または ID が同じ行を上書き
 *   - action:'monpaiDelete' … 「削除」列に 1 を立てる（行は消さない。誤操作から戻せるように）
 *   - action:'monpaiMaterials'   … 「配布物」「配布物入出庫」と、実績の配布数（在庫はアプリ側で計算）
 *   - action:'monpaiSaveMaterial' … 「配布物」に1品追加、または品名が同じ行を上書き
 *   - action:'monpaiAddMovement'  … 「配布物入出庫」に1行追加（入庫はプラス、廃棄・調整はマイナス）
 *
 * 【セットアップ手順】（本番用と dev 用で2回行う）
 * 1. 新しいスプレッドシートを作る（例「門配管理（本番）」「門配管理（dev）」）
 * 2. 拡張機能 → Apps Script を開き、このファイルの中身を貼り付ける
 * 3. 下の TOKEN を任意の合言葉にする（本番と dev で別の値にする）
 * 4. エディタで seedMonpaiSchools を1回「実行」し、権限を承認する
 *    → 「学校マスタ」「月別設定」「門配記録」のシートができ、学校の初期値が入る
 * 5. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *      実行するユーザー：自分／アクセスできるユーザー：全員
 * 6. Vercel の環境変数に設定する
 *      MONPAI_SCRIPT_URL   = 発行された Web アプリの URL（/exec で終わる）
 *      MONPAI_SCRIPT_TOKEN = 3. の合言葉
 *    本番用は Production、dev 用は Preview と Development に登録し、再デプロイする
 * ※ コードを直したら「デプロイを管理 → 編集 → バージョン：新バージョン」で出し直す（保存だけでは反映されない）
 *
 * 【シートの手入力】
 * - 学校マスタ：地区／学校名／種別（中・小）／生徒数（中＝全校、小＝小2〜6）／並び順／備考
 * - 月別設定  ：月（2026-10）／学校名（空なら全校）／率（50 や 50% で 50%）／募集期（1 で募集期）
 * - 配布物    ：品名／種類／準備担当／発注目安／備考（アプリの「配布物」画面からも登録できる）
 * ※ v0.4.0 でシートを追加した。既存のプロジェクトはコードを貼り替えて「新バージョン」でデプロイし直す
 *   （「配布物」「配布物入出庫」のシートは最初に使ったときに自動でできる）
 */

var TOKEN = ''; // 例 'monpai-2026'。空なら検証しない（本番では必ず設定する）

var SCHOOL_SHEET = '学校マスタ';
var SCHOOL_HEADERS = ['地区', '学校名', '種別', '生徒数', '並び順', '備考'];
var SETTING_SHEET = '月別設定';
var SETTING_HEADERS = ['月', '学校名', '率', '募集期'];
var MATERIAL_SHEET = '配布物';
var MATERIAL_HEADERS = ['品名', '種類', '準備担当', '発注目安', '備考'];
var MOVEMENT_SHEET = '配布物入出庫';
var MOVEMENT_HEADERS = ['日付', '品名', '数量', 'メモ', '登録者', '登録日時'];
var RECORD_SHEET = '門配記録';
// ★lib/monpai/store.ts の RECORD_HEADERS と同じ順に保つ。末尾の「削除」はアプリには見せない。
var RECORD_HEADERS = [
  'ID', '日付', '時間', '地区', '学校', '担当1', '担当2', '配布物', '計画部数', '実施部数', '状態',
  '不実施理由', '反応メモ', '作成日時', '作成者', '更新日時', '更新者', '削除',
];

function doPost(e) {
  try {
    var data = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    if (TOKEN && data.token !== TOKEN) return json_({ ok: false, reason: 'invalid_token' });
    switch (data.action) {
      case 'monpaiMaster': return json_(master_());
      case 'monpaiList': return json_(list_(data));
      case 'monpaiSave': return json_(save_(data));
      case 'monpaiDelete': return json_(remove_(data));
      case 'monpaiMaterials': return json_(materials_());
      case 'monpaiSaveMaterial': return json_(saveMaterial_(data));
      case 'monpaiAddMovement': return json_(addMovement_(data));
      default: return json_({ ok: false, reason: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, reason: String(err) });
  }
}

function doGet() {
  return json_({ ok: true, service: 'chishokan-monpai', ts: new Date().toISOString() });
}

// ---- シート -----------------------------------------------------------------

// シートを用意する。無ければ作り、見出しが足りなければ右端に足す（既存の列の位置は変えない）。
// 全列を文字列書式にして、日付や「16:00-17:00」が勝手に変換されないようにする。
function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    return sh;
  }
  var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(function (h) { return String(h).trim(); });
  for (var i = 0; i < headers.length; i++) {
    if (cur.indexOf(headers[i]) !== -1) continue;
    var at = sh.getLastColumn() + 1;
    sh.getRange(1, at).setValue(headers[i]);
    sh.getRange(1, at, sh.getMaxRows(), 1).setNumberFormat('@');
    cur.push(headers[i]);
  }
  return sh;
}

function colMap_(sh) {
  var headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var map = {};
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c]).trim();
    if (h && map[h] === undefined) map[h] = c;
  }
  return map;
}

function cell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

// シートの全行を「見出し名 → 値」のオブジェクトにして返す。
function rows_(sh, headers) {
  if (sh.getLastRow() < 2) return [];
  var col = colMap_(sh);
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  return values.map(function (r, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h) { o[h] = col[h] === undefined ? '' : cell_(r[col[h]]); });
    return o;
  });
}

function toRow_(obj, col, width) {
  var row = [];
  for (var i = 0; i < width; i++) row.push('');
  RECORD_HEADERS.forEach(function (h) {
    if (col[h] !== undefined) row[col[h]] = obj[h] == null ? '' : String(obj[h]);
  });
  return row;
}

// ---- 取得 -----------------------------------------------------------------

function master_() {
  var strip = function (o) { delete o._row; return o; };
  return {
    ok: true,
    schools: rows_(sheet_(SCHOOL_SHEET, SCHOOL_HEADERS), SCHOOL_HEADERS).map(strip),
    settings: rows_(sheet_(SETTING_SHEET, SETTING_HEADERS), SETTING_HEADERS).map(strip),
  };
}

function list_(data) {
  var months = Array.isArray(data.months) ? data.months.map(String) : [];
  var items = rows_(sheet_(RECORD_SHEET, RECORD_HEADERS), RECORD_HEADERS).filter(function (o) {
    return o['ID'] && o['削除'] !== '1' && months.indexOf(String(o['日付']).slice(0, 7)) !== -1;
  });
  items.forEach(function (o) { delete o._row; delete o['削除']; });
  return { ok: true, items: items };
}

// ---- 保存 -----------------------------------------------------------------

function nowJp_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

function findRow_(sh, col, id) {
  if (sh.getLastRow() < 2) return -1;
  var ids = sh.getRange(2, col['ID'] + 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return -1;
}

function save_(data) {
  var rec = data.record || {};
  var id = String(rec['ID'] || '').trim();
  if (!id) return { ok: false, reason: 'bad_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(RECORD_SHEET, RECORD_HEADERS);
    var col = colMap_(sh);
    var width = Math.max(sh.getLastColumn(), RECORD_HEADERS.length);
    var row = findRow_(sh, col, id);
    var ts = nowJp_();
    rec['更新日時'] = ts;
    rec['削除'] = '';
    if (row === -1) {
      if (!data.isNew) return { ok: false, reason: 'not_found' };
      rec['作成日時'] = ts;
      sh.appendRow(toRow_(rec, col, width));
      sh.getRange(sh.getLastRow(), 1, 1, width).setNumberFormat('@');
    } else {
      // 作成日時・作成者は最初に登録したときの値を守る
      var cur = sh.getRange(row, 1, 1, width).getValues()[0];
      if (String(cur[col['削除']]) === '1') return { ok: false, reason: 'not_found' };
      rec['作成日時'] = cell_(cur[col['作成日時']]);
      rec['作成者'] = cell_(cur[col['作成者']]);
      sh.getRange(row, 1, 1, width).setNumberFormat('@').setValues([toRow_(rec, col, width)]);
    }
    delete rec['削除'];
    return { ok: true, item: rec };
  } finally {
    lock.releaseLock();
  }
}

function remove_(data) {
  var id = String(data.id || '').trim();
  if (!id) return { ok: false, reason: 'bad_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(RECORD_SHEET, RECORD_HEADERS);
    var col = colMap_(sh);
    var row = findRow_(sh, col, id);
    if (row === -1) return { ok: false, reason: 'not_found' };
    sh.getRange(row, col['削除'] + 1).setValue('1');
    sh.getRange(row, col['更新日時'] + 1).setValue(nowJp_());
    sh.getRange(row, col['更新者'] + 1).setValue(String(data.user || ''));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---- 配布物・ノベルティ -------------------------------------------------------

function materials_() {
  var strip = function (o) { delete o._row; return o; };
  // 在庫の計算に使うのは「配布物」と「実施部数」だけ。報告済み（実施部数あり）の行に絞って返す。
  var usage = rows_(sheet_(RECORD_SHEET, RECORD_HEADERS), RECORD_HEADERS)
    .filter(function (o) { return o['ID'] && o['削除'] !== '1' && o['配布物'] && o['実施部数'] !== ''; })
    .map(function (o) { return { '配布物': o['配布物'], '実施部数': o['実施部数'] }; });
  return {
    ok: true,
    items: rows_(sheet_(MATERIAL_SHEET, MATERIAL_HEADERS), MATERIAL_HEADERS).map(strip),
    movements: rows_(sheet_(MOVEMENT_SHEET, MOVEMENT_HEADERS), MOVEMENT_HEADERS).map(strip),
    usage: usage,
  };
}

function saveMaterial_(data) {
  var item = data.item || {};
  var name = String(item['品名'] || '').trim();
  if (!name) return { ok: false, reason: 'bad_name' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(MATERIAL_SHEET, MATERIAL_HEADERS);
    var col = colMap_(sh);
    var width = Math.max(sh.getLastColumn(), MATERIAL_HEADERS.length);
    var row = [];
    for (var i = 0; i < width; i++) row.push('');
    MATERIAL_HEADERS.forEach(function (h) { row[col[h]] = item[h] == null ? '' : String(item[h]); });
    var found = -1;
    if (sh.getLastRow() >= 2) {
      var names = sh.getRange(2, col['品名'] + 1, sh.getLastRow() - 1, 1).getValues();
      for (var r = 0; r < names.length; r++) if (String(names[r][0]).trim() === name) { found = r + 2; break; }
    }
    if (found === -1) sh.appendRow(row);
    else sh.getRange(found, 1, 1, width).setValues([row]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function addMovement_(data) {
  var m = data.movement || {};
  if (!String(m['品名'] || '').trim() || !Number(m['数量'])) return { ok: false, reason: 'invalid' };
  var sh = sheet_(MOVEMENT_SHEET, MOVEMENT_HEADERS);
  var col = colMap_(sh);
  var width = Math.max(sh.getLastColumn(), MOVEMENT_HEADERS.length);
  var row = [];
  for (var i = 0; i < width; i++) row.push('');
  m['登録日時'] = nowJp_();
  MOVEMENT_HEADERS.forEach(function (h) { row[col[h]] = m[h] == null ? '' : String(m[h]); });
  sh.appendRow(row);
  return { ok: true };
}

// ---- 初期値 -----------------------------------------------------------------

// 【セットアップ時に1回実行】3つのシートを作り、学校マスタが空なら初期値を入れる。
// 値は「RED広報関連」の画面から読み取ったもの（lib/monpai/seed.ts と同じ）。運用前に確認すること。
// 駅前・佐々・西海大島の学校は、学校マスタに手で追加する。
function seedMonpaiSchools() {
  sheet_(SETTING_SHEET, SETTING_HEADERS);
  sheet_(RECORD_SHEET, RECORD_HEADERS);
  var sh = sheet_(SCHOOL_SHEET, SCHOOL_HEADERS);
  if (sh.getLastRow() > 1) return;
  var rows = [
    ['大野', '大野中', '中', 546, 1, ''], ['大野', '中里中', '中', 376, 2, ''], ['大野', '柚木中', '中', 99, 3, ''],
    ['大野', '大野小', '小', 638, 4, ''], ['大野', '中里小', '小', 426, 5, ''], ['大野', '春日小', '小', 457, 6, ''],
    ['日野', '日野中', '中', 380, 1, ''], ['日野', '相浦中', '中', 447, 2, ''], ['日野', '愛宕中', '中', 216, 3, ''],
    ['日野', '日野小', '小', 479, 4, ''], ['日野', '相浦小', '小', 408, 5, ''],
    ['広田', '日宇中', '中', 613, 1, '日宇エリア'], ['広田', '大塔小', '小', 617, 2, '日宇エリア'],
    ['広田', '黒髪小', '小', 462, 3, '日宇エリア'], ['広田', '日宇小', '小', 329, 4, '日宇エリア'],
  ];
  sh.getRange(2, 1, rows.length, SCHOOL_HEADERS.length).setValues(rows);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
