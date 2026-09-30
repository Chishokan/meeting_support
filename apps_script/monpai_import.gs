/**
 * 門配管理 — スプレッドシート「RED広報関連」の「MP広告計画」タブから、実績と計画を取り込む
 * -------------------------------------------------------------------------------------------
 * 使い方
 * 1. 「RED広報関連」を開き、拡張機能 → Apps Script を開く
 *    （他の人のファイルで編集できない場合は、ファイル → コピーを作成 したものを使う）
 * 2. 新しいファイル（＋ → スクリプト）を作り、このファイルの中身を貼り付けて保存する
 * 3. 下の IMPORT_URL・IMPORT_TOKEN を設定する（IMPORT_TOKEN は Vercel の MONPAI_IMPORT_TOKEN と同じ値）
 * 4. previewMonpaiImport を「実行」→ 新しいタブ「門配_取込確認」に、取り込む予定の行が並ぶ。中身を確認する
 * 5. 問題なければ runMonpaiImport を「実行」→ 1か月ずつアプリに送る。結果は「実行ログ」に出る
 *
 * 【合言葉を設定せずに1回だけ取り込む場合】（3・5 の代わり）
 * A. buildMonpaiImportSql を「実行」→ 新しいタブ「門配_取込SQL」の A 列に SQL が並ぶ
 * B. A 列をまとめてコピー（A 列の見出しをクリック → コピー）し、Supabase の SQL Editor に貼り付けて Run
 *    ・入れる先は下の SQL_SCHEMA（dev は chishokan_dev、本番は chishokan_prod）
 *    ・先頭で、その区画の「シート取込」の記録（4〜10月）を消してから入れ直すので、何度実行しても二重にならない
 *
 * ・同じ月を何度送っても二重にならない（その月の「シート取込」の記録を入れ替える）
 * ・アプリで入力した記録には触らない
 * ・学校名はアプリの学校マスタと突き合わせる（頭の数字「7祇園中」の 7 は無視）。マスタに無い学校は取り込まれず、ログに出る
 */

var IMPORT_URL = 'https://meeting-support-dev.vercel.app/api/monpai/import'; // 本番に入れるときは https://meeting-support.vercel.app/api/monpai/import
var IMPORT_TOKEN = '';           // Vercel の MONPAI_IMPORT_TOKEN と同じ値
var SHEET_NAME = 'MP広告計画';
var FROM_MONTH = '2026-04';      // この月から
var TO_MONTH = '2026-10';        // この月まで（10月は計画も取り込む）
var HEADER_ROWS = 8;             // 見出しがある行（上から何行目まで）
var PREVIEW_SHEET = '門配_取込確認';
var SQL_SHEET = '門配_取込SQL';
var SQL_SCHEMA = 'chishokan_dev'; // 本番に入れるときは 'chishokan_prod'

// 学校 → 地区（アプリの学校マスタと同じ。SQL で取り込むときに使う）。ここに無い学校は取り込まずログに出す
var SCHOOL_DISTRICT = {
  '大野中': '大野', '中里中': '大野', '柚木中': '大野', '大野小': '大野', '中里小': '大野', '春日小': '大野',
  '日野中': '日野', '相浦中': '日野', '愛宕中': '日野', '日野小': '日野', '相浦小': '日野',
  '日宇中': '広田', '大塔小': '広田', '黒髪小': '広田', '日宇小': '広田',
  '祇園中': '駅前', '山澄中': '駅前', '福石中': '駅前', '崎辺中': '駅前', '祇園小': '駅前', '白南風小': '駅前',
  '佐々中': '佐々', '小佐々中': '佐々', '吉井中': '佐々', '江迎中': '佐々', '佐々小': '佐々', '口石小': '佐々',
  '大崎中': '西海大島', '西海中': '西海大島', '大崎小': '西海大島',
};

// ---- 実行する関数 -------------------------------------------------------------

function previewMonpaiImport() {
  var rows = parseMonpaiSheet_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = ss.getSheetByName(PREVIEW_SHEET) || ss.insertSheet(PREVIEW_SHEET);
  out.clear();
  var head = ['日付', '時間', '学校', '担当1', '担当2', '計画部数', '実施部数', '理由'];
  var values = [head].concat(rows.map(function (r) {
    return [r.date, r.time, r.school, r.staff1, r.staff2, r.planned, r.done === null ? '' : r.done, r.reason];
  }));
  out.getRange(1, 1, values.length, head.length).setNumberFormat('@').setValues(values);
  out.setFrozenRows(1);
  var byMonth = countByMonth_(rows);
  Logger.log('取り込み予定：' + rows.length + '行 ' + JSON.stringify(byMonth));
  SpreadsheetApp.getUi && ss.toast(rows.length + '行を「' + PREVIEW_SHEET + '」に出しました', '門配の取り込み確認', 10);
}

function runMonpaiImport() {
  if (!IMPORT_TOKEN) throw new Error('IMPORT_TOKEN を設定してください（Vercel の MONPAI_IMPORT_TOKEN と同じ値）');
  var rows = parseMonpaiSheet_();
  var months = monthsBetween_(FROM_MONTH, TO_MONTH);
  months.forEach(function (m) {
    var list = rows.filter(function (r) { return r.date.slice(0, 7) === m; });
    var res = UrlFetchApp.fetch(IMPORT_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-import-token': IMPORT_TOKEN },
      payload: JSON.stringify({ month: m, records: list }),
      muteHttpExceptions: true,
    });
    Logger.log(m + '：送信 ' + list.length + '行 → ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 800));
  });
}

function buildMonpaiImportSql() {
  var rows = parseMonpaiSheet_();
  var q = function (v) { return "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'"; };
  var t = SQL_SCHEMA + '.monpai_records';
  var lines = [
    '-- 門配の取り込み（' + FROM_MONTH + '〜' + TO_MONTH + '、MP広告計画タブ）。入れる先：' + SQL_SCHEMA,
    "delete from " + t + " where created_by = 'シート取込' and date >= '" + FROM_MONTH + "-01' and date < '" + nextMonth_(TO_MONTH) + "-01';",
  ];
  var skipped = {};
  var count = 0;
  rows.forEach(function (r) {
    var school = String(r.school).replace(/[\s　]/g, '');
    var district = SCHOOL_DISTRICT[school];
    if (!district) { skipped[school] = (skipped[school] || 0) + 1; return; }
    var done = r.done === null ? 'null' : String(r.done);
    var status = r.done === null ? '予定' : '実施';
    lines.push('insert into ' + t + ' (date, time, district, school, staff1, staff2, planned, done, status, reason, created_by, updated_by) values ('
      + [q(r.date), q(r.time), q(district), q(school), q(r.staff1), q(r.staff2), String(r.planned), done, q(status), q(r.reason), q('シート取込'), q('シート取込')].join(', ') + ');');
    count++;
  });
  lines.push("select to_char(date, 'YYYY-MM') as 月, count(*) as 件数 from " + t + " where created_by = 'シート取込' group by 1 order by 1;");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = ss.getSheetByName(SQL_SHEET) || ss.insertSheet(SQL_SHEET);
  out.clear();
  out.getRange(1, 1, lines.length, 1).setNumberFormat('@').setValues(lines.map(function (l) { return [l]; }));
  Logger.log('SQL を ' + count + '件分 書き出しました。学校マスタに無く飛ばした学校：' + JSON.stringify(skipped));
  ss.toast(count + '件分の SQL を「' + SQL_SHEET + '」の A 列に出しました', '門配の取り込み', 10);
}

function nextMonth_(ym) {
  var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5), 10) + 1;
  if (m > 12) { m = 1; y++; }
  return y + '-' + ('0' + m).slice(-2);
}

// ---- シートの読み取り -----------------------------------------------------------

function parseMonpaiSheet_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('タブ「' + SHEET_NAME + '」が見つかりません');
  var values = sh.getDataRange().getDisplayValues();
  var width = values[0].length;
  var blocks = findBlocks_(values, width);
  if (!blocks.length) throw new Error('「計画」「実施済」の見出しが見つかりません（HEADER_ROWS を確認）');

  var months = findMonthRows_(values);           // [{ row, ym }]
  var out = [];
  for (var mi = 0; mi < months.length; mi++) {
    var ym = months[mi].ym;
    if (ym < FROM_MONTH || ym > TO_MONTH) continue;
    var start = months[mi].row + 1;
    var end = mi + 1 < months.length ? months[mi + 1].row : values.length;
    for (var r = start; r < end; r++) {
      var row = values[r];
      blocks.forEach(function (b) {
        var day = parseInt(String(row[b.dayCol]).trim(), 10);
        if (!(day >= 1 && day <= 31)) return;
        var planned = num_(row[b.planCol]);
        var done = b.doneCol >= 0 ? num_(row[b.doneCol]) : null;
        if (!(planned > 0) && !(done > 0)) return;  // 計画も実績も無い日は取り込まない
        var who = pickLine_(row[b.timeCol], row[b.staff1Col], row[b.staff2Col], b.school);
        out.push({
          date: ym + '-' + ('0' + day).slice(-2),
          time: who.time,
          school: b.school,
          staff1: who.staff1,
          staff2: who.staff2,
          planned: planned > 0 ? planned : 0,
          done: done,
          reason: b.reasonCol >= 0 && done !== null && planned > 0 && done < planned ? String(row[b.reasonCol]).trim().slice(0, 200) : '',
        });
      });
    }
  }
  return out;
}

// 見出し（上から HEADER_ROWS 行）から、学校ごとの列の位置を求める。
// 「計画」の列ごとに1校。学校名は「計画」の上にある、数字や説明ではない最初の文字。
// 日・時間・担当・不実施理由は、その学校より左にある一番近い見出しの列。
function findBlocks_(values, width) {
  var label = function (r, c) { return String(values[r][c] || '').replace(/[\s　]/g, ''); };
  var colsOf = function (names) {
    var cols = [];
    for (var c = 0; c < width; c++) for (var r = 0; r < HEADER_ROWS; r++) if (names.indexOf(label(r, c)) !== -1) { cols.push(c); break; }
    return cols;
  };
  var leftNearest = function (cols, c, limit) {
    var best = -1;
    cols.forEach(function (x) { if (x < c && c - x <= (limit || 40) && x > best) best = x; });
    return best;
  };
  var dayCols = colsOf(['日']);
  var timeCols = colsOf(['時間']);
  var staff1Cols = colsOf(['担当1', '担当']);
  var staff2Cols = colsOf(['担当2']);
  var reasonCols = colsOf(['不実施理由']);

  var blocks = [];
  for (var c = 0; c < width; c++) {
    for (var r = 0; r < HEADER_ROWS; r++) {
      if (label(r, c) !== '計画') continue;
      var school = '';
      for (var up = r - 1; up >= 0 && !school; up--) {
        var t = String(values[up][c] || '').trim();
        if (!t || /^[\d,.\s]+$/.test(t) || /生徒数|ボトム|High|計画|実施|担当|時間|広告|POS/.test(t)) continue;
        school = t.replace(/^[\s　\d０-９]+/, '');
      }
      var dayCol = leftNearest(dayCols, c);
      if (!school || dayCol < 0) continue;  // 合計列などは学校名が無いので飛ばす
      var staff2 = leftNearest(staff2Cols, c);
      blocks.push({
        school: school,
        planCol: c,
        doneCol: label(r, c + 1) === '実施済' ? c + 1 : -1,
        dayCol: dayCol,
        timeCol: leftNearest(timeCols, c),
        staff1Col: leftNearest(staff1Cols, c),
        staff2Col: staff2 > dayCol ? staff2 : -1,
        reasonCol: leftNearest(reasonCols, dayCol + 1, 5), // 不実施理由は日付の列のすぐ左（2列ほど）にある
      });
    }
  }
  return blocks;
}

// 「9月」のような月の区切りの行を探し、年を補う（FROM_MONTH の年から始め、1月に戻ったら翌年）。
// 取り込む範囲より前の行（2025年度以前）は FROM_MONTH の月が最後に現れた位置から数える。
function findMonthRows_(values) {
  var marks = [];
  for (var r = HEADER_ROWS; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      var m = /^(\d{1,2})月$/.exec(String(values[r][c] || '').trim());
      if (m) { marks.push({ row: r, month: parseInt(m[1], 10) }); break; }
    }
  }
  var fromY = parseInt(FROM_MONTH.slice(0, 4), 10), fromM = parseInt(FROM_MONTH.slice(5), 10);
  // 取り込み開始の月が最後に現れた位置（それより上は前の年度）
  var startIdx = -1;
  for (var i = marks.length - 1; i >= 0; i--) if (marks[i].month === fromM) { startIdx = i; break; }
  if (startIdx < 0) throw new Error(fromM + '月の区切りの行が見つかりません');
  var out = [];
  var y = fromY, prev = fromM;
  for (var j = startIdx; j < marks.length; j++) {
    if (marks[j].month < prev) y++;
    prev = marks[j].month;
    out.push({ row: marks[j].row, ym: y + '-' + ('0' + marks[j].month).slice(-2) });
  }
  return out;
}

// 時間・担当のセルは「大野小15:00-\n大野中16:00-17:」のように複数校が改行で並ぶことがある。
// 学校名を含む行を選び、同じ行番号の担当を取る。1行しか無ければそれを使う。
function pickLine_(timeCell, staff1Cell, staff2Cell, school) {
  var split = function (v) { return String(v || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(String); };
  var times = split(timeCell), s1 = split(staff1Cell), s2 = split(staff2Cell);
  var i = -1;
  for (var k = 0; k < times.length; k++) if (times[k].replace(/[\s　]/g, '').indexOf(school) !== -1) { i = k; break; }
  if (i < 0 && times.length === 1) i = 0;
  var clean = function (s) { return String(s || '').replace(/^[\s　\d０-９]+/, '').trim(); };
  var t = i >= 0 ? times[i] : '';
  var m = /(\d{1,2}[:：]\d{2}\s*[~〜\-－]?\s*(\d{1,2}[:：]?\d{0,2})?)/.exec(t);
  var pick = function (arr) { return arr.length === 0 ? '' : clean(i >= 0 && arr[i] !== undefined ? arr[i] : arr.length === 1 ? arr[0] : ''); };
  return { time: m ? m[1].replace(/：/g, ':').trim() : '', staff1: pick(s1), staff2: pick(s2) };
}

function num_(v) {
  var s = String(v == null ? '' : v).replace(/[,\s]/g, '');
  if (s === '' || !/^\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

function monthsBetween_(from, to) {
  var out = [];
  var y = parseInt(from.slice(0, 4), 10), m = parseInt(from.slice(5), 10);
  while (true) {
    var ym = y + '-' + ('0' + m).slice(-2);
    if (ym > to) break;
    out.push(ym);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

function countByMonth_(rows) {
  var c = {};
  rows.forEach(function (r) { var k = r.date.slice(0, 7); c[k] = (c[k] || 0) + 1; });
  return c;
}
