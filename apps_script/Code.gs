/**
 * 智翔館 会議DX — ログ転記用 Apps Script（Web アプリ）
 * -------------------------------------------------------
 * アプリ（Vercel）から送られる以下を Google へ転記する。
 *   - action:'log'          … 会議AI / 議事録の会話ログ → スプレッドシート「会話ログ」
 *   - action:'saveMinutes'  … 議事録スレッドの保存       → スプレッドシート「議事録」
 *   - action:'appendReport' … 「報告」からの事前報告      → Google ドキュメント（REPORT_DOC_ID）に新セクション追記
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

    if (action === 'saveInquiry') {
      return json_(saveInquiry_(data));
    }

    if (action === 'listInquiries') {
      return json_(listInquiries_(data));
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
  appendRow_(
    '問い合わせ',
    ['日時', '事業部', '担当', '種別', '内容', '画像URL'],
    [data.ts || nowIso_(), data.campus || '', data.user || '', data.category || '', data.content || '', imageUrl]
  );
  return { ok: true, imageUrl: imageUrl };
}

// 問い合わせ一覧（新しい順・最大300件）を返す。
function listInquiries_(data) {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('問い合わせ');
  if (!sh || sh.getLastRow() < 2) return { ok: true, items: [] };
  var values = sh.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    items.push({
      ts: String(r[0]), campus: String(r[1]), user: String(r[2]),
      category: String(r[3]), content: String(r[4]), imageUrl: String(r[5] || ''),
    });
  }
  items.reverse();
  if (items.length > 300) items = items.slice(0, 300);
  return { ok: true, items: items };
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
