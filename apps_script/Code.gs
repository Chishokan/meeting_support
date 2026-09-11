/**
 * 智翔館 会議DX — ログ転記用 Apps Script（Web アプリ）
 * -------------------------------------------------------
 * アプリ（Vercel）から送られる以下を Google へ転記する。
 *   - action:'log'          … 会議AI / 議事録の会話ログ → スプレッドシート「会話ログ」
 *   - action:'saveMinutes'  … 議事録スレッドの保存       → スプレッドシート「議事録」
 *   - action:'saveDeptMinutes' … 「部門会議議事録」の保存 → 「部門会議議事録」シートに1会議1行＋
 *                                                          「部門決定事項」シートに1決定1行
 *   - action:'listDeptMinutes' … 部門会議議事録の一覧
 *   - action:'listDeptDecisions' … 部門横断の決定事項一覧（決め事の見える化）
 *   - action:'appendReport' … 「報告」からの事前報告      → Google ドキュメント（REPORT_DOC_ID）に新セクション追記
 *   - action:'appendProgress' … 「中間報告」の進捗報告     → 同ドキュメントの【中間報告タブ】に追記＋「中間報告状況」シートに記録
 *   - action:'listProgress' … ダッシュボード用の直近報告者  → 「中間報告状況」シートを新しい順に返す
 *   - action:'getProgressItems'/'saveProgressItems' … 中間報告の定例項目の取得・保存 → 「中間報告項目」シート（1行1項目）
 *   - action:'saveNumbers'  … 「数値報告」メニューの入力       → 「夏期数値」シートに1行で記録（校舎ごと・送り直すと追記）
 *   - action:'listNumbers'  … 会議AI・数値報告画面での参照     → 「夏期数値」シートを新しい順に返す
 *   - action:'saveReview'   … 「全体会議振り返り」の入力      → 「全体会議振り返り」シートに1行で記録
 *   - action:'saveSuccess'  … 夏期結果報告の成功事例        → 「成功事例」シートに1件1行で記録（「報告」転記時に自動）
 *   - action:'listSuccess'  … ダッシュボード用の成功事例一覧  → 「成功事例」シートを新しい順に返す
 *   - action:'listInquiryBoard' … 問い合わせQA用の小中等部問合せ管理 → 別スプレッドシート（INQUIRY_BOARD_ID）を校舎シートごとに読み、個人情報を落として返す
 *   - action:'listGoals'        … 目標管理用 → 中等部会議議事録（GOALS_BOOK_ID）の「秋～冬行動計画」タブから月×校舎×指標の目標／実績を返す
 *     ※ 初回は GAS エディタで seedProgressItems() を一度実行すると、全部門の初期項目がシートに入ります（以後は手動でも編集可）。
 *
 * 【セットアップ手順】
 * 1. 転記先スプレッドシートを開き、拡張機能 → Apps Script でこのコードを貼り付ける
 *    （またはスタンドアロンのプロジェクトを作り、下の SPREADSHEET_ID を設定）。
 * 2. TOKEN を任意の合言葉に設定（空なら検証しない）。
 * 3. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *      実行するユーザー：自分
 *      アクセスできるユーザー：全員
 *    → 発行された URL をコピー。
 * 4. Vercel の環境変数に設定：
 *      APPS_SCRIPT_URL   = 発行された Web アプリ URL
 *      APPS_SCRIPT_TOKEN = 上の TOKEN と同じ値（TOKEN を空にした場合は未設定でよい）
 * 5. 動作確認：ブラウザで URL を開くと {"ok":true,...} が返れば公開成功。
 *
 * ※ すでに doPost を持つ既存プロジェクトに組み込む場合は、
 *   doPost 内の action 分岐（'saveMinutes' と既定の会話ログ）を既存の doPost に追加する。
 */

var SPREADSHEET_ID = ''; // 例 '1AbcDEfGhIJkLmNoPqRsTuVwXyZ'。空ならこのスクリプトがバインドされたシート
var TOKEN = '';          // 例 'chishokan-log-2026'。空なら token 検証をしない
// 「報告」の転記先 Google ドキュメント ID（URL の /d/ と /edit の間）
var REPORT_DOC_ID = '1rwSMzzBoJEFUwOMJNPA3rmmGMkarlryCheUGbbNPQik';
// 部門ごとのタブが無い報告を入れる既定タブ（タイトルの部分一致・月ごとに更新可）
var DEFAULT_TAB_HINT = '7月会議内容テスト';

// 「問い合わせQA」が読む小中等部の問合せ管理スプレッドシートID（URL の /d/ と /edit の間）。
// 会議DXの転記先とは別ファイルなので、ここに ID を貼ること。空なら問い合わせQAは動かない。
// ※このシートは生徒・保護者の個人情報を含むため、下の listInquiryBoard_ が
//   氏名をマスクし、電話・住所・保護者名・メールを落としてから返す（アプリ側には渡らない）。
var INQUIRY_BOARD_ID = '';

// 「目標管理」が読む中等部会議議事録スプレッドシートID。
// 目標・実績は下の GOALS_SHEET_NAME のタブにある。空なら目標対比は表示されない。
var GOALS_BOOK_ID = '';
// 目標が載っているタブ名。※位置や順番では探さないこと。
// 旧タブに「このシート内容を『秋～冬行動計画』に移行しました。こちらのシートは削除します。」と
// 注記があり、タブの並びは変わる前提。名前で引く。
var GOALS_SHEET_NAME = '秋～冬行動計画';

// 部門（campus）→ タブ探索キーワード。タブ名にこの文字列が含まれていれば、そのタブに振り分ける。
// ※タブ名が部門名と少し違っても振り分けられるようにするための対応表。タブ名変更時はここを直す。
var TAB_HINTS = {
  '小中等部': '小中等部',
  'RED個別': 'RED個別',
  '高等部': '高等部',
  'LEC': 'LEC',
  '英検': '英検',
  '総務・人事・支援・管理': '総務', // タブ「総務・人事・管理」にも一致するよう短いキーワードで指定
};

// 「中間報告」の転記先タブを探すための設定。
// タブ名に PROGRESS_TAB_KEYWORD（中間報告）と下の部門キーワードの【両方】を含むタブへ振り分ける。
// 例：タブ「小中等部中間報告」＝「小中等部」＋「中間報告」を含むので小中等部の中間報告がここに入る。
// ※該当タブが無い部門は、従来どおり（部門の事前共有タブ→既定タブ）へフォールバックする。
var PROGRESS_TAB_KEYWORD = '中間報告';
var PROGRESS_TAB_HINTS = {
  '小中等部': '小中等部',
  'RED個別': 'RED個別',
  '高等部': '高等部',
  'LEC': 'LEC',
  '英検': '英検',
  '総務・人事・支援・管理': '総務', // タブ「総務人事管理中間報告」に一致
};

function doPost(e) {
  try {
    var data = {};
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }

    if (TOKEN && data.token !== TOKEN) {
      return json_({ ok: false, reason: 'invalid_token' });
    }

    var action = data.action || 'log';

    if (action === 'appendReport') {
      appendReport_(data);
      return json_({ ok: true });
    }

    if (action === 'appendProgress') {
      appendProgress_(data);
      return json_({ ok: true });
    }

    if (action === 'listProgress') {
      return json_(listProgress_(data));
    }

    if (action === 'getProgressItems') {
      return json_(getProgressItems_(data));
    }

    if (action === 'saveProgressItems') {
      return json_(saveProgressItems_(data));
    }

    if (action === 'saveInquiry') {
      return json_(saveInquiry_(data));
    }

    if (action === 'listInquiries') {
      return json_(listInquiries_(data));
    }

    if (action === 'updateInquiryReply') {
      return json_(updateInquiryReply_(data));
    }

    if (action === 'updateInquiry') {
      return json_(updateInquiry_(data));
    }

    if (action === 'saveNumbers') {
      return json_(saveNumbers_(data));
    }

    if (action === 'listNumbers') {
      return json_(listNumbers_(data));
    }

    if (action === 'saveReview') {
      appendRow_(
        '全体会議振り返り',
        ['日時', '事業部', '担当', '内容'],
        [data.ts || nowIso_(), data.campus || '', data.user || '', data.content || '']
      );
      return json_({ ok: true });
    }

    if (action === 'saveSuccess') {
      return json_(saveSuccess_(data));
    }

    if (action === 'listSuccess') {
      return json_(listSuccess_(data));
    }

    if (action === 'listInquiryBoard') {
      return json_(listInquiryBoard_(data));
    }

    if (action === 'listGoals') {
      return json_(listGoals_(data));
    }

    if (action === 'saveDeptMinutes') {
      return json_(saveDeptMinutes_(data));
    }

    if (action === 'listDeptMinutes') {
      return json_(listDeptMinutes_(data));
    }

    if (action === 'listDeptDecisions') {
      return json_(listDeptDecisions_(data));
    }

    if (action === 'saveMinutes') {
      appendRow_(
        '議事録',
        ['日時', '事業部', '担当', '件名', '本文'],
        [data.ts || nowIso_(), data.campus || '', data.user || '', data.title || '', data.content || '']
      );
      return json_({ ok: true });
    }

    // 既定：会話ログ（action:'log'）
    appendRow_(
      '会話ログ',
      ['日時', '事業部', '担当', '入力', '出力'],
      [data.ts || nowIso_(), data.campus || '', data.user || '', data.input || '', data.output || '']
    );
    return json_({ ok: true });

  } catch (err) {
    return json_({ ok: false, reason: String(err) });
  }
}

function doGet() {
  return json_({ ok: true, service: 'chishokan-log', ts: nowIso_() });
}

// 【権限承認用】Apps Script エディタでこの関数を一度「実行」し、
// Googleドキュメントへのアクセス権限（documents スコープ）を承認する。
// 実行すると、対象ドキュメントにテスト用の1件が転記される（確認後は消してよい）。
function testReport() {
  appendReport_({
    campus: 'テスト',
    user: '動作確認',
    ts: new Date().toISOString(),
    content: '（テスト転記）権限承認の確認です。この行は削除して構いません。',
  });
}

var INQUIRY_HEADERS = ['日時', '事業部', '担当', '種別', '内容', '画像URL', '回答', '回答者', '回答日時'];

// 「問い合わせ」シート（ログと同じスプレッドシート内）を取得（無ければ作成）し、見出しを整える。
function inquirySheet_() {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('問い合わせ') || ss.insertSheet('問い合わせ');
  ensureInquiryHeaders_(sh);
  return sh;
}

// 見出し行を9列（回答・回答者・回答日時を含む）に整える。既存シートには不足列を補う。
function ensureInquiryHeaders_(sh) {
  if (sh.getLastRow() === 0) {
    sh.appendRow(INQUIRY_HEADERS);
    return;
  }
  var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  for (var c = 0; c < INQUIRY_HEADERS.length; c++) {
    if (!cur[c]) sh.getRange(1, c + 1).setValue(INQUIRY_HEADERS[c]);
  }
}

// 問い合わせを保存する。画像があれば Drive に保存してリンクを記録する。
function saveInquiry_(data) {
  var imageUrl = '';
  if (data.imageData) {
    try {
      var name = data.imageName || ('inquiry_' + new Date().getTime() + '.jpg');
      var blob = Utilities.newBlob(Utilities.base64Decode(data.imageData), data.imageMime || 'image/jpeg', name);
      var file = inquiryFolder_().createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      imageUrl = file.getUrl();
    } catch (e) {
      imageUrl = '(画像保存エラー: ' + e + ')';
    }
  }
  var sh = inquirySheet_();
  sh.appendRow([data.ts || nowIso_(), data.campus || '', data.user || '', data.category || '', data.content || '', imageUrl, '', '', '']);
  return { ok: true, imageUrl: imageUrl };
}

// 問い合わせ一覧（新しい順・最大300件）を返す。row は回答更新の対象シート行。
function listInquiries_(data) {
  var sh = inquirySheet_();
  if (sh.getLastRow() < 2) return { ok: true, items: [] };
  var values = sh.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    items.push({
      row: i + 1,
      ts: cellStr_(r[0]), campus: String(r[1]), user: String(r[2]),
      category: String(r[3]), content: String(r[4]), imageUrl: String(r[5] || ''),
      reply: String(r[6] || ''), repliedBy: String(r[7] || ''), repliedAt: cellStr_(r[8]),
    });
  }
  items.reverse();
  if (items.length > 300) items = items.slice(0, 300);
  return { ok: true, items: items };
}

// 問い合わせ本人による編集（内容・種別）。行の所有者（事業部＋担当）が一致する場合のみ許可。
function updateInquiry_(data) {
  var sh = inquirySheet_();
  var row = Number(data.row);
  if (!(row >= 2) || row > sh.getLastRow()) return { ok: false, reason: 'bad_row' };
  var rowCampus = String(sh.getRange(row, 2).getValue());
  var rowUser = String(sh.getRange(row, 3).getValue());
  if (rowCampus !== String(data.reqCampus || '') || rowUser !== String(data.reqUser || '')) {
    return { ok: false, reason: 'forbidden' };
  }
  if (data.category != null) sh.getRange(row, 4).setValue(String(data.category));
  if (data.content != null) sh.getRange(row, 5).setValue(String(data.content));
  return { ok: true };
}

// 管理者の回答を該当行に書き込む。
function updateInquiryReply_(data) {
  var sh = inquirySheet_();
  var row = Number(data.row);
  if (!(row >= 2) || row > sh.getLastRow()) return { ok: false, reason: 'bad_row' };
  sh.getRange(row, 7).setValue(String(data.reply || ''));
  sh.getRange(row, 8).setValue(String(data.repliedBy || ''));
  // 文字列として固定（Sheetsの自動日付変換を防ぐ）
  sh.getRange(row, 9).setNumberFormat('@').setValue(nowJp_(''));
  return { ok: true };
}

// 問い合わせ画像の保存先フォルダ（無ければ作成）。
function inquiryFolder_() {
  var name = '会議DX_お問い合わせ画像';
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

// 【権限承認用】Docs と Drive の権限をまとめて承認するために一度実行する。
function authorizeAll() {
  try { DocumentApp.openById(REPORT_DOC_ID).getName(); } catch (e) {}
  try { inquiryFolder_().getName(); } catch (e) {}
}

function appendRow_(sheetName, headers, row) {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  sh.appendRow(row);
}

// 報告を Google ドキュメントへ「新しいセクション（見出し＋改ページ区切り）」として追記する。
// ※ Apps Script では新規「タブ」の作成が未対応のため、見出し付きセクションで代替。
//   タブ付きドキュメントでは最初のタブの本文に書き込む（getBody() の挙動差を吸収）。
function appendReport_(data) {
  var doc = DocumentApp.openById(REPORT_DOC_ID);
  var body = reportBodyForCampus_(doc, data.campus || '');
  // 既に内容があれば改ページで区切る（2件目以降）
  if (body.getText().replace(/\s/g, '').length > 0) {
    body.appendPageBreak();
  }
  var heading = body.appendParagraph((data.campus || '') + '／' + (data.user || '') + '　' + nowJp_(data.ts));
  heading.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  // 貼り付けられた報告を行ごとに段落として追記（改行を保持）
  var lines = String(data.content || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    body.appendParagraph(lines[i]);
  }
  doc.saveAndClose();
}

var PROGRESS_STATUS_HEADERS = ['日時', '事業部', '担当', '内容'];

// 「中間報告状況」シートを取得（無ければ作成）し、見出しを4列（内容を含む）に整える。
// 既存シート（3列で作られたもの）には不足列を補う。
function progressStatusSheet_() {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('中間報告状況') || ss.insertSheet('中間報告状況');
  if (sh.getLastRow() === 0) {
    sh.appendRow(PROGRESS_STATUS_HEADERS);
    return sh;
  }
  var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  for (var c = 0; c < PROGRESS_STATUS_HEADERS.length; c++) {
    if (!cur[c]) sh.getRange(1, c + 1).setValue(PROGRESS_STATUS_HEADERS[c]);
  }
  return sh;
}

// 中間報告を事前共有ドキュメントへ「【中間報告】…」の新セクションとして追記し、
// あわせて「中間報告状況」シートに（日時・事業部・担当）を記録する（ダッシュボード表示用）。
function appendProgress_(data) {
  var doc = DocumentApp.openById(REPORT_DOC_ID);
  var body = progressBodyForCampus_(doc, data.campus || '');
  if (body.getText().replace(/\s/g, '').length > 0) {
    body.appendPageBreak();
  }
  var heading = body.appendParagraph('【中間報告】' + (data.campus || '') + '／' + (data.user || '') + '　' + nowJp_(data.ts));
  heading.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  var lines = String(data.content || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    body.appendParagraph(lines[i]);
  }
  doc.saveAndClose();
  // 直近報告者と本文の記録（ダッシュボードの進捗表示で参照）。
  var sh = progressStatusSheet_();
  sh.appendRow([data.ts || nowIso_(), data.campus || '', data.user || '', String(data.content || '')]);
}

// 中間報告の状況（新しい順・最大100件）を返す。ダッシュボードの提出状況・進捗表示に使う。
// content は報告本文（Next 側で項目と進捗を抜き出して表示する）。
function listProgress_(data) {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('中間報告状況');
  if (!sh || sh.getLastRow() < 2) return { ok: true, items: [] };
  var values = sh.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    items.push({
      ts: cellStr_(r[0]), campus: String(r[1]), user: String(r[2]),
      content: String(r[3] == null ? '' : r[3]),
    });
  }
  items.reverse();
  if (items.length > 100) items = items.slice(0, 100);
  return { ok: true, items: items };
}

// 「数値報告」メニューの入力を「夏期数値」シートへ1行で記録する。
// 見出し（headers）と値（row）は Next 側（lib/summerNumbers.ts）が組み立てて送る。
// 既存シートの見出しが古い場合は、不足分の見出しだけを補う。
function saveNumbers_(data) {
  var headers = data.headers || [];
  var row = data.row || [];
  if (!headers.length) return { ok: false, reason: 'no_headers' };
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('夏期数値') || ss.insertSheet('夏期数値');
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
  } else {
    var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    for (var c = 0; c < headers.length; c++) {
      if (!cur[c]) sh.getRange(1, c + 1).setValue(headers[c]);
    }
  }
  sh.appendRow([data.ts || nowIso_(), data.dept || '', data.campus || '', data.user || ''].concat(row));
  return { ok: true };
}

// 「夏期数値」シートを新しい順（最大200件）に、見出しをキーにした連想配列で返す。
function listNumbers_(data) {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('夏期数値');
  if (!sh || sh.getLastRow() < 2) return { ok: true, items: [] };
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var key = String(headers[c]);
      if (!key) continue;
      obj[key] = c === 0 ? cellStr_(values[i][c]) : String(values[i][c] == null ? '' : values[i][c]);
    }
    items.push(obj);
  }
  items.reverse();
  if (items.length > 200) items = items.slice(0, 200);
  return { ok: true, items: items };
}

var SUCCESS_HEADERS = ['日時', '事業部', '担当', '件名', '取り組み', '結果', '他でも使えるポイント'];

// 夏期結果報告の成功事例を「成功事例」シートへ1件1行で記録する。
// data.cases = [{ title, action, result, point }, ...]（Next 側で報告文から抽出済み）。
function saveSuccess_(data) {
  var cases = data.cases;
  if (!cases || !cases.length) return { ok: true, count: 0 };
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('成功事例') || ss.insertSheet('成功事例');
  if (sh.getLastRow() === 0) sh.appendRow(SUCCESS_HEADERS);
  var ts = data.ts || nowIso_();
  for (var i = 0; i < cases.length; i++) {
    var c = cases[i] || {};
    sh.appendRow([
      ts, data.campus || '', data.user || '',
      c.title || '', c.action || '', c.result || '', c.point || ''
    ]);
  }
  return { ok: true, count: cases.length };
}

// 成功事例（新しい順・最大100件）を返す。ダッシュボードの全社共有パネルで使う。
function listSuccess_(data) {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('成功事例');
  if (!sh || sh.getLastRow() < 2) return { ok: true, items: [] };
  var values = sh.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    items.push({
      ts: cellStr_(r[0]), campus: String(r[1] == null ? '' : r[1]), user: String(r[2] == null ? '' : r[2]),
      title: String(r[3] == null ? '' : r[3]), action: String(r[4] == null ? '' : r[4]),
      result: String(r[5] == null ? '' : r[5]), point: String(r[6] == null ? '' : r[6])
    });
  }
  items.reverse();
  if (items.length > 100) items = items.slice(0, 100);
  return { ok: true, items: items };
}

var DEPT_MINUTES_HEADERS = ['日時', '部門', '入力者', '会議名', '開催日時', '場所', '出席者', '予定議題', '議事録', '会議の質チェック'];
var DEPT_DECISION_HEADERS = ['日時', '部門', '入力者', '会議名', '開催日時', '件名', '内容', '理由・背景', '担当', '期限', '関係部門'];

// 「部門会議議事録」メニューの保存。
//  ・「部門会議議事録」シートに1会議1行（議事録本文と会議の質チェックを丸ごと保存）
//  ・「部門決定事項」シートに1決定1行（部門をまたいで決め事を一覧するためのもと）
// 決定事項の切り出しは Next 側（lib/deptMinutesParse.ts）で済ませて data.decisions に入れて送られてくる。
function saveDeptMinutes_(data) {
  var ts = data.ts || nowIso_();
  appendRow_(
    '部門会議議事録',
    DEPT_MINUTES_HEADERS,
    [
      ts, data.campus || '', data.user || '', data.title || '', data.date || '',
      data.place || '', data.attendees || '', data.agenda || '',
      data.minutes || '', data.quality || ''
    ]
  );

  var decisions = data.decisions || [];
  for (var i = 0; i < decisions.length; i++) {
    var d = decisions[i] || {};
    appendRow_(
      '部門決定事項',
      DEPT_DECISION_HEADERS,
      [
        ts, data.campus || '', data.user || '', data.title || '', data.date || '',
        d.title || '', d.detail || '', d.reason || '', d.owner || '', d.due || '', d.related || ''
      ]
    );
  }
  return { ok: true, decisions: decisions.length };
}

// 部門会議議事録の一覧（新しい順・最大100件）。
function listDeptMinutes_(data) {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('部門会議議事録');
  if (!sh || sh.getLastRow() < 2) return { ok: true, items: [] };
  var values = sh.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    items.push({
      ts: cellStr_(r[0]), campus: String(r[1] == null ? '' : r[1]), user: String(r[2] == null ? '' : r[2]),
      title: String(r[3] == null ? '' : r[3]), date: cellStr_(r[4]), place: String(r[5] == null ? '' : r[5]),
      attendees: String(r[6] == null ? '' : r[6]), agenda: String(r[7] == null ? '' : r[7]),
      minutes: String(r[8] == null ? '' : r[8]), quality: String(r[9] == null ? '' : r[9])
    });
  }
  items.reverse();
  if (items.length > 100) items = items.slice(0, 100);
  return { ok: true, items: items };
}

// 部門横断の決定事項（新しい順・最大200件）。「部門会議議事録」画面の右側に出す。
function listDeptDecisions_(data) {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('部門決定事項');
  if (!sh || sh.getLastRow() < 2) return { ok: true, items: [] };
  var values = sh.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    items.push({
      ts: cellStr_(r[0]), campus: String(r[1] == null ? '' : r[1]), user: String(r[2] == null ? '' : r[2]),
      meeting: String(r[3] == null ? '' : r[3]), date: cellStr_(r[4]),
      title: String(r[5] == null ? '' : r[5]), detail: String(r[6] == null ? '' : r[6]),
      reason: String(r[7] == null ? '' : r[7]), owner: String(r[8] == null ? '' : r[8]),
      due: String(r[9] == null ? '' : r[9]), related: String(r[10] == null ? '' : r[10])
    });
  }
  items.reverse();
  if (items.length > 200) items = items.slice(0, 200);
  return { ok: true, items: items };
}

// 中間報告の「定例項目」を管理するシート（無ければ作成）。
// ★1行＝1項目。A列＝事業部、B列＝項目。同じ事業部の項目は複数行に並べる（手動編集しやすい形）。
//   例）
//     事業部        | 項目
//     小中等部      | 会議で決議した事項の進捗
//     小中等部      | 生徒数（在籍・前年比）
//     高等部        | 学年別の実質受講率
//   ※ここに書いた項目が、この順番・この表記のまま AI の質問になります（コード側で足す固定項目はありません）。
//     「会議で決議した事項の進捗」も尋ねたい場合は、その部門の1行目に書いてください。
function progressItemsSheet_() {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('中間報告項目') || ss.insertSheet('中間報告項目');
  if (sh.getLastRow() === 0) sh.appendRow(['事業部', '項目']);
  return sh;
}

// 保存済みの定例項目を { campus: [項目, ...] } の形で返す（1行1項目を部門ごとにまとめる）。
// 未登録の部門は含めない（＝Next 側で初期値を使う）。
function getProgressItems_(data) {
  var sh = progressItemsSheet_();
  var map = {};
  if (sh.getLastRow() >= 2) {
    var values = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < values.length; i++) {
      var campus = String(values[i][0]).trim();
      var item = String(values[i][1] == null ? '' : values[i][1]).trim();
      if (!campus || !item) continue;
      if (!map[campus]) map[campus] = [];
      map[campus].push(item);
    }
  }
  return { ok: true, items: map };
}

// 指定部門の定例項目を保存する（アプリの編集画面から呼ばれる）。
// その部門の既存行をすべて外し、渡された項目を1行1項目で入れ直す（他部門はそのまま）。権限確認は Next 側で実施。
function saveProgressItems_(data) {
  var campus = String(data.campus || '').trim();
  if (!campus) return { ok: false, reason: 'bad_campus' };
  var items = Array.isArray(data.items) ? data.items : String(data.items || '').split('\n');
  var cleaned = [];
  for (var i = 0; i < items.length; i++) {
    var s = String(items[i]).trim();
    if (s) cleaned.push(s);
  }
  var sh = progressItemsSheet_();
  var last = sh.getLastRow();
  var kept = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var r = 0; r < vals.length; r++) {
      var c = String(vals[r][0]).trim();
      var it = String(vals[r][1] == null ? '' : vals[r][1]).trim();
      if (!c || !it) continue;            // 空行は捨てる
      if (c === campus) continue;         // 対象部門の旧行は捨てる（入れ直す）
      kept.push([c, it]);
    }
  }
  for (var k = 0; k < cleaned.length; k++) kept.push([campus, cleaned[k]]);
  // データ領域をクリアして書き直す
  if (last >= 2) sh.getRange(2, 1, last - 1, 2).clearContent();
  if (kept.length) sh.getRange(2, 1, kept.length, 2).setValues(kept);
  return { ok: true, items: cleaned };
}

// 【初期値の流し込み】GAS エディタでこの関数を一度「実行」すると、
// 「中間報告項目」シートに全部門の初期項目（1行1項目）を書き込む。
// 既に何か入っている部門は上書きしない（手動編集を尊重）。以後はシート／アプリ画面のどちらでも編集可。
function seedProgressItems() {
  var defaults = [
    ['小中等部', ['会議で決議した事項の進捗', '生徒数（在籍・前年比）', '成績回収（○/○名）', 'キャンペーン（○/○名）']],
    ['RED個別', ['会議で決議した事項の進捗', 'スタッフ研修項目の完了／未完（件数）', '生徒対応・退会防止の状況']],
    ['高等部', ['会議で決議した事項の進捗', '学年別の実質受講率', '受講進捗（コマ数の進み・修了／遅れ）', '担任・担任助手の面談実施状況', '新規（申込・体験）の申込／実施']],
    ['LEC', ['会議で決議した事項の進捗', '生徒数（在籍・前年比）', '売上', '成績回収（○/○名）', 'キャンペーン（○/○名）']],
    ['英検', ['会議で決議した事項の進捗', '受験申込・受験者数', '合格状況', '成績回収（○/○名）']],
    ['総務・人事・支援・管理', ['会議で決議した事項の進捗', '担当領域の処理・対応件数', '進行中タスク・依頼案件の進捗']]
  ];
  var existing = getProgressItems_({}).items || {};
  var sh = progressItemsSheet_();
  var added = [];
  for (var i = 0; i < defaults.length; i++) {
    var campus = defaults[i][0];
    if (existing[campus] && existing[campus].length) continue; // 既存は触らない
    var list = defaults[i][1];
    for (var j = 0; j < list.length; j++) added.push([campus, list[j]]);
  }
  if (added.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, added.length, 2).setValues(added);
  }
}

// 部門名でタブを振り分ける（事前報告用）：
//  1) タイトルに部門名（campus）を含むタブ。※「中間報告」タブは対象外（タブ順が変わっても誤爆しないため）
//  2) 既定タブ（DEFAULT_TAB_HINT を含むタブ）
//  3) 先頭タブ
//  4) タブ非対応なら通常の本文
function reportBodyForCampus_(doc, campus) {
  try {
    if (typeof doc.getTabs === 'function') {
      var tabs = doc.getTabs();
      if (tabs && tabs.length > 0) {
        if (campus) {
          var hint = TAB_HINTS[campus] || campus;
          var hit = findTabByTitle_(tabs, hint, PROGRESS_TAB_KEYWORD);
          if (hit) return hit.asDocumentTab().getBody();
        }
        var def = findTabByTitle_(tabs, DEFAULT_TAB_HINT);
        if (def) return def.asDocumentTab().getBody();
        return tabs[0].asDocumentTab().getBody();
      }
    }
  } catch (e) {
    // タブ非対応環境では通常の本文にフォールバック
  }
  return doc.getBody();
}

// 「中間報告」の転記先タブを決める：
//  1) タイトルに「中間報告」と部門キーワードの両方を含むタブ（例：小中等部中間報告）
//  2) 見つからなければ従来の振り分け（部門の事前共有タブ→既定タブ→先頭タブ→通常の本文）
function progressBodyForCampus_(doc, campus) {
  try {
    if (typeof doc.getTabs === 'function') {
      var tabs = doc.getTabs();
      if (tabs && tabs.length > 0 && campus) {
        var hint = PROGRESS_TAB_HINTS[campus] || campus;
        var hit = findTabByAllTitles_(tabs, [hint, PROGRESS_TAB_KEYWORD]);
        if (hit) return hit.asDocumentTab().getBody();
      }
    }
  } catch (e) {
    // タブ非対応環境では下のフォールバックへ
  }
  return reportBodyForCampus_(doc, campus);
}

// タイトルに needles の【すべて】を含む最初のタブを返す（子タブも探索）。
function findTabByAllTitles_(tabs, needles) {
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    var title = '';
    try { title = t.getTitle(); } catch (e) {}
    if (title) {
      var all = true;
      for (var n = 0; n < needles.length; n++) {
        if (!needles[n] || title.indexOf(needles[n]) === -1) { all = false; break; }
      }
      if (all) return t;
    }
    try {
      var kids = t.getChildTabs ? t.getChildTabs() : null;
      if (kids && kids.length) {
        var f = findTabByAllTitles_(kids, needles);
        if (f) return f;
      }
    } catch (e) {}
  }
  return null;
}

// タイトルに hint を含む最初のタブを返す（子タブも探索）。
// exclude を渡すと、その文字列を含むタブは除外する（例：事前報告の検索で「中間報告」タブを避ける）。
function findTabByTitle_(tabs, hint, exclude) {
  if (!hint) return null;
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    var title = '';
    try { title = t.getTitle(); } catch (e) {}
    if (title && title.indexOf(hint) !== -1 && !(exclude && title.indexOf(exclude) !== -1)) return t;
    try {
      var kids = t.getChildTabs ? t.getChildTabs() : null;
      if (kids && kids.length) {
        var f = findTabByTitle_(kids, hint, exclude);
        if (f) return f;
      }
    } catch (e) {}
  }
  return null;
}


// ===== 問い合わせQA（小中等部問合せ管理） =====================================
// 校舎ごとのシートを読み、AIが答えるのに必要な列だけを返す。
// 個人情報（電話・住所・郵便番号・保護者名・メール・ふりがな）は返さず、
// 生徒氏名は1文字目＋「○」にマスクする。校舎名＋No. で元シートを引けるようにしてある。

// 返す列（この順・見出しの完全一致で拾う）
var INQUIRY_COLUMNS = [
  'No.', '日付', '生徒氏名', '学校名', '学年', '媒体', '受講期', '連絡',
  '体験日', '体験', '入塾提案面談日', '本人OK', 'クローズ予定日', '結果',
];
// 備考は見出しが長い（「備考(架電日時・検討中理由・見送り理由・その他補足事項)」）ので前方一致で拾う。
var INQUIRY_NOTE_PREFIX = '備考';
// 備考の最大文字数（プロンプトが膨らむのを防ぐ）
var INQUIRY_NOTE_MAX = 200;
// 1回に返す最大行数
var INQUIRY_MAX_ROWS = 500;
// ヘッダー行を探す深さ（シート上部に結合セルの見出しが数行あるため）
var INQUIRY_HEADER_SCAN = 20;

// 備考に混ざる問い合わせフォームの定型文を落とす。
// 「個人情報保護方針：…」以降は全件同じ文面で、200字の枠を食いつぶして
// 肝心の検討中理由・見送り理由が切られてしまうため。
var INQUIRY_NOTE_CUTS = ['個人情報保護方針：', '個人情報保護方針:', '-- このメールは', '--　このメールは'];

function cleanNote_(s) {
  var t = String(s == null ? '' : s).replace(/[\r\n]+/g, ' ');
  for (var i = 0; i < INQUIRY_NOTE_CUTS.length; i++) {
    var at = t.indexOf(INQUIRY_NOTE_CUTS[i]);
    if (at !== -1) t = t.slice(0, at);
  }
  return t.replace(/[\s　]+/g, ' ').trim();
}

// 氏名を「佐藤友次朗」→「佐○」にする。空欄はそのまま空欄。
function maskName_(v) {
  var s = String(v == null ? '' : v).replace(/[\s　]/g, '');
  if (!s) return '';
  return s.charAt(0) + '○';
}

// 見出し行を探す。問合せ管理の本体シートは「生徒氏名」と「結果」を必ず持つ。
// 転記ログなど別用途のシートを巻き込まないための判定でもある。
function findInquiryHeader_(values) {
  var limit = Math.min(values.length, INQUIRY_HEADER_SCAN);
  for (var r = 0; r < limit; r++) {
    var row = values[r];
    var hasName = false;
    var hasResult = false;
    for (var c = 0; c < row.length; c++) {
      var h = String(row[c] == null ? '' : row[c]).replace(/[\s　]/g, '');
      if (h === '生徒氏名') hasName = true;
      if (h === '結果') hasResult = true;
    }
    if (hasName && hasResult) return r;
  }
  return -1;
}

function listInquiryBoard_(data) {
  if (!INQUIRY_BOARD_ID) return { ok: false, reason: 'board_not_configured', items: [] };

  var ss;
  try {
    ss = SpreadsheetApp.openById(INQUIRY_BOARD_ID);
  } catch (err) {
    return { ok: false, reason: 'board_open_failed', items: [] };
  }

  var sheets = ss.getSheets();
  var items = [];
  var campuses = [];

  for (var si = 0; si < sheets.length; si++) {
    var sh = sheets[si];
    if (sh.isSheetHidden && sh.isSheetHidden()) continue;
    if (sh.getLastRow() < 2) continue;

    var values = sh.getDataRange().getValues();
    var hr = findInquiryHeader_(values);
    if (hr === -1) continue; // 本体シートではない（転記ログ・集計シート等）

    var campus = String(sh.getName()).replace(/[\s　]/g, '');
    campuses.push(campus);

    // 見出し → 列番号。同じ見出しが複数あるときは左側を優先する。
    var headers = values[hr];
    var colOf = {};
    var noteCol = -1;
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c] == null ? '' : headers[c]).replace(/[\s　]/g, '');
      if (!h) continue;
      if (colOf[h] === undefined) colOf[h] = c;
      if (noteCol === -1 && h.indexOf(INQUIRY_NOTE_PREFIX) === 0) noteCol = c;
    }

    for (var r = hr + 1; r < values.length; r++) {
      if (items.length >= INQUIRY_MAX_ROWS) break;
      var row = values[r];

      var obj = { '校舎': campus };
      var filled = 0;
      for (var k = 0; k < INQUIRY_COLUMNS.length; k++) {
        var key = INQUIRY_COLUMNS[k];
        var idx = colOf[key];
        var val = idx === undefined ? '' : cellStr_(row[idx]);
        if (key === '生徒氏名') val = maskName_(val);
        obj[key] = val;
        if (val) filled++;
      }

      var note = noteCol === -1 ? '' : cleanNote_(cellStr_(row[noteCol]));
      if (note.length > INQUIRY_NOTE_MAX) note = note.slice(0, INQUIRY_NOTE_MAX) + '…';
      obj['備考'] = note;
      if (note) filled++;

      // 日付も氏名も無い行は空行・小計行とみなして捨てる。
      if (!obj['日付'] && !obj['生徒氏名']) continue;
      // 動作確認用のテスト行を除く。
      if (obj['生徒氏名'].indexOf('テ') === 0 && (note.indexOf('テスト') !== -1)) continue;
      if (filled < 2) continue;

      items.push(obj);
    }
  }

  return { ok: true, items: items, campuses: campuses, fetchedAt: nowJp_() };
}


// ===== 目標管理（秋～冬行動計画） ==========================================
// 「9月 の営業サマリー（4校舎合計）」ブロックを月ごとに読む。構造は
//   （月行）   9月 の営業サマリー（4校舎合計）
//   （指標行）           今月入会 | サイトク前期外部受講者 | 体験授業 | 10/18一斉模試
//   （小見出し）         目標 実績 | 目標 実績 | 目標 実績 | 目標 実績 | 主なトピック
//   （校舎行）  中等部 |  43  33  |  10   1  |  19   3  |  17   2  | ...
//              日野校 |  15  13  | ...
// 指標名は月によって変わる（「10/18一斉模試」など日付入り）ため、見出しから読み取る。

// 目標の対象となる行（この名前の行だけを拾う）
var GOALS_ROW_NAMES = ['中等部', '日野校', '駅前校', '大野校', '日宇校', '県中'];

function normCell_(v) {
  return String(v == null ? '' : v).replace(/[\s　]/g, '');
}

// 「9月 の営業サマリー」から月を取り出す。取れなければ null。
// ※「営業サマリー」の文字は結合セルの先頭にしか入らないことがあるので、
//   隣のセルだけでなく行全体を見る。ここを取りこぼすと、次の月のブロックが
//   前の月に混ざって同じ指標が二重に出る。
function goalsMonthOf_(row) {
  // 「営業サマリー」の文字は結合セルの先頭にしか入らず、行によっては取れない。
  // 見出しの体裁に頼らず、左端付近に「N月」だけのセルがあれば月の切り替わりとみなす。
  // ここを取りこぼすと次の月のブロックが前の月に混ざり、同じ指標が二重に出る。
  for (var c = 0; c < Math.min(row.length, 6); c++) {
    var a = normCell_(row[c]);
    if (/^\d{1,2}月$/.test(a)) return parseInt(a, 10);
    var m = /^(\d{1,2})月の/.exec(a);
    if (m && a.indexOf('営業サマリー') !== -1) return parseInt(m[1], 10);
  }
  return null;
}

// 「目標」「実績」が並ぶ行から、列 → {指標, 種別} の対応を作る。
//
// ★指標名のセルは「目標」「実績」の2列にまたがって結合されている。
//   getValues() は結合セルの先頭にしか値を返さない（2列目は空文字）ため、
//   真上だけを見ると「実績」列の指標名が取れず、実績がすべて欠落する。
//   そこで左から順に見て、直前に見つけた指標名を繰り越す（結合の見え方に合わせる）。
function goalsColumnMap_(values, labelRow) {
  var map = {};
  var row = values[labelRow];

  // 指標名の候補を1〜3行上から拾う。
  // ★繰り越しは「1列だけ」にする。指標名は『目標』『実績』の2列分しか結合されていないので、
  //   右端まで流すと無関係な列（主なトピック等）に指標が割り当たり、
  //   「サイトク 0/—」「1010/—」のような出鱈目な対比が出る。
  var metricAt = [];
  var carry = '';
  var carryLeft = 0; // あと何列まで繰り越してよいか
  for (var c = 0; c < row.length; c++) {
    var found = '';
    for (var up = 1; up <= 3 && labelRow - up >= 0; up++) {
      var upRow = values[labelRow - up];
      var cand = String(upRow[c] == null ? '' : upRow[c]).trim();
      var n = normCell_(cand);
      if (n && n !== '目標' && n !== '実績' && n !== '主なトピック' && n.indexOf('営業サマリー') === -1) {
        found = cand;
        break;
      }
    }
    if (found) {
      carry = found;
      carryLeft = 1; // 自分＋次の1列（目標・実績の対）まで
      metricAt[c] = carry;
    } else if (carryLeft > 0) {
      metricAt[c] = carry;
      carryLeft--;
    } else {
      metricAt[c] = '';
    }
  }

  // 「目標」「実績」が現れる範囲の外まで繰り越さないよう、その範囲だけを対象にする。
  var first = -1;
  var last = -1;
  for (var c2 = 0; c2 < row.length; c2++) {
    var k = normCell_(row[c2]);
    if (k === '目標' || k === '実績') {
      if (first === -1) first = c2;
      last = c2;
    }
  }
  if (first === -1) return map;

  for (var c3 = first; c3 <= last; c3++) {
    var kind = normCell_(row[c3]);
    if (kind !== '目標' && kind !== '実績') continue;
    if (metricAt[c3]) map[c3] = { metric: metricAt[c3], kind: kind };
  }
  return map;
}

function listGoals_(data) {
  if (!GOALS_BOOK_ID) return { ok: false, reason: 'goals_not_configured', items: [] };

  var ss;
  try {
    ss = SpreadsheetApp.openById(GOALS_BOOK_ID);
  } catch (err) {
    return { ok: false, reason: 'goals_open_failed', items: [] };
  }

  // タブ名で引く（並び順に依存しない）。完全一致が無ければ部分一致で探す。
  var sh = ss.getSheetByName(GOALS_SHEET_NAME);
  if (!sh) {
    var all = ss.getSheets();
    for (var i = 0; i < all.length; i++) {
      if (normCell_(all[i].getName()).indexOf(normCell_(GOALS_SHEET_NAME)) !== -1) {
        sh = all[i];
        break;
      }
    }
  }
  if (!sh) return { ok: false, reason: 'goals_sheet_not_found', items: [] };

  var values = sh.getDataRange().getValues();
  var items = [];
  var seen = {};
  var month = null;
  var colMap = null;

  for (var r = 0; r < values.length; r++) {
    var row = values[r];

    var m = goalsMonthOf_(row);
    if (m) {
      month = m;
      colMap = null; // 月が変われば指標の並びも取り直す
      continue;
    }
    if (!month) continue;

    // 「目標／実績」の見出し行を見つけたら列対応を作る
    var hasKind = false;
    for (var c0 = 0; c0 < row.length; c0++) {
      var n0 = normCell_(row[c0]);
      if (n0 === '目標' || n0 === '実績') { hasKind = true; break; }
    }
    if (hasKind) {
      colMap = goalsColumnMap_(values, r);
      continue;
    }
    if (!colMap) continue;

    // 校舎行を拾う（行名は先頭3列のどこかに入っている）
    var rowName = '';
    for (var c1 = 0; c1 < Math.min(row.length, 4); c1++) {
      var cand = normCell_(row[c1]);
      if (GOALS_ROW_NAMES.indexOf(cand) !== -1) { rowName = cand; break; }
    }
    if (!rowName) continue;

    // 指標ごとに 目標／実績 をまとめる
    var byMetric = {};
    for (var key in colMap) {
      var col = Number(key);
      if (col >= row.length) continue;
      var raw = row[col];
      if (raw === '' || raw === null) continue;
      var num = Number(String(raw).replace(/[^\d.-]/g, ''));
      if (isNaN(num)) continue;
      var info = colMap[key];
      if (!byMetric[info.metric]) byMetric[info.metric] = {};
      byMetric[info.metric][info.kind === '目標' ? 'target' : 'actual'] = num;
    }

    for (var metric in byMetric) {
      // 同じ月・校舎・指標が二度出たら先に読めた方を残す（ブロックの取りこぼしに対する保険）。
      var dupKey = month + '|' + rowName + '|' + metric;
      if (seen[dupKey]) continue;
      seen[dupKey] = true;
      items.push({
        month: month,
        campus: rowName,
        metric: metric,
        target: byMetric[metric].target == null ? null : byMetric[metric].target,
        actual: byMetric[metric].actual == null ? null : byMetric[metric].actual,
      });
    }
  }

  return { ok: true, items: items, sheet: sh.getName(), fetchedAt: nowJp_() };
}

// セル値を文字列化。Date型（Sheetsが自動変換した場合）は日本時間の見やすい形式に整える。
function cellStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  return String(v == null ? '' : v);
}

function nowJp_(ts) {
  var d = ts ? new Date(ts) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

function nowIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
