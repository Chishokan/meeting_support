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
 * ・地区ごとのブロック（日の列〜不実施理由の列）ごとに読む。月の区切り（「９月」など全角も可）の行がブロックでずれていても合わせる
 * ・「50\n30」のように改行で2つの数があるときは足す（80）。先の日の実施済は空（未報告）にする
 * ・担当の欄に書かれた時間は「時間」へ、行事や配布物などのメモは「メモ」へ移し、担当には名前だけを残す
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
  '日宇中': '日宇', '大塔小': '日宇', '黒髪小': '日宇', '日宇小': '日宇',
  '広田中': '広田', '早岐中': '広田', '東明中': '広田', '広田小': '広田',
  '祇園中': '駅前', '山澄中': '駅前', '福石中': '駅前', '崎辺中': '駅前', '祇園小': '駅前', '白南風小': '駅前',
  '佐々中': '佐々', '小佐々中': '佐々', '吉井中': '佐々', '江迎中': '佐々', '佐々小': '佐々', '口石小': '佐々',
  '大崎中': '西海大島', '西海中': '西海大島', '大崎小': '西海大島', '西海東小': '西海大島',
};

// ---- 実行する関数 -------------------------------------------------------------

function previewMonpaiImport() {
  var rows = parseMonpaiSheet_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = ss.getSheetByName(PREVIEW_SHEET) || ss.insertSheet(PREVIEW_SHEET);
  out.clear();
  var head = ['日付', '時間', '学校', '担当1', '担当2', '計画部数', '実施部数', '理由', 'メモ'];
  var values = [head].concat(rows.map(function (r) {
    return [r.date, r.time, r.school, r.staff1, r.staff2, r.planned, r.done === null ? '' : r.done, r.reason, r.memo];
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
  var q = function (v) { return "'" + oneLine_(v).replace(/'/g, "''") + "'"; };
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
    lines.push('insert into ' + t + ' (date, time, district, school, staff1, staff2, planned, done, status, reason, memo, created_by, updated_by) values ('
      + [q(r.date), q(r.time), q(district), q(school), q(r.staff1), q(r.staff2), String(r.planned), done, q(status), q(r.reason), q(r.memo), q('シート取込'), q('シート取込')].join(', ') + ');');
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

  var monthsByBlock = findMonthRows_(values, blocks);   // dayCol → [{ row, ym }]
  var now = new Date();
  var today = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
  var out = [];
  blocks.forEach(function (b) {
    var months = monthsByBlock[b.dayCol];
    for (var mi = 0; mi < months.length; mi++) {
      var ym = months[mi].ym;
      if (ym < FROM_MONTH || ym > TO_MONTH) continue;
      var end = mi + 1 < months.length ? months[mi + 1].row : values.length;
      for (var r = months[mi].row; r < end; r++) {
        var row = values[r];
        var day = parseInt(String(row[b.dayCol]).trim(), 10);
        if (!(day >= 1 && day <= 31) || !/^\s*\d{1,2}\s*$/.test(String(row[b.dayCol]))) continue;
        var planned = num_(row[b.planCol]);
        var done = b.doneCol >= 0 ? num_(row[b.doneCol]) : null;
        if (!(planned > 0) && !(done > 0)) continue;  // 計画も実績も無い日は取り込まない
        var date = ym + '-' + ('0' + day).slice(-2);
        if (date > today) {                            // 先の日：実施済の数は計画の書き間違い、「0」はまだ報告が無いだけ
          if (!(planned > 0) && done > 0) planned = done;
          done = null;
        }
        var who = pickLine_(row[b.timeCol], row[b.staff1Col], row[b.staff2Col], b.school);
        // 担当の欄に時間や行事のメモが書かれていたら、名前だけを担当に残し、時間は時間へ、残りはメモへ
        var memo = [];
        var staff = function (v) {
          var sp = splitStaff_(v, b.school);
          if (sp.time && !who.time) who.time = sp.time;
          if (sp.memo) memo.push('担当欄：' + sp.memo);
          return sp.staff;
        };
        var staff1 = staff(who.staff1), staff2 = staff(who.staff2);
        var short = done !== null && planned > 0 && done < planned;
        out.push({
          date: date,
          time: oneLine_(who.time),
          school: b.school,
          staff1: staff1,
          staff2: staff2,
          planned: planned > 0 ? planned : 0,
          done: done,
          reason: short && b.reasonCol >= 0 ? reasonFor_(row[b.reasonCol], b.school).slice(0, 200) : '',
          memo: memo.join(' ').slice(0, 200),
        });
      }
    }
  });
  out.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
  return out;
}

// 見出し（上から HEADER_ROWS 行）から、学校ごとの列の位置を求める。
// シートは地区ごとの「ブロック」が左から並ぶ（日・曜・時間・担当 … 学校ごとに「計画」「実施済」… 不実施理由）。
// ブロックは「日」の列から、次の「日」の列の手前まで。時間・担当・不実施理由は同じブロックの中の列だけを使う。
// 「計画」の列ごとに1校。学校名は「計画」の上にある、数字や説明ではない最初の文字の1行目（「1大野中\n智 R３」→ 大野中）。
function findBlocks_(values, width) {
  var label = function (r, c) { return String(values[r][c] || '').replace(/[\s　]/g, ''); };
  var colsOf = function (names) {
    var cols = [];
    for (var c = 0; c < width; c++) for (var r = 0; r < HEADER_ROWS; r++) if (names.indexOf(label(r, c)) !== -1) { cols.push(c); break; }
    return cols;
  };
  var dayCols = colsOf(['日']);
  var inBlock = function (cols, from, to) { return cols.filter(function (x) { return x >= from && x < to; }); };
  var timeCols = colsOf(['時間']), staff1Cols = colsOf(['担当1', '担当']), staff2Cols = colsOf(['担当2']), reasonCols = colsOf(['不実施理由']);

  var blocks = [];
  for (var c = 0; c < width; c++) {
    for (var r = 0; r < HEADER_ROWS; r++) {
      if (label(r, c) !== '計画') continue;
      var school = '';
      for (var up = r - 1; up >= 0 && !school; up--) {
        var first = String(values[up][c] || '').split(/\r?\n/)[0].trim();
        if (!first || /^[\d,.\s]+$/.test(first) || /生徒数|ボトム|High|計画|実施|担当|時間|広告|POS/.test(first)) continue;
        school = first.replace(/^[\s　\d０-９]+/, '').replace(/[\s　]/g, '');
      }
      var dayCol = -1, next = width;
      dayCols.forEach(function (d) { if (d < c && d > dayCol) dayCol = d; });
      dayCols.forEach(function (d) { if (d > c && d < next) next = d; });
      if (school && dayCol >= 0) {   // 合計列などは学校名が無いので飛ばす
        var last = function (cols) { var x = inBlock(cols, dayCol, c); return x.length ? x[x.length - 1] : -1; };
        var reason = inBlock(reasonCols, c, next);
        blocks.push({
          school: school,
          planCol: c,
          doneCol: label(r, c + 1) === '実施済' ? c + 1 : -1,
          dayCol: dayCol,
          nextDayCol: next,
          timeCol: last(timeCols),
          staff1Col: last(staff1Cols),
          staff2Col: last(staff2Cols),
          reasonCol: reason.length ? reason[0] : -1,  // 不実施理由はブロックの右端
        });
      }
      break; // 1つの列に「計画」が2回あっても1校として数える（二重取り込みを防ぐ）
    }
  }
  // ブロックの中に、ほかの地区の学校（表の作りかけで残った列など）があれば外す
  var skipped = [];
  var byDay = {};
  blocks.forEach(function (b) { (byDay[b.dayCol] = byDay[b.dayCol] || []).push(b); });
  var kept = blocks.filter(function (b) {
    var count = {};
    byDay[b.dayCol].forEach(function (x) { var d = SCHOOL_DISTRICT[x.school]; if (d) count[d] = (count[d] || 0) + 1; });
    var main = Object.keys(count).sort(function (x, y) { return count[y] - count[x]; })[0];
    var mine = SCHOOL_DISTRICT[b.school];
    if (mine && main && mine !== main) { skipped.push(b.school + '（' + main + 'の表の中）'); return false; }
    return true;
  });
  if (skipped.length) Logger.log('ほかの地区の表の中にあるので取り込まない列：' + skipped.join('、'));
  return kept;
}

// 「９月」「10月」のような月の区切りを探す（全角の数字も読む）。
// 区切りの行はブロックごとに1行ずれることがあるので、ブロックごとに探す。
// ブロックに区切りが無い月は、ほかのブロックの区切りの行を使う。
// 年度の始まり（FROM_MONTH の月が最後に現れた行）より上は前の年度なので見ない。
function monthMark_(v) {
  var t = String(v || '').replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFEE0); }).replace(/[\s　]/g, '');
  var m = /^(\d{1,2})月$/.exec(t);
  return m && +m[1] >= 1 && +m[1] <= 12 ? +m[1] : 0;
}

function findMonthRows_(values, blocks) {
  var fromY = parseInt(FROM_MONTH.slice(0, 4), 10), fromM = parseInt(FROM_MONTH.slice(5), 10);
  var marks = [];  // { row, col, month }
  for (var r = HEADER_ROWS; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      var m = monthMark_(values[r][c]);
      if (m) marks.push({ row: r, col: c, month: m });
    }
  }
  var startRow = -1;
  marks.forEach(function (k) { if (k.month === fromM) startRow = Math.max(startRow, k.row); });
  if (startRow < 0) throw new Error(fromM + '月の区切りの行が見つかりません');
  marks = marks.filter(function (k) { return k.row >= startRow; });
  var ymOf = function (m) { return (m >= fromM ? fromY : fromY + 1) + '-' + ('0' + m).slice(-2); };

  // 各月の区切りの行（ブロックで見つからないときに使う）：いちばん上の行
  var common = {};
  marks.forEach(function (k) { if (!(k.month in common) || k.row < common[k.month]) common[k.month] = k.row; });

  var byBlock = {};  // dayCol → [{ row, ym }]
  blocks.forEach(function (b) {
    if (byBlock[b.dayCol]) return;
    var own = {};
    marks.forEach(function (k) {
      if (k.col >= b.dayCol - 2 && k.col < b.nextDayCol - 2 && !(k.month in own)) own[k.month] = k.row;
    });
    var list = Object.keys(common).map(function (m) { return { row: m in own ? own[m] : common[m], ym: ymOf(+m) }; });
    list.sort(function (x, y) { return x.row - y.row; });
    byBlock[b.dayCol] = list;
  });
  return byBlock;
}

// 時間・担当のセルは「大野小15:00-\n大野中16:00-17:」のように複数校が改行で並ぶことがある。
// 学校名を含む行を選び、同じ行番号の担当を取る。1行しか無ければそれを使う。
function pickLine_(timeCell, staff1Cell, staff2Cell, school) {
  var split = function (v) { return String(v || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(String); };
  var s1 = split(staff1Cell), s2 = split(staff2Cell);
  // 時間の列が無いブロック（広田・大島）は、担当の欄に「広18:00～(松)」のように時間も書く
  var times = timeCell === undefined ? s1 : split(timeCell);
  var i = -1;
  for (var k = 0; k < times.length; k++) if (times[k].replace(/[\s　]/g, '').indexOf(school) !== -1) { i = k; break; }
  // 学校名の頭1文字の略記：「広」＝広田中、「広小」＝広田小、「早」＝早岐中
  var abbr = new RegExp('^' + school.charAt(0) + (/小$/.test(school) ? '小' : '(?!小)'));
  for (var k2 = 0; i < 0 && k2 < times.length; k2++) if (abbr.test(times[k2]) && /\d{1,2}[:：]\d{2}/.test(times[k2])) i = k2;
  if (i < 0 && times.length === 1) i = 0;
  // 頭の番号（「1愛宕中」「②平野」）は外す。「15：20～」のような時間の数字は残す
  var clean = function (s) { return String(s || '').replace(/^[\s　]*[\d０-９]+(?![\d０-９:：])/, '').trim(); };
  var t = i >= 0 ? times[i] : '';
  var m = /^[:：]/.test(t) ? null : /(\d{1,2}[:：]\d{2}\s*[~〜～\-－]?\s*(\d{1,2}[:：]?\d{0,2})?)/.exec(t);
  var pick = function (arr) { return arr.length === 0 ? '' : clean(i >= 0 && arr[i] !== undefined ? arr[i] : arr.length === 1 ? arr[0] : ''); };
  return { time: m ? m[1].replace(/：/g, ':').replace(/[〜～]/g, '~').trim() : '', staff1: pick(s1), staff2: pick(s2) };
}

// 不実施理由のセルは、隣の学校の理由がまとめて書かれていることがある。
// 行ごとに見て、この学校の名前がある行を使う。ほかの学校の名前だけが書かれた行は使わない。
function reasonFor_(cell, school) {
  var stem = function (n) { return n.replace(/[中小]$/, ''); };               // 大野中 → 大野
  var stems = Object.keys(SCHOOL_DISTRICT).map(stem);
  var lines = String(cell || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(String);
  var mine = [], neutral = [];
  lines.forEach(function (l) {
    var flat = l.replace(/[\s　]/g, '');
    if (flat.indexOf(school) !== -1) mine.push(l);
    else if (!stems.some(function (n) { return flat.indexOf(n) !== -1; })) neutral.push(l); // 学校名の無い行
  });
  return oneLine_((mine.length ? mine : neutral).join(' '));
}

// 「50\n30」のように改行で複数の数が入っているときは足す（5030 にしない）
function num_(v) {
  var parts = String(v == null ? '' : v).split(/\r?\n/).map(function (s) { return s.replace(/[,\s　]/g, ''); }).filter(String);
  if (!parts.length) return null;
  var sum = 0;
  for (var i = 0; i < parts.length; i++) {
    if (!/^\d+$/.test(parts[i])) return null;
    sum += parseInt(parts[i], 10);
  }
  return sum;
}

// 改行・タブを空白1つにする（SQL の1行が途中で切れないように）
function oneLine_(v) {
  return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// 担当の欄には名前のほかに、時間・行事・配布物のメモが書かれていることがある。
// 「越智、松田17:30-18:30」→ 担当 越智、松田／時間 17:30-18:30
// 「広18:00～(松)」→ 担当 松／時間 18:00～
// 「溝口 ボックスティッシュ100」→ 担当 溝口／メモ
// 「始業式」「雨で不実施→4/16㈭変更」→ 担当なし／メモ
// 名前だけ（そのまま）のとき以外は、元の文字をメモに残す。
var NOTE_WORDS_ = /式|雨|変更|中止|不実施|休|作業|行事|テスト|先生|ティッシュ|リスケ|ため|タイミング|終了|開始|給食|面談|入面/;
var NAME_ = /^[一-龥々ぁ-んァ-ヶー]{1,5}$/;
function isNames_(s) {
  var parts = s.split(/[、,，・\s　]+/).filter(String);
  return parts.length > 0 && parts.every(function (p) { return NAME_.test(p) && !NOTE_WORDS_.test(p) && !(p in SCHOOL_DISTRICT); });
}
function splitStaff_(v, school) {
  var raw = oneLine_(v);
  var res = { staff: '', time: '', memo: '' };
  if (!raw) return res;
  var t = raw.replace(/^[①-⑳]+/, '');
  Object.keys(SCHOOL_DISTRICT).forEach(function (n) { if (t.indexOf(n) === 0) t = t.slice(n.length); });
  t = t.trim();
  if (isNames_(t)) { res.staff = t.replace(/[,，\s　]+/g, '、'); return res; }  // 名前だけ（頭の学校名・①は外す）
  // 「：20～15：40」のように頭が欠けた時間は読まない（メモに残す）
  var tm = /^[:：]/.test(t) ? null : /(\d{1,2}[:：]\d{2}\s*[~〜～\-－]?\s*(\d{1,2}[:：]\d{2})?)/.exec(t);
  if (tm) { res.time = tm[1].replace(/：/g, ':').replace(/[〜～]/g, '~').trim(); t = t.replace(tm[1], ' '); }
  var names = [];
  t = t.replace(/[（(]([^）)]*)[）)]/g, function (_, n) { if (isNames_(n.trim())) names.push(n.trim()); return ' '; });
  if (t.indexOf('→') !== -1) { var after = t.split('→').pop().trim(); if (isNames_(after)) names.push(after); t = ''; }
  // 先頭の名前（空白や、で区切られたもの、またはカタカナの前まで）
  var head = /^\s*([一-龥々ぁ-ん]{1,4}(?:[、,，・][一-龥々ぁ-ん]{1,4})*)(?=[\s　ァ-ヶ]|$)/.exec(t);
  if (!names.length && head && !NOTE_WORDS_.test(head[1]) && head[1].length > 1) names.push(head[1]);
  var uniq = [];
  names.join('、').split(/[、,，・]/).forEach(function (n) { if (n && uniq.indexOf(n) === -1) uniq.push(n); });
  res.staff = uniq.join('、');
  // 時間・名前・頭の略記（広・広小・早）を除いて何も残らなければ、メモは要らない
  var rest = t;
  uniq.forEach(function (n) { rest = rest.split(n).join(''); });
  rest = rest.replace(/^[一-龥]小?/, '').replace(/[~〜～\-－、,，・\s　]/g, '');
  res.memo = rest ? raw : '';
  return res;
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
