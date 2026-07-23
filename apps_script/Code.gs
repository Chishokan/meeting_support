/**
 * 智翔館 会議DX — ログ転記用 Apps Script（Web アプリ）
 * -------------------------------------------------------
 * アプリ（Vercel）から送られる以下を Google へ転記する。
 *   - action:'log'          … 会議AI / 議事録の会話ログ → スプレッドシート「会話ログ」
 *   - action:'saveMinutes'  … 議事録スレッドの保存       → スプレッドシート「議事録」
 *   - action:'appendReport' … 「報告」からの事前報告      → Google ドキュメント（REPORT_DOC_ID）に新セクション追記
 *   - action:'appendProgress' … 「中間報告」の進捗報告     → 同ドキュメントに「【中間報告】…」で追記＋「中間報告状況」シートに記録
 *   - action:'listProgress' … ダッシュボード用の直近報告者  → 「中間報告状況」シートを新しい順に返す
 *   - action:'getProgressItems'/'saveProgressItems' … 中間報告の定例項目の取得・保存 → 「中間報告項目」シート
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

var PROGRESS_STATUS_HEADERS = ['日時', '事業部', '担当'];

// 中間報告を事前共有ドキュメントへ「【中間報告】…」の新セクションとして追記し、
// あわせて「中間報告状況」シートに（日時・事業部・担当）を記録する（ダッシュボード表示用）。
function appendProgress_(data) {
  var doc = DocumentApp.openById(REPORT_DOC_ID);
  var body = reportBodyForCampus_(doc, data.campus || '');
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
  // 直近報告者の記録（ダッシュボードで参照）。
  appendRow_('中間報告状況', PROGRESS_STATUS_HEADERS, [data.ts || nowIso_(), data.campus || '', data.user || '']);
}

// 中間報告の状況（新しい順・最大100件）を返す。ダッシュボードの「直近の中間報告」表示に使う。
function listProgress_(data) {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('中間報告状況');
  if (!sh || sh.getLastRow() < 2) return { ok: true, items: [] };
  var values = sh.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    items.push({ ts: cellStr_(r[0]), campus: String(r[1]), user: String(r[2]) });
  }
  items.reverse();
  if (items.length > 100) items = items.slice(0, 100);
  return { ok: true, items: items };
}

// 中間報告の「定例項目」を部門ごとに保存するシート（無ければ作成）。
// 1部門1行、項目は改行区切りで1セルに保存する。
function progressItemsSheet_() {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('中間報告項目') || ss.insertSheet('中間報告項目');
  if (sh.getLastRow() === 0) sh.appendRow(['事業部', '定例項目']);
  return sh;
}

// 保存済みの定例項目を { campus: [項目, ...] } の形で返す（未保存の部門は含めない＝Next 側で初期値を使う）。
function getProgressItems_(data) {
  var sh = progressItemsSheet_();
  var map = {};
  if (sh.getLastRow() >= 2) {
    var values = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < values.length; i++) {
      var campus = String(values[i][0]).trim();
      if (!campus) continue;
      var items = String(values[i][1] || '')
        .split('\n')
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s.length > 0; });
      map[campus] = items;
    }
  }
  return { ok: true, items: map };
}

// 指定部門の定例項目を保存（該当行を上書き、無ければ追加）。権限確認は Next 側で実施。
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
  var joined = cleaned.join('\n');
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var col = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var r = 0; r < col.length; r++) {
      if (String(col[r][0]).trim() === campus) {
        sh.getRange(r + 2, 2).setValue(joined);
        return { ok: true, items: cleaned };
      }
    }
  }
  sh.appendRow([campus, joined]);
  return { ok: true, items: cleaned };
}

// 部門名でタブを振り分ける：
//  1) タイトルに部門名（campus）を含むタブ
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
          var hit = findTabByTitle_(tabs, hint);
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

// タイトルに hint を含む最初のタブを返す（子タブも探索）。
function findTabByTitle_(tabs, hint) {
  if (!hint) return null;
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    var title = '';
    try { title = t.getTitle(); } catch (e) {}
    if (title && title.indexOf(hint) !== -1) return t;
    try {
      var kids = t.getChildTabs ? t.getChildTabs() : null;
      if (kids && kids.length) {
        var f = findTabByTitle_(kids, hint);
        if (f) return f;
      }
    } catch (e) {}
  }
  return null;
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
