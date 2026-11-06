/**
 * 智翔館 会議DX — ログ転記用 Apps Script（Web アプリ）
 * -------------------------------------------------------
 * アプリ（Vercel）から送られる以下を Google へ転記する。
 *   - action:'log'          … 会議AI / 議事録の会話ログ → スプレッドシート「会話ログ」
 *   - action:'saveMinutes'  … 議事録スレッドの保存       → スプレッドシート「議事録」
 *   - action:'saveShareItems'  … 「報告」転記時の協議・決裁・報告 → 「事前共有事項」シートに1件1行
 *   - action:'listShareItems'  … ダッシュボードの事前共有事項カード用の一覧
 *   - action:'saveDeptMinutes' … 「部門会議議事録」の保存 → 「部門会議議事録」シートに1会議1行＋
 *                                                          「部門決定事項」シートに1決定1行
 *   - action:'listDeptMinutes' … 部門会議議事録の一覧
 *   - action:'listDeptDecisions' … 部門横断の決定事項一覧（決め事の見える化）
 *   - action:'saveDeptPreshare' … 部門会議の事前共有（会議情報と議題・レジュメ） → 「部門会議事前共有」シートに1会議1行
 *   - action:'listDeptPreshare' … ダッシュボードの「部門会議の事前共有」用の一覧
 *   - action:'appendReport' … 「報告」からの事前報告      → Google ドキュメント（REPORT_DOC_ID）に新セクション追記
 *   - action:'appendProgress' … 「中間報告」の進捗報告     → 同ドキュメントの【中間報告タブ】に追記＋「中間報告状況」シートに記録
 *   - action:'listProgress' … ダッシュボード用の直近報告者  → 「中間報告状況」シートを新しい順に返す
 *   - action:'getProgressItems'/'saveProgressItems' … 中間報告の定例項目の取得・保存 → 「中間報告項目」シート（1行1項目）
 *   - action:'saveNumberReport'  … 「数値報告」メニューの入力 → 月次は「月次数値」、講習期（春期・夏期・冬期）は「講習数値」シートに1行で記録
 *                                   （対象期間×校舎ごと・送り直すと追記。会議AI側は最新の1件を使う）
 *   - action:'listNumberReports' … 会議AI・数値報告画面での参照 → 指定シート（月次数値／講習数値）を新しい順に返す
 *     ※ 旧「夏期数値」シート（2026年夏まで）はそのまま残してある。読み書きはしない。
 *   - action:'saveReview'   … 「全体会議振り返り」の入力      → 「全体会議振り返り」シートに1行で記録
 *   - action:'saveTaskReport' … 「重要タスク報告」（小中等部の週次）→ 「重要タスク報告」シートに1件1行（出し直すと追記）
 *   - action:'getTaskEvaluation' … AI壁打ち用。重要タスク評価シート（TASK_EVAL_BOOK_ID）の校舎タブ（A〜G列）を表示値のまま返す
 *   - action:'appendPlanActions' … AI壁打ちの行動計画の案を、秋～冬行動計画（GOALS_BOOK_ID）の「校舎×区分×日付」のセルに
 *                                   「★行動」として書き足す（今ある文は消さない）＋「AI壁打ち書き込み」シートに記録
 *   - action:'saveSuccess'  … 月次・講習結果報告の成功事例       → 「成功事例」シートに1件1行で記録（「報告」転記時に自動）
 *   - action:'listSuccess'  … ダッシュボード用の成功事例一覧  → 「成功事例」シートを新しい順に返す
 *   - action:'listInquiryBoard' … 問い合わせQA用の小中等部問合せ管理 → 「問合せ台帳」（下記）を優先し、無ければ旧スプレッドシート（INQUIRY_BOARD_ID）を校舎シートごとに読む。いずれも個人情報を落として返す
 *   - action:'listInquiryRecords' / 'saveInquiryRecord' / 'deleteInquiryRecord'
 *                               … 問合せ管理 Web アプリ（/inquiry-board）の台帳 → スプレッドシート「問合せ台帳」（INQUIRY_DB_ID）に1件1行
 *     ※ 旧スプレッドシートの行を台帳へ移すときは、GAS エディタで importLegacyInquiryBoard() を一度実行する（何度実行しても二重登録しない）。
 *   - action:'getKenshuAnswer' / 'saveKenshuAnswer'
 *                               … 全体研修会アンケート（/kenshu）→ 「研修会アンケート」シートに1人1行（研修会×部門×氏名）。送り直すと上書き
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

// 問合せ管理 Web アプリ（/inquiry-board）の台帳スプレッドシートID。
// 生徒・保護者の個人情報を1件1行で持つので、会話ログの転記先とは別ファイルにすることを勧める
//（別ファイルにすると、閲覧できる人をそのファイルの共有設定だけで絞れる）。
// 空ならこのスクリプトがバインドされたシート（SPREADSHEET_ID と同じ扱い）に「問合せ台帳」タブを作る。
var INQUIRY_DB_ID = '';
var INQUIRY_DB_SHEET = '問合せ台帳';
// 台帳の列（この順で1行）。★lib/inquiryRecords.ts の RECORD_FIELDS と同じ順に保つこと。
// 末尾の「削除」は Web アプリからは見えない列で、削除した行に 1 を立てる（行そのものは消さない）。
var INQUIRY_DB_HEADERS = [
  'ID', '校舎', 'No.', '日付', '生徒氏名', 'ふりがな', '学校名', '学年', '電話番号', '媒体', '紹介者', '受講期',
  '連絡', '体験日', '体験', '入塾提案面談日', '本人OK', 'クローズ予定日', '結果', '入塾日', '備考',
  '保護者名', '郵便番号', '住所', 'メールアドレス', 'DM', '受付ID', '作成日時', '作成者', '更新日時', '更新者', '削除',
];
// 「今日の注意点」の AI の一言を日付×対象で残すタブ（台帳と同じスプレッドシートに作る）。
// 1日1回まとめて生成し、その日は書き換えない。個人情報は入らない（氏名は「田○」にマスク済み）。
var AI_NOTES_SHEET = 'AI注意点';
var AI_NOTES_HEADERS = ['日付', '対象', '本文', '生成日時'];
var AI_NOTES_KEEP_DAYS = 90;

// 「目標管理」が読む中等部会議議事録スプレッドシートID。
// 目標・実績は下の GOALS_SHEET_NAME のタブにある。空なら目標対比は表示されない。
var GOALS_BOOK_ID = '';
// 目標が載っているタブ名。※位置や順番では探さないこと。
// 旧タブに「このシート内容を『秋～冬行動計画』に移行しました。こちらのシートは削除します。」と
// 注記があり、タブの並びは変わる前提。名前で引く。
var GOALS_SHEET_NAME = '秋～冬行動計画';

// 「AI壁打ち」が読む重要タスク評価シートのID（URL の /d/ と /edit の間）。校舎ごとのタブ（日野校・駅前校…）を読む。
// 毎週の評価を別のファイルで作ったときは、ここを新しいファイルのIDに変えて再デプロイする。
var TASK_EVAL_BOOK_ID = '1lDWFQSOIHY18UbOB2XYokRgI_jCzPKA7sOX_O7NqQXk';
// 評価シートのタブ名＝秋～冬行動計画の校舎の行の名前。★lib/taskCoach.ts の COACH_SCHOOLS と同じにする。
var TASK_COACH_SCHOOLS = ['日野校', '駅前校', '大野校', '日宇校'];
var PLAN_LOG_SHEET = 'AI壁打ち書き込み';

// 智翔館AI（/ai）が、職員の貼った Google ドライブのリンクから読んでよいフォルダ（フォルダID）。
// ★ここに入れたフォルダと、その下のフォルダにあるファイルだけを読む。空なら何も読まない。
//   名簿・成績・給与・人事のフォルダは入れないこと（このスクリプトは持ち主の権限で読むため、
//   リンクさえ分かれば誰でも読めてしまう）。例：['1rDTV-Lg3YJmZHMSTfHs-ErDnpR3lhR_x'] // 05_広告制作
var AI_READ_FOLDER_IDS = [
  '1rDTV-Lg3YJmZHMSTfHs-ErDnpR3lhR_x', // 05_広告制作
  '1b7qfB8Ey-fkFxm7XMFtbkoARyuiKmzoz', // 10_研修会議
  '1x3qb8GA-rBxV3DoTmH00s4efJHn3GBKD'  // 04_講習
];
// 入れていないフォルダ（2026-11-04 確認）：00_進行中（要対応生徒リスト・成果配分案がある）、03_模試テスト（模試の入力シート・
// 生徒ランキング・受検票・進学希望者一覧がある）、07_名簿成績出席、11_総務、総会（目標シート・プライベートのやりたいこと一覧がある）
// フォルダの指定に関係なく読まないファイル名（念のための二重の歯止め）。
var AI_READ_BLOCK_WORDS = ['名簿', '成績', '個票', '給与', '賞与', '成果配分', '人事評価', '健康', 'パスワード', 'password',
  '宛名', '住所', '目標シート', 'プライベート', '（回答）', '(回答)', '入力シート', '受検票', 'ランキング', '生徒リスト',
  '進学希望者', '出席', '面談'];

// 智翔館AI が作った Google ドキュメントの保存先。この下に「AI作成」フォルダを作って入れる。
var AI_OUTPUT_PARENT_ID = '16VRA3zstFpsKGKc2UsFXAuP75lNXlcCm'; // 00_進行中
var AI_OUTPUT_FOLDER_NAME = 'AI作成';
// 作った文書の共有：'view'＝リンクを知っている人が閲覧可（初期値）、'edit'＝リンクを知っている人が編集可、'none'＝共有しない
var AI_OUTPUT_SHARING = 'view';
// 1ファイルで返す上限（文字数・Office/PDF の大きさ）
var AI_READ_MAX_CHARS = 60000;
var AI_READ_MAX_BYTES = 4 * 1024 * 1024;

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

    if (action === 'saveNumberReport') {
      return json_(saveNumberReport_(data));
    }

    if (action === 'listNumberReports') {
      return json_(listNumberReports_(data));
    }

    if (action === 'saveReview') {
      appendRow_(
        '全体会議振り返り',
        ['日時', '事業部', '担当', '内容'],
        [data.ts || nowIso_(), data.campus || '', data.user || '', data.content || '']
      );
      return json_({ ok: true });
    }

    if (action === 'saveTaskReport') {
      return json_(saveTaskReport_(data));
    }

    if (action === 'createAiDoc') {
      return json_(createAiDoc_(data));
    }

    if (action === 'listDriveFolder') {
      return json_(listDriveFolder_(data));
    }

    if (action === 'readDriveFile') {
      return json_(readDriveFile_(data));
    }

    if (action === 'getTaskEvaluation') {
      return json_(getTaskEvaluation_(data));
    }

    if (action === 'appendPlanActions') {
      return json_(appendPlanActions_(data));
    }

    if (action === 'getKenshuAnswer') {
      return json_(getKenshuAnswer_(data));
    }

    if (action === 'saveKenshuAnswer') {
      return json_(saveKenshuAnswer_(data));
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

    if (action === 'listInquiryRecords') {
      return json_(listInquiryRecords_(data));
    }

    if (action === 'saveInquiryRecord') {
      return json_(saveInquiryRecord_(data));
    }

    if (action === 'deleteInquiryRecord') {
      return json_(deleteInquiryRecord_(data));
    }

    if (action === 'getDailyAiNotes') {
      return json_(getDailyAiNotes_(data));
    }

    if (action === 'saveDailyAiNotes') {
      return json_(saveDailyAiNotes_(data));
    }

    if (action === 'listGoals') {
      return json_(listGoals_(data));
    }

    if (action === 'saveShareItems') {
      return json_(saveShareItems_(data));
    }

    if (action === 'listShareItems') {
      return json_(listShareItems_(data));
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

    if (action === 'saveDeptPreshare') {
      return json_(saveDeptPreshare_(data));
    }

    if (action === 'listDeptPreshare') {
      return json_(listDeptPreshare_(data));
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
  try { DriveApp.getRootFolder().getName(); } catch (e) {}
  try { SlidesApp.getActivePresentation(); } catch (e) {}
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

// 数値報告の保存先。Next 側（lib/numberReports.ts の NUMBER_FORMS）の sheet と揃える。
// 任意のシートへ書き込まれないよう、ここに無い名前は受け付けない。
var NUMBER_SHEETS = ['月次数値', '講習数値'];

// 「数値報告」メニューの入力を指定シートへ1行で記録する。
// 見出し（headers）と値（row＝日時・対象・部門・校舎・入力者・各項目）は Next 側が組み立てて送る。
// 既存シートの見出しが古い場合は、不足分の見出しだけを補う。
// 「100%」「2026年9月分」などが数値・日付に化けないよう、行は書式なしテキストで書き込む。
function saveNumberReport_(data) {
  var name = String(data.sheet || '');
  if (NUMBER_SHEETS.indexOf(name) < 0) return { ok: false, reason: 'bad_sheet' };
  var headers = data.headers || [];
  var row = data.row || [];
  if (!headers.length || !row.length) return { ok: false, reason: 'no_headers' };
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
  } else {
    var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    for (var c = 0; c < headers.length; c++) {
      if (!cur[c]) sh.getRange(1, c + 1).setValue(headers[c]);
    }
  }
  var values = row.map(function (v) { return String(v == null ? '' : v); });
  values[0] = values[0] ? nowJp_(values[0]) : nowJp_();
  var range = sh.getRange(sh.getLastRow() + 1, 1, 1, values.length);
  range.setNumberFormat('@');
  range.setValues([values]);
  return { ok: true, sheet: name };
}

// 指定シートを新しい順（最大300件）に、見出しをキーにした連想配列で返す。
function listNumberReports_(data) {
  var name = String(data.sheet || '');
  if (NUMBER_SHEETS.indexOf(name) < 0) return { ok: false, reason: 'bad_sheet' };
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return { ok: true, sheet: name, items: [] };
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var key = String(headers[c]);
      if (!key) continue;
      obj[key] = cellStr_(values[i][c]);
    }
    items.push(obj);
  }
  items.reverse();
  if (items.length > 300) items = items.slice(0, 300);
  return { ok: true, sheet: name, items: items };
}

var SUCCESS_HEADERS = ['日時', '事業部', '担当', '件名', '取り組み', '結果', '他でも使えるポイント'];

// 月次報告・講習結果報告の成功事例を「成功事例」シートへ1件1行で記録する。
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

var SHARE_HEADERS = ['日時', '部門', '担当', '種別', '件名', '経緯', '論点', '報告者の意見'];

// 「報告」から転記された事前報告の中の「協議・決裁・報告」を1件1行で記録する。
// data.items = [{ kind, title, background, point, opinion }, ...]（Next 側で抽出済み）。
// ダッシュボードの「直近の事前共有事項」カードのもとになる。
function saveShareItems_(data) {
  var items = data.items;
  if (!items || !items.length) return { ok: true, count: 0 };
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('事前共有事項') || ss.insertSheet('事前共有事項');
  if (sh.getLastRow() === 0) sh.appendRow(SHARE_HEADERS);
  var ts = data.ts || nowIso_();
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    sh.appendRow([
      ts, data.campus || '', data.user || '', it.kind || '',
      it.title || '', it.background || '', it.point || '', it.opinion || ''
    ]);
  }
  return { ok: true, count: items.length };
}

// 事前共有事項（新しい順・最大150件）を返す。ダッシュボードのカードで使う。
function listShareItems_(data) {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('事前共有事項');
  if (!sh || sh.getLastRow() < 2) return { ok: true, items: [] };
  var values = sh.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    items.push({
      ts: cellStr_(r[0]), campus: String(r[1] == null ? '' : r[1]), user: String(r[2] == null ? '' : r[2]),
      kind: String(r[3] == null ? '' : r[3]), title: String(r[4] == null ? '' : r[4]),
      background: String(r[5] == null ? '' : r[5]), point: String(r[6] == null ? '' : r[6]),
      opinion: String(r[7] == null ? '' : r[7])
    });
  }
  items.reverse();
  if (items.length > 150) items = items.slice(0, 150);
  return { ok: true, items: items };
}

// ★末尾に「議事録ID」を足してある。既存シートには下の ensure で自動で見出しが足される。
//   このIDがあることで、あとから同じ議事録を直して保存し直せる（新しい行が増えない）。
var DEPT_MINUTES_HEADERS = ['日時', '部門', '入力者', '会議名', '開催日時', '場所', '出席者', '予定議題', '議事録', '会議の質チェック', '議事録ID', '修正日時', '修正者'];
var DEPT_DECISION_HEADERS = ['日時', '部門', '入力者', '会議名', '開催日時', '件名', '内容', '理由・背景', '担当', '期限', '関係部門', '議事録ID'];

// シートを用意し、見出しの不足分（あとから足した「議事録ID」など）を補う。
function sheetWithHeaders_(name, headers) {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    return sh;
  }
  var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  for (var c = 0; c < headers.length; c++) {
    if (!cur[c]) sh.getRange(1, c + 1).setValue(headers[c]);
  }
  return sh;
}

// 見出し名から列番号（1始まり）を返す。列を足しても位置を数え直さずに済むようにするため。
// ★「議事録ID」の位置を固定値で持つと、列を追加したときに上書きが効かなくなる。
function colOf_(headers, name) {
  return headers.indexOf(name) + 1;
}

// 指定列の値が id と一致する行番号を返す（見つからなければ 0）。
function findRowById_(sh, col, id) {
  if (!id || sh.getLastRow() < 2) return 0;
  var values = sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return i + 2;
  }
  return 0;
}

// 「部門会議議事録」メニューの保存。
//  ・「部門会議議事録」シートに1会議1行（議事録本文と会議の質チェックを丸ごと保存）
//  ・「部門決定事項」シートに1決定1行（部門をまたいで決め事を一覧するためのもと）
// 決定事項の切り出しは Next 側（lib/deptMinutesParse.ts）で済ませて data.decisions に入れて送られてくる。
//
// data.id があれば、その議事録を「直して保存し直した」とみなして元の行を上書きする。
// そのとき、ぶら下がっていた決定事項の行も入れ替える（古い決定が残らないようにするため）。
function saveDeptMinutes_(data) {
  var ts = data.ts || nowIso_();
  var sh = sheetWithHeaders_('部門会議議事録', DEPT_MINUTES_HEADERS);
  var idCol = colOf_(DEPT_MINUTES_HEADERS, '議事録ID');
  var row = findRowById_(sh, idCol, data.id);
  var isUpdate = row > 0;
  var id = row ? String(data.id) : (data.id ? String(data.id) : Utilities.getUuid());

  // 上書きのときは、最初に登録したときの「日時・部門・入力者」をそのまま残す。
  // 直した人は別に「修正日時・修正者」へ記録する（誰が作って誰が直したかを両方残すため）。
  var firstTs = isUpdate ? sh.getRange(row, 1).getValue() : ts;
  var origCampus = isUpdate ? String(sh.getRange(row, 2).getValue()) : (data.campus || '');
  var origUser = isUpdate ? String(sh.getRange(row, 3).getValue()) : (data.user || '');
  var values = [
    firstTs, origCampus, origUser, data.title || '', data.date || '',
    data.place || '', data.attendees || '', data.agenda || '',
    data.minutes || '', data.quality || '', id,
    isUpdate ? ts : '', isUpdate ? (data.user || '') : ''
  ];
  if (row) {
    sh.getRange(row, 1, 1, values.length).setValues([values]);
  } else {
    sh.appendRow(values);
  }

  // 決定事項は入れ替え（この議事録IDの行を消してから入れ直す）。
  var dsh = sheetWithHeaders_('部門決定事項', DEPT_DECISION_HEADERS);
  var dIdCol = colOf_(DEPT_DECISION_HEADERS, '議事録ID');
  if (row && dsh.getLastRow() >= 2) {
    var dv = dsh.getRange(2, dIdCol, dsh.getLastRow() - 1, 1).getValues();
    // 下から消す（消すたびに行番号がずれるため）。
    for (var k = dv.length - 1; k >= 0; k--) {
      if (String(dv[k][0]) === id) dsh.deleteRow(k + 2);
    }
  }

  var decisions = data.decisions || [];
  for (var i = 0; i < decisions.length; i++) {
    var d = decisions[i] || {};
    dsh.appendRow([
      firstTs, origCampus, origUser, data.title || '', data.date || '',
      d.title || '', d.detail || '', d.reason || '', d.owner || '', d.due || '', d.related || '', id
    ]);
  }

  // 事前共有した会議なら、その事前共有に議事録IDを入れる（ダッシュボードの事前共有から外れる）。
  // ここで失敗しても議事録の保存は済んでいるので、保存の結果には響かせない。
  if (data.preshareId) {
    try {
      linkDeptPreshare_(data.preshareId, id);
    } catch (err) {}
  }
  return {
    ok: true, decisions: decisions.length, id: id, updated: isUpdate,
    editedAt: isUpdate ? ts : '', editedBy: isUpdate ? (data.user || '') : ''
  };
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
      minutes: String(r[8] == null ? '' : r[8]), quality: String(r[9] == null ? '' : r[9]),
      id: String(r[10] == null ? '' : r[10]),
      editedAt: cellStr_(r[11]), editedBy: String(r[12] == null ? '' : r[12])
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

// 部門会議の事前共有。会議の前に、手順1の会議情報と議題・レジュメを全部門へ出しておく
//（ダッシュボードの「部門会議の事前共有」で、出席者が議題・レジュメを見ながら会議を進めるため）。
// ★列は見出し名で引く（colOf_）。「議事録ID」はこの会議の議事録を保存したときに入る。
var DEPT_PRESHARE_SHEET = '部門会議事前共有';
var DEPT_PRESHARE_HEADERS = ['日時', '部門', '入力者', '会議名', '開催日時', '場所', '出席者', '議題・レジュメ', '事前共有ID', '更新日時', '更新者', '議事録ID'];

function preshareCell_(r, name) {
  return cellStr_(r[colOf_(DEPT_PRESHARE_HEADERS, name) - 1]);
}

// data.id があれば、その事前共有を上書きする。
// 最初に共有したときの「日時・部門・入力者」と、結び付いた「議事録ID」はそのまま残す。
function saveDeptPreshare_(data) {
  var H = DEPT_PRESHARE_HEADERS;
  var sh = sheetWithHeaders_(DEPT_PRESHARE_SHEET, H);
  var row = findRowById_(sh, colOf_(H, '事前共有ID'), data.id);
  var cur = row ? sh.getRange(row, 1, 1, H.length).getValues()[0] : null;
  var id = data.id ? String(data.id) : Utilities.getUuid();
  var ts = nowJp_('');
  var rec = {
    '日時': cur ? preshareCell_(cur, '日時') : ts,
    '部門': cur ? preshareCell_(cur, '部門') : (data.campus || ''),
    '入力者': cur ? preshareCell_(cur, '入力者') : (data.user || ''),
    '会議名': data.title || '',
    '開催日時': data.date || '',
    '場所': data.place || '',
    '出席者': data.attendees || '',
    '議題・レジュメ': data.agenda || '',
    '事前共有ID': id,
    '更新日時': cur ? ts : '',
    '更新者': cur ? (data.user || '') : '',
    '議事録ID': cur ? preshareCell_(cur, '議事録ID') : ''
  };
  var values = H.map(function (h) { return String(rec[h]); });
  // appendRow は手入力と同じ解釈で書くため、「- 9月の実績」で始まる議題が数式とみなされたり、
  // 開催日時が日付に化けたりする。先に文字列書式を付けてから setValues で書く。
  sh.getRange(row || sh.getLastRow() + 1, 1, 1, H.length).setNumberFormat('@').setValues([values]);
  return { ok: true, id: id, updated: Boolean(row), ts: rec['日時'] };
}

// 部門会議の事前共有の一覧（新しい順・最大100件）。
// 議事録を保存した会議・日の過ぎた会議を外すのは Next 側（lib/deptMinutesPreshare.ts）で行う。
function listDeptPreshare_(data) {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(DEPT_PRESHARE_SHEET);
  if (!sh || sh.getLastRow() < 2) return { ok: true, items: [] };
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, DEPT_PRESHARE_HEADERS.length).getValues();
  var items = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    items.push({
      id: preshareCell_(r, '事前共有ID'), ts: preshareCell_(r, '日時'),
      campus: preshareCell_(r, '部門'), user: preshareCell_(r, '入力者'),
      title: preshareCell_(r, '会議名'), date: preshareCell_(r, '開催日時'),
      place: preshareCell_(r, '場所'), attendees: preshareCell_(r, '出席者'),
      agenda: preshareCell_(r, '議題・レジュメ'),
      editedAt: preshareCell_(r, '更新日時'), editedBy: preshareCell_(r, '更新者'),
      minutesId: preshareCell_(r, '議事録ID')
    });
  }
  items.reverse();
  if (items.length > 100) items = items.slice(0, 100);
  return { ok: true, items: items };
}

// 議事録を保存したとき、元になった事前共有に議事録IDを入れる（saveDeptMinutes_ から呼ぶ）。
function linkDeptPreshare_(preshareId, minutesId) {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(DEPT_PRESHARE_SHEET);
  if (!sh) return;
  var row = findRowById_(sh, colOf_(DEPT_PRESHARE_HEADERS, '事前共有ID'), preshareId);
  if (!row) return;
  sh.getRange(row, colOf_(DEPT_PRESHARE_HEADERS, '議事録ID')).setNumberFormat('@').setValue(String(minutesId));
}

// 全体研修会アンケート（/kenshu）。1人1行（研修会×部門×氏名）で持ち、送り直すと同じ行を上書きする。
// 「仕事」「人生・プライベート」は1行に1つを改行でつないで1セルに入れる（セルを折り返せばそのまま読める）。
// 「研修会」は lib/kenshu/survey.ts の SURVEY.id。次の研修会では別の id になり、別の行として残る。
// ★列は見出し名で引く（colOf_）。
var KENSHU_SHEET = '研修会アンケート';
var KENSHU_HEADERS = ['研修会', '部門', '氏名', '仕事の件数', '仕事', '人生・プライベートの件数', '人生・プライベート', '提出日時', '更新日時'];

function kenshuCell_(r, name) {
  return cellStr_(r[colOf_(KENSHU_HEADERS, name) - 1]);
}

function kenshuLines_(v) {
  return String(v == null ? '' : v).split('\n')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s; });
}

function kenshuItem_(r) {
  return {
    work: kenshuLines_(kenshuCell_(r, '仕事')),
    life: kenshuLines_(kenshuCell_(r, '人生・プライベート')),
    submittedAt: kenshuCell_(r, '提出日時'),
    updatedAt: kenshuCell_(r, '更新日時')
  };
}

// 研修会×部門×氏名が一致する行番号（無ければ 0）
function findKenshuRow_(sh, data) {
  if (sh.getLastRow() < 2) return 0;
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, KENSHU_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    if (kenshuCell_(r, '研修会') === String(data.survey || '') &&
        kenshuCell_(r, '部門') === String(data.campus || '') &&
        kenshuCell_(r, '氏名') === String(data.user || '')) return i + 2;
  }
  return 0;
}

// 本人の回答（まだ出していなければ item: null）
function getKenshuAnswer_(data) {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(KENSHU_SHEET);
  if (!sh) return { ok: true, item: null };
  var row = findKenshuRow_(sh, data);
  if (!row) return { ok: true, item: null };
  return { ok: true, item: kenshuItem_(sh.getRange(row, 1, 1, KENSHU_HEADERS.length).getValues()[0]) };
}

// 回答の保存。2回目以降は同じ行を上書きし、最初の「提出日時」は残して「更新日時」を入れる。
function saveKenshuAnswer_(data) {
  var H = KENSHU_HEADERS;
  var clean = function (list) {
    return (list || [])
      .map(function (s) { return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim(); })
      .filter(function (s) { return s; });
  };
  var work = clean(data.work);
  var life = clean(data.life);
  if (!data.survey || !data.campus || !data.user) return { ok: false, reason: 'bad_request' };
  if (!work.length || !life.length) return { ok: false, reason: 'empty' };

  // 同じ人が続けて押したときに2行できないよう、探してから書くまでを1人ずつにする
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheetWithHeaders_(KENSHU_SHEET, H);
    var row = findKenshuRow_(sh, data);
    var cur = row ? sh.getRange(row, 1, 1, H.length).getValues()[0] : null;
    var ts = nowJp_('');
    var rec = {
      '研修会': String(data.survey),
      '部門': String(data.campus),
      '氏名': String(data.user),
      '仕事の件数': work.length,
      '仕事': work.join('\n'),
      '人生・プライベートの件数': life.length,
      '人生・プライベート': life.join('\n'),
      '提出日時': cur ? kenshuCell_(cur, '提出日時') : ts,
      '更新日時': cur ? ts : ''
    };
    var values = H.map(function (h) { return rec[h]; });
    var target = row || sh.getLastRow() + 1;
    // 「- 」「=」で始まる行が数式に、日時が日付型に化けないよう、先に文字列書式を付けてから書く。件数だけは数値
    sh.getRange(target, 1, 1, H.length).setNumberFormat('@');
    sh.getRange(target, colOf_(H, '仕事の件数')).setNumberFormat('0');
    sh.getRange(target, colOf_(H, '人生・プライベートの件数')).setNumberFormat('0');
    sh.getRange(target, 1, 1, H.length).setValues([values]);
    return { ok: true, item: kenshuItem_(values) };
  } finally {
    lock.releaseLock();
  }
}

// 重要タスク報告（/task-report・小中等部の週次）を「重要タスク報告」シートに1件1行で追記する。
// 設問と見出しはアプリ側（lib/taskReport.ts）が持ち、headers / row で送ってくる。見出しはシートが空のときだけ書く。
// 返り値の saved は、このスクリプトが再デプロイ済みかをアプリ側で見分けるための印
//（古いスクリプトは未知の action を会話ログとして ok を返すため、印が無ければ保存されていない）。
var TASK_REPORT_SHEET = '重要タスク報告';
function saveTaskReport_(data) {
  if (!data.headers || !data.row || !data.headers.length || data.headers.length !== data.row.length) {
    return { ok: false, reason: 'bad_request' };
  }
  var H = ['日時', '部門', '記入者'].concat(data.headers);
  var values = [nowJp_(data.ts), data.campus || '', data.user || ''].concat(data.row).map(function (v) { return String(v); });
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(TASK_REPORT_SHEET) || ss.insertSheet(TASK_REPORT_SHEET);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, H.length).setValues([H]);
      sh.setFrozenRows(1);
    }
    // 「- 」「=」で始まる行が数式に、日時が日付型に化けないよう、先に文字列書式を付けてから書く
    sh.getRange(sh.getLastRow() + 1, 1, 1, H.length).setNumberFormat('@').setValues([values]);
    return { ok: true, saved: 'taskReport' };
  } finally {
    lock.releaseLock();
  }
}

// AI壁打ち：重要タスク評価シートの校舎タブを、表示値（「14%」「動いているが…」など見えているとおり）で返す。
function getTaskEvaluation_(data) {
  if (!TASK_EVAL_BOOK_ID) return { ok: false, reason: 'eval_not_configured' };
  if (TASK_COACH_SCHOOLS.indexOf(data.school) === -1) return { ok: false, reason: 'bad_school' };
  var ss;
  try {
    ss = SpreadsheetApp.openById(TASK_EVAL_BOOK_ID);
  } catch (err) {
    return { ok: false, reason: 'eval_open_failed' };
  }
  var sh = ss.getSheetByName(data.school);
  if (!sh) return { ok: false, reason: 'eval_sheet_not_found' };
  var n = Math.min(Math.max(sh.getLastRow(), 1), 60);
  return { ok: true, rows: sh.getRange(1, 1, n, 7).getDisplayValues() };
}

// 「11/04」と「11/4」を同じに扱う。
function planDate_(v) {
  return normCell_(v).replace(/^0/, '').replace(/\/0/, '/');
}

// 秋～冬行動計画で「校舎×区分×日付」のセルを探す。見つからなければ null。
// 「月日」の行からその日付の列を見つけ、その下（次の「月日」の行まで）にある校舎の3行（外部・内部・他）から区分の行を選ぶ。
// 月のブロックの上下に「月日」の行が2つあるが、上から探すので先に見つかる上の行を使う。
function findPlanCell_(values, school, kind, date) {
  for (var r = 0; r < values.length; r++) {
    if (normCell_(values[r][0]) !== '月日') continue;
    var col = -1;
    for (var c = 1; c < values[r].length; c++) {
      if (planDate_(values[r][c]) === date) { col = c; break; }
    }
    if (col < 0) continue;
    for (var rr = r + 1; rr < values.length && rr < r + 60; rr++) {
      var head = normCell_(values[rr][0]);
      if (head === '月日') break;
      if (head !== school) continue;
      for (var k = 0; k < 3 && rr + k < values.length; k++) {
        if (k > 0 && normCell_(values[rr + k][0]) !== '') break;
        if (normCell_(values[rr + k][2]) === kind) return { row: rr + k, col: col };
      }
      return null;
    }
  }
  return null;
}

// AI壁打ち：行動計画の案を、秋～冬行動計画の該当セルに「★行動」として書き足す。
// 今ある文は消さない。同じ「★行動」がすでにあるセルには書かない（二度押し対策）。
// 書いたものは「AI壁打ち書き込み」シートにも1件1行で残す（いつ・誰が・どのセルに書いたか）。
function appendPlanActions_(data) {
  if (!GOALS_BOOK_ID) return { ok: false, reason: 'goals_not_configured' };
  if (TASK_COACH_SCHOOLS.indexOf(data.school) === -1) return { ok: false, reason: 'bad_school' };
  var actions = data.actions || [];
  if (!actions.length || actions.length > 20) return { ok: false, reason: 'bad_request' };
  var ss;
  try {
    ss = SpreadsheetApp.openById(GOALS_BOOK_ID);
  } catch (err) {
    return { ok: false, reason: 'goals_open_failed' };
  }
  var sh = ss.getSheetByName(GOALS_SHEET_NAME);
  if (!sh) return { ok: false, reason: 'goals_sheet_not_found' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var values = sh.getDataRange().getDisplayValues();
    var ts = nowJp_(data.ts);
    var results = [];
    var logs = [];
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i] || {};
      var text = String(a.text || '').replace(/[\r\n]+/g, ' ').slice(0, 120);
      var date = planDate_(a.date);
      var kind = normCell_(a.kind);
      var res = { date: date, kind: kind, text: text };
      var pos = text ? findPlanCell_(values, data.school, kind, date) : null;
      if (!pos) { res.status = 'not_found'; results.push(res); continue; }
      var range = sh.getRange(pos.row + 1, pos.col + 1);
      res.cell = range.getA1Notation();
      var cur = String(values[pos.row][pos.col] || '');
      var add = '★' + text;
      if (cur.split('\n').indexOf(add) !== -1) { res.status = 'skipped'; results.push(res); continue; }
      var next = cur ? cur + '\n' + add : add;
      range.setValue(next);
      values[pos.row][pos.col] = next;
      res.status = 'written';
      results.push(res);
      logs.push([ts, data.campus || '', data.user || '', data.school, date, kind, add, res.cell]);
    }
    for (var j = 0; j < logs.length; j++) {
      appendRow_(PLAN_LOG_SHEET, ['日時', '部門', '記入者', '校舎', '日付', '区分', '内容', 'セル'], logs[j]);
    }
    return { ok: true, saved: 'planActions', results: results };
  } finally {
    lock.releaseLock();
  }
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
  '体験日', '体験', '入塾提案面談日', '本人OK', 'クローズ予定日', '結果', '入塾日',
];
// ※「入塾日」は台帳（問合せ管理 Web アプリ）にだけある列。旧スプレッドシートには無いので空で返る。
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
  // 問合せ管理 Web アプリの台帳に1件でもあれば、そちらを正とする（旧スプレッドシートは読まない）。
  // 台帳が空のあいだは従来どおり旧スプレッドシートを読むので、移行前でも問い合わせQAは止まらない。
  var db = listInquiryRecords_(data);
  if (db.ok && db.items.length > 0) return maskInquiryRecords_(db.items);

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


// ===== 問合せ台帳（問合せ管理 Web アプリ /inquiry-board の保存先） =============
// 1件1行。日付は「YYYY-MM-DD」の文字列で持つ（シートの自動日付変換を避けるため列を書式 @ にする）。
// 削除は「削除」列に 1 を立てる論理削除（誤操作で消えても復元できるように）。

function inquiryDbSheet_() {
  var id = INQUIRY_DB_ID || SPREADSHEET_ID;
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(INQUIRY_DB_SHEET);
  if (!sh) {
    sh = ss.insertSheet(INQUIRY_DB_SHEET);
    sh.appendRow(INQUIRY_DB_HEADERS);
    sh.setFrozenRows(1);
    // 全列を文字列扱いにする（日付・電話番号・郵便番号が勝手に変換されないように）
    sh.getRange(1, 1, sh.getMaxRows(), INQUIRY_DB_HEADERS.length).setNumberFormat('@');
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(INQUIRY_DB_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), INQUIRY_DB_HEADERS.length).setNumberFormat('@');
  } else {
    // 列が増えたときは、無い見出しを右端に足す（既存の列の位置は変えない。読み書きは見出し名で引く）
    var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    var have = {};
    for (var i = 0; i < cur.length; i++) have[String(cur[i]).trim()] = true;
    for (var c = 0; c < INQUIRY_DB_HEADERS.length; c++) {
      var h = INQUIRY_DB_HEADERS[c];
      if (have[h]) continue;
      var at = sh.getLastColumn() + 1;
      sh.getRange(1, at).setValue(h);
      sh.getRange(1, at, sh.getMaxRows(), 1).setNumberFormat('@');
      have[h] = true;
    }
  }
  return sh;
}

// 台帳のセル→文字列。Date が紛れ込んだら YYYY-MM-DD にする。
function dbCellStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

// 見出し→列番号（0始まり）。台帳は見出し名で引く（列の追加に強くするため）。
function dbColMap_(sh) {
  var headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var map = {};
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] == null ? '' : headers[c]).trim();
    if (h && map[h] === undefined) map[h] = c;
  }
  return map;
}

function dbRowToObj_(row, col) {
  var obj = {};
  for (var i = 0; i < INQUIRY_DB_HEADERS.length; i++) {
    var h = INQUIRY_DB_HEADERS[i];
    obj[h] = col[h] === undefined ? '' : dbCellStr_(row[col[h]]);
  }
  return obj;
}

// オブジェクト → シートの1行。列の位置は見出し名（col）で決める。
function dbObjToRow_(obj, col, width) {
  var row = [];
  for (var i = 0; i < width; i++) row.push('');
  for (var j = 0; j < INQUIRY_DB_HEADERS.length; j++) {
    var h = INQUIRY_DB_HEADERS[j];
    if (col[h] === undefined) continue;
    row[col[h]] = obj[h] == null ? '' : String(obj[h]);
  }
  return row;
}

function listInquiryRecords_(data) {
  var sh;
  try {
    sh = inquiryDbSheet_();
  } catch (err) {
    return { ok: false, reason: 'db_open_failed', items: [] };
  }
  if (sh.getLastRow() < 2) return { ok: true, items: [], fetchedAt: nowJp_() };
  var col = dbColMap_(sh);
  var values = sh.getDataRange().getValues();
  var items = [];
  for (var r = 1; r < values.length; r++) {
    var obj = dbRowToObj_(values[r], col);
    if (!obj['ID']) continue;
    if (obj['削除'] === '1') continue;
    delete obj['削除'];
    items.push(obj);
  }
  return { ok: true, items: items, fetchedAt: nowJp_() };
}

// 台帳の行番号（1始まり）を ID で探す。無ければ -1。
function dbFindRow_(sh, col, id) {
  if (col['ID'] === undefined || sh.getLastRow() < 2) return -1;
  var ids = sh.getRange(2, col['ID'] + 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) return i + 2;
  }
  return -1;
}

// 校舎内の次の No.（最大＋1）。
function dbNextNo_(sh, col, campus) {
  if (sh.getLastRow() < 2) return 1;
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var max = 0;
  for (var i = 0; i < values.length; i++) {
    if (dbCellStr_(values[i][col['校舎']]) !== campus) continue;
    var n = Number(values[i][col['No.']]);
    if (n > max) max = n;
  }
  return max + 1;
}

// 新規（ID が台帳に無い）なら追加、あれば上書き。No. が空なら校舎内で採番する。
// LockService で同時登録の No. 重複を防ぐ。
function saveInquiryRecord_(data) {
  var rec = data.record || {};
  var id = String(rec['ID'] || '').trim();
  if (!id) return { ok: false, reason: 'bad_id' };
  if (!String(rec['校舎'] || '').trim()) return { ok: false, reason: 'invalid' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = inquiryDbSheet_();
    var col = dbColMap_(sh);
    var width = Math.max(sh.getLastColumn(), INQUIRY_DB_HEADERS.length);
    var row = dbFindRow_(sh, col, id);
    var ts = nowJp_();

    if (row === -1) {
      if (!Number(rec['No.'])) rec['No.'] = dbNextNo_(sh, col, String(rec['校舎']));
      if (!rec['作成日時']) rec['作成日時'] = ts;
      if (!rec['作成者']) rec['作成者'] = rec['更新者'] || '';
      rec['更新日時'] = ts;
      rec['削除'] = '';
      // appendRow は「手入力と同じ解釈」で書くため、電話番号の先頭 0 が落ちたり日付が Date に化けたりする。
      // 先に文字列書式を付けてから setValues で書く（書式を後から付けても、落ちた 0 は戻らない）。
      var newRow = sh.getLastRow() + 1;
      sh.getRange(newRow, 1, 1, width).setNumberFormat('@').setValues([dbObjToRow_(rec, col, width)]);
      return { ok: true, item: rec };
    }

    var cur = dbRowToObj_(sh.getRange(row, 1, 1, width).getValues()[0], col);
    if (cur['削除'] === '1') return { ok: false, reason: 'not_found' };
    // 作成情報は元の値を守る。No. も空で来たら元の値を使う（校舎が変わったときだけ採番し直す）。
    rec['作成日時'] = cur['作成日時'];
    rec['作成者'] = cur['作成者'];
    if (!Number(rec['No.'])) {
      rec['No.'] = String(rec['校舎']) === cur['校舎'] ? cur['No.'] : dbNextNo_(sh, col, String(rec['校舎']));
    }
    rec['更新日時'] = ts;
    rec['削除'] = '';
    sh.getRange(row, 1, 1, width).setNumberFormat('@').setValues([dbObjToRow_(rec, col, width)]);
    return { ok: true, item: rec };
  } catch (err) {
    return { ok: false, reason: 'db_open_failed:' + err };
  } finally {
    lock.releaseLock();
  }
}

function deleteInquiryRecord_(data) {
  var id = String(data.id || '').trim();
  if (!id) return { ok: false, reason: 'bad_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = inquiryDbSheet_();
    var col = dbColMap_(sh);
    var row = dbFindRow_(sh, col, id);
    if (row === -1) return { ok: false, reason: 'not_found' };
    sh.getRange(row, col['削除'] + 1).setValue('1');
    sh.getRange(row, col['更新日時'] + 1).setValue(nowJp_());
    sh.getRange(row, col['更新者'] + 1).setValue(String(data.user || ''));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'db_open_failed:' + err };
  } finally {
    lock.releaseLock();
  }
}

// ---- 「今日の注意点」AI の一言（1日1回生成・その日は固定） ------------------

function aiNotesSheet_() {
  var id = INQUIRY_DB_ID || SPREADSHEET_ID;
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(AI_NOTES_SHEET);
  if (!sh) {
    sh = ss.insertSheet(AI_NOTES_SHEET);
    sh.appendRow(AI_NOTES_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), AI_NOTES_HEADERS.length).setNumberFormat('@');
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(AI_NOTES_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), AI_NOTES_HEADERS.length).setNumberFormat('@');
  }
  return sh;
}

// その日の一言を全対象ぶん返す。{ date: 'YYYY-MM-DD' }
function getDailyAiNotes_(data) {
  var date = String(data.date || '').trim();
  if (!date) return { ok: false, reason: 'bad_date', items: [] };
  var sh;
  try {
    sh = aiNotesSheet_();
  } catch (err) {
    return { ok: false, reason: 'db_open_failed', items: [] };
  }
  if (sh.getLastRow() < 2) return { ok: true, items: [] };
  var values = sh.getDataRange().getValues();
  var items = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (dbCellStr_(row[0]) !== date) continue;
    items.push({ '日付': date, '対象': dbCellStr_(row[1]), '本文': dbCellStr_(row[2]), '生成日時': dbCellStr_(row[3]) });
  }
  return { ok: true, items: items };
}

// 一言を保存する。{ notes: [{ 日付, 対象, 本文, 生成日時 }] } 同じ日付×対象があれば上書き。
// 古い行（AI_NOTES_KEEP_DAYS より前）は保存のついでに消す。
function saveDailyAiNotes_(data) {
  var notes = data.notes || [];
  if (!notes.length) return { ok: true, saved: 0 };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = aiNotesSheet_();
    var values = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, AI_NOTES_HEADERS.length).getValues();
    var cutoff = Utilities.formatDate(new Date(Date.now() - AI_NOTES_KEEP_DAYS * 86400000), 'Asia/Tokyo', 'yyyy-MM-dd');
    var kept = [];
    var index = {};
    for (var r = 0; r < values.length; r++) {
      var d = dbCellStr_(values[r][0]);
      if (!d || d < cutoff) continue;
      index[d + '|' + dbCellStr_(values[r][1])] = kept.length;
      kept.push([d, dbCellStr_(values[r][1]), dbCellStr_(values[r][2]), dbCellStr_(values[r][3])]);
    }
    var saved = 0;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i] || {};
      var date = String(n['日付'] || '').trim();
      var scope = String(n['対象'] || '').trim();
      var text = String(n['本文'] || '').trim();
      if (!date || !scope || !text) continue;
      var row = [date, scope, text, String(n['生成日時'] || nowJp_())];
      var k = date + '|' + scope;
      if (index[k] !== undefined) kept[index[k]] = row;
      else { index[k] = kept.length; kept.push(row); }
      saved++;
    }
    // 2行目以降を丸ごと書き直す（行数が少ないので単純に）
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, AI_NOTES_HEADERS.length).clearContent();
    if (kept.length) sh.getRange(2, 1, kept.length, AI_NOTES_HEADERS.length).setNumberFormat('@').setValues(kept);
    return { ok: true, saved: saved };
  } catch (err) {
    return { ok: false, reason: 'db_open_failed:' + err };
  } finally {
    lock.releaseLock();
  }
}

// 台帳の行 → 問い合わせQA に渡す形（個人情報を落とし、氏名をマスクする）。
// 旧スプレッドシート経由の listInquiryBoard_ と同じキー名で返す（lib/inquiryBoard.ts が両方を同じ型で読む）。
function maskInquiryRecords_(items) {
  var out = [];
  var campuses = [];
  var seen = {};
  for (var i = 0; i < items.length; i++) {
    if (out.length >= INQUIRY_MAX_ROWS) break;
    var r = items[i];
    var campus = String(r['校舎'] || '').replace(/[\s　]/g, '');
    if (campus && !seen[campus]) { seen[campus] = true; campuses.push(campus); }
    var obj = { '校舎': campus };
    for (var k = 0; k < INQUIRY_COLUMNS.length; k++) {
      var key = INQUIRY_COLUMNS[k];
      var val = String(r[key] == null ? '' : r[key]);
      if (key === '生徒氏名') val = maskName_(val);
      obj[key] = val;
    }
    var note = cleanNote_(r['備考']);
    if (note.length > INQUIRY_NOTE_MAX) note = note.slice(0, INQUIRY_NOTE_MAX) + '…';
    obj['備考'] = note;
    out.push(obj);
  }
  return { ok: true, items: out, campuses: campuses, fetchedAt: nowJp_(), source: 'db' };
}

// 【移行用・GAS エディタから一度実行】旧スプレッドシート（INQUIRY_BOARD_ID）の校舎シートを
// 「問合せ台帳」へ写す。校舎＋No.＋生徒氏名 が同じ行は飛ばすので、何度実行しても二重にならない。
// 実行後は問い合わせQAも台帳を読むようになる（listInquiryBoard_ 参照）。
var LEGACY_START_YEAR = 2026; // 旧シートの「5/21」のような年無しの日付を補う年（5月始まりの期の開始年）

// ---- 旧スプレッドシート（2026小中等部問合せ管理）からの取り込み・差分取り込み ----------------
//
// 使い方（Apps Script のエディタから実行）
//   previewLegacyDiff()  … 旧シートと台帳を見比べて、何が追加・更新されるかを「旧シート差分」タブに書く（台帳は変えない）
//   applyLegacyDiff()    … 上の内容を台帳に反映する（追加＋空欄の穴埋め＋備考の追記）。結果も「旧シート差分」タブに書く
//   importLegacyInquiryBoard() … applyLegacyDiff() と同じ（初回の一括取り込みも、2回目以降の差分取り込みも同じ関数で済む）
//
// 行の突き合わせ：校舎＋生徒氏名（空白を除いて比較）。同じ校舎に同名が複数あるときは No. でも絞る。
//   同じ校舎に無ければ他の校舎の同名を探す（アプリ側で校舎を直したケース。県中対策→オンライン等）。
//   台帳で削除済みの行も突き合わせに使う（アプリで消した人を旧シートから復活させない）。
// 反映のルール：
//   - 台帳に無い人 → 追加。No. は旧シートの番号を使うが、その番号がすでに台帳の別人に使われていれば次の番号を付け、
//     備考に「旧シートNo.xx」と残す
//   - 台帳にある人 → 台帳が空欄の項目だけ旧シートの値で埋める。備考は旧シートにあって台帳に無い行だけ末尾に足す
//   - 両方に値があって違う項目 → 台帳（アプリ）の値を優先し、「競合」として一覧に出すだけ（担当者が見て判断）
var LEGACY_REPORT_SHEET = '旧シート差分';
var LEGACY_FILL_FIELDS = ['日付', 'ふりがな', '学校名', '学年', '電話番号', '媒体', '受講期', '連絡', '体験日', '体験',
  '入塾提案面談日', '本人OK', 'クローズ予定日', '結果', '保護者名', '郵便番号', '住所', 'メールアドレス', 'DM'];
var LEGACY_CONFLICT_FIELDS = ['日付', '学年', '電話番号', '連絡', '体験日', '体験', '入塾提案面談日', '本人OK', 'クローズ予定日', '結果', 'DM'];

function importLegacyInquiryBoard() {
  return applyLegacyDiff();
}

function previewLegacyDiff() {
  var d = legacyDiff_();
  writeLegacyReport_(d, false);
  var msg = '【確認のみ】追加 ' + d.adds.length + ' 件、更新 ' + d.updates.length + ' 件、競合 ' + d.conflicts.length + ' 件、変更なし ' + d.unchanged + ' 件。「' + LEGACY_REPORT_SHEET + '」タブに一覧を書きました。';
  Logger.log(msg);
  return { preview: true, added: d.adds.length, updated: d.updates.length, conflicts: d.conflicts.length, unchanged: d.unchanged, message: msg };
}

function applyLegacyDiff() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var d = legacyDiff_();
    var sh = d.sheet;
    var col = d.col;
    var width = d.width;
    var ts = nowJp_();

    // 更新（1行ずつ書き戻す）
    for (var u = 0; u < d.updates.length; u++) {
      var up = d.updates[u];
      var rowArr = d.values[up.rowIndex].slice();
      for (var f in up.fill) rowArr[col[f]] = up.fill[f];
      if (up.noteAdd.length) {
        var curNote = dbCellStr_(rowArr[col['備考']]);
        rowArr[col['備考']] = (curNote ? curNote + '\n' : '') + '[旧シート ' + ts.slice(0, 10) + ']\n' + up.noteAdd.join('\n');
      }
      rowArr[col['更新日時']] = ts;
      rowArr[col['更新者']] = '旧シート差分';
      for (var w = 0; w < width; w++) rowArr[w] = rowArr[w] == null ? '' : (rowArr[w] instanceof Date ? dbCellStr_(rowArr[w]) : String(rowArr[w]));
      sh.getRange(up.rowIndex + 1, 1, 1, width).setNumberFormat('@').setValues([rowArr]);
    }

    // 追加（まとめて書く）
    if (d.adds.length) {
      var rows = [];
      for (var a = 0; a < d.adds.length; a++) {
        var rec = d.adds[a];
        rec['ID'] = Utilities.getUuid();
        rec['作成日時'] = ts; rec['作成者'] = '旧シート移行';
        rec['更新日時'] = ts; rec['更新者'] = '旧シート移行';
        rec['削除'] = '';
        rows.push(dbObjToRow_(rec, col, width));
      }
      var start = sh.getLastRow() + 1;
      sh.getRange(start, 1, rows.length, width).setNumberFormat('@').setValues(rows);
    }

    writeLegacyReport_(d, true);
    var msg = '追加 ' + d.adds.length + ' 件、更新 ' + d.updates.length + ' 件、競合（台帳を優先） ' + d.conflicts.length + ' 件、変更なし ' + d.unchanged + ' 件。「' + LEGACY_REPORT_SHEET + '」タブに一覧を書きました。';
    Logger.log(msg);
    return { preview: false, added: d.adds.length, updated: d.updates.length, conflicts: d.conflicts.length, unchanged: d.unchanged, message: msg };
  } finally {
    lock.releaseLock();
  }
}

function legacyNameKey_(s) {
  return String(s == null ? '' : s).replace(/[\s　]/g, '');
}

// 旧シートの全タブを読んで、台帳の見出し名キーのオブジェクトにして返す。
function readLegacyRows_() {
  if (!INQUIRY_BOARD_ID) throw new Error('INQUIRY_BOARD_ID が未設定です。');
  var src = SpreadsheetApp.openById(INQUIRY_BOARD_ID);
  var alias = { '入塾/講習会提案日': '入塾提案面談日' };
  var sheets = src.getSheets();
  var out = [];
  for (var si = 0; si < sheets.length; si++) {
    var s = sheets[si];
    if (s.isSheetHidden && s.isSheetHidden()) continue;
    if (s.getLastRow() < 2) continue;
    var values = s.getDataRange().getValues();
    var hr = findInquiryHeader_(values);
    if (hr === -1) continue;
    var campus = String(s.getName()).replace(/[\s　]/g, '');
    // 台帳では「県中対策」を通塾の「県中」とオンラインの「オンライン」に分けている。
    // 旧シートからは区別できないので「県中」に入れ、オンラインの人は担当者が校舎を直す。
    if (campus === '県中対策') campus = '県中';

    var headers = values[hr];
    var colOf = {};
    var noteCol = -1;
    var nameCol = -1;
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c] == null ? '' : headers[c]).replace(/[\s　]/g, '');
      if (!h) continue;
      h = alias[h] || h;
      if (colOf[h] === undefined) colOf[h] = c;
      if (h === '生徒氏名') nameCol = c;
      if (noteCol === -1 && h.indexOf(INQUIRY_NOTE_PREFIX) === 0) noteCol = c;
    }
    if (nameCol === -1) continue;
    // ふりがなは見出しが無い（生徒氏名の右隣）ので位置で拾う
    var kanaCol = !String(headers[nameCol + 1] || '').trim() ? nameCol + 1 : -1;
    // DM 列は見出し行の1つ下に「DM」と書かれていることがあるので、A列の値で判定する
    var dmCol = colOf['DM'] !== undefined ? colOf['DM'] : 0;

    for (var r = hr + 1; r < values.length; r++) {
      var row = values[r];
      var name = String(row[nameCol] == null ? '' : row[nameCol]).trim();
      var date = legacyDate_(colOf['日付'] === undefined ? '' : row[colOf['日付']]);
      if (!name && !date) continue; // 空行・小計行
      if (name === 'DM' || name === '生徒氏名') continue;
      if (name.indexOf('テ') === 0 && noteCol !== -1 && String(row[noteCol]).indexOf('テスト') !== -1) continue;

      var pick = function (h) { return colOf[h] === undefined ? '' : String(row[colOf[h]] == null ? '' : row[colOf[h]]).trim(); };
      var no = Number(row[colOf['No.']]) || 0;
      out.push({
        'ID': '',
        '校舎': campus,
        'No.': no ? String(no) : '',
        '日付': date,
        '生徒氏名': name,
        'ふりがな': kanaCol === -1 ? '' : String(row[kanaCol] == null ? '' : row[kanaCol]).trim(),
        '学校名': pick('学校名'),
        '学年': pick('学年'),
        '電話番号': pick('電話番号'),
        '媒体': pick('媒体'),
        '紹介者': '',
        '受講期': pick('受講期'),
        '連絡': pick('連絡'),
        '体験日': legacyDate_(colOf['体験日'] === undefined ? '' : row[colOf['体験日']]),
        '体験': legacyMark_(pick('体験')),
        '入塾提案面談日': legacyDate_(colOf['入塾提案面談日'] === undefined ? '' : row[colOf['入塾提案面談日']]),
        '本人OK': legacyMark_(pick('本人OK')),
        'クローズ予定日': legacyDate_(colOf['クローズ予定日'] === undefined ? '' : row[colOf['クローズ予定日']]),
        '結果': pick('結果'),
        '入塾日': '',
        '備考': noteCol === -1 ? '' : String(row[noteCol] == null ? '' : row[noteCol]).trim(),
        '保護者名': pick('保護者名'),
        '郵便番号': pick('郵便番号'),
        '住所': pick('住所'),
        'メールアドレス': pick('メールアドレス'),
        'DM': legacyMark_(String(row[dmCol] == null ? '' : row[dmCol]).trim()),
        '受付ID': '',
        '_sheet': s.getName(),
        '_row': r + 1,
      });
    }
  }
  return out;
}

// 旧シートと台帳を突き合わせて、追加・更新・競合を決める（書き込みはしない）。
function legacyDiff_() {
  var legacy = readLegacyRows_();
  var sh = inquiryDbSheet_();
  var col = dbColMap_(sh);
  var width = Math.max(sh.getLastColumn(), INQUIRY_DB_HEADERS.length);
  var values = sh.getLastRow() < 1 ? [] : sh.getDataRange().getValues();

  // 台帳の行（削除済みも含める。削除した人を旧シートから復活させないため）
  var ledger = [];          // { rowIndex, obj }
  var byCampusName = {};    // 校舎|氏名 → [ledger idx]
  var byName = {};          // 氏名 → [ledger idx]
  var usedNo = {};          // 校舎 → { No.: true }
  var maxNo = {};
  for (var r = 1; r < values.length; r++) {
    var obj = dbRowToObj_(values[r], col);
    if (!obj['ID']) continue;
    var idx = ledger.length;
    ledger.push({ rowIndex: r, obj: obj });
    var nk = legacyNameKey_(obj['生徒氏名']);
    var ck = obj['校舎'] + '|' + nk;
    (byCampusName[ck] = byCampusName[ck] || []).push(idx);
    (byName[nk] = byName[nk] || []).push(idx);
    var n = Number(obj['No.']) || 0;
    if (n) {
      (usedNo[obj['校舎']] = usedNo[obj['校舎']] || {})[n] = true;
      if (!maxNo[obj['校舎']] || n > maxNo[obj['校舎']]) maxNo[obj['校舎']] = n;
    }
  }

  var adds = [], updates = [], conflicts = [], unchanged = 0;
  var matched = {}; // ledger idx → true（同じ台帳行に2つの旧行を当てない）
  for (var i = 0; i < legacy.length; i++) {
    var L = legacy[i];
    var nk2 = legacyNameKey_(L['生徒氏名']);
    if (!nk2) continue; // 氏名なしの行は突き合わせできないので飛ばす
    var cands = byCampusName[L['校舎'] + '|' + nk2] || [];
    if (!cands.length) cands = byName[nk2] || [];
    cands = cands.filter(function (x) { return !matched[x]; });
    var hit = -1;
    if (cands.length === 1) hit = cands[0];
    else if (cands.length > 1) {
      // 同名が複数：No. が同じものを優先、無ければ最初
      var sameNo = cands.filter(function (x) { return L['No.'] && ledger[x].obj['No.'] === L['No.']; });
      hit = sameNo.length ? sameNo[0] : cands[0];
    }

    if (hit === -1) {
      // 追加。No. が台帳の別人と重なるなら採番し直す
      var cp = L['校舎'];
      var wantNo = Number(L['No.']) || 0;
      var noteExtra = '';
      if (wantNo && usedNo[cp] && usedNo[cp][wantNo]) {
        maxNo[cp] = (maxNo[cp] || 0) + 1;
        noteExtra = '旧シートNo.' + wantNo;
        L['No.'] = String(maxNo[cp]);
      } else if (!wantNo) {
        maxNo[cp] = (maxNo[cp] || 0) + 1;
        L['No.'] = String(maxNo[cp]);
      } else if (wantNo > (maxNo[cp] || 0)) {
        maxNo[cp] = wantNo;
      }
      (usedNo[cp] = usedNo[cp] || {})[Number(L['No.'])] = true;
      if (noteExtra) L['備考'] = (L['備考'] ? L['備考'] + '\n' : '') + noteExtra;
      adds.push(L);
      continue;
    }

    matched[hit] = true;
    var T = ledger[hit].obj;
    if (T['削除'] === '1') { unchanged++; continue; } // アプリで削除済み。復活させない
    var fill = {};
    var hasFill = false;
    for (var f = 0; f < LEGACY_FILL_FIELDS.length; f++) {
      var fld = LEGACY_FILL_FIELDS[f];
      var lv = String(L[fld] == null ? '' : L[fld]).trim();
      var tv = String(T[fld] == null ? '' : T[fld]).trim();
      if (!lv) continue;
      if (!tv) { fill[fld] = lv; hasFill = true; }
      else if (lv !== tv && LEGACY_CONFLICT_FIELDS.indexOf(fld) !== -1) {
        conflicts.push({ campus: T['校舎'], no: T['No.'], name: T['生徒氏名'], field: fld, ledger: tv, legacy: lv, sheet: L['_sheet'], row: L['_row'] });
      }
    }
    // 備考：旧シートにあって台帳に無い行だけ足す
    var noteAdd = [];
    var tNote = String(T['備考'] || '');
    var lLines = String(L['備考'] || '').split('\n');
    for (var n2 = 0; n2 < lLines.length; n2++) {
      var line = lLines[n2].trim();
      if (line && tNote.indexOf(line) === -1) noteAdd.push(line);
    }
    if (hasFill || noteAdd.length) {
      updates.push({ rowIndex: ledger[hit].rowIndex, campus: T['校舎'], no: T['No.'], name: T['生徒氏名'], fill: fill, noteAdd: noteAdd, sheet: L['_sheet'], row: L['_row'] });
    } else {
      unchanged++;
    }
  }
  return { sheet: sh, col: col, width: width, values: values, adds: adds, updates: updates, conflicts: conflicts, unchanged: unchanged };
}

// 「旧シート差分」タブに結果を書く（毎回書き直す）。
function writeLegacyReport_(d, applied) {
  var id = INQUIRY_DB_ID || SPREADSHEET_ID;
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  var rp = ss.getSheetByName(LEGACY_REPORT_SHEET) || ss.insertSheet(LEGACY_REPORT_SHEET);
  rp.clearContents();
  var ts = nowJp_();
  var head = ['実行日時', '区分', '校舎', 'No.', '生徒氏名', '項目', '台帳の値', '旧シートの値', '旧シートの場所'];
  var rows = [head];
  var tag = applied ? '' : '（確認のみ・未反映）';
  for (var a = 0; a < d.adds.length; a++) {
    var A = d.adds[a];
    rows.push([ts, '追加' + tag, A['校舎'], A['No.'], A['生徒氏名'], '', '', A['日付'] + ' ' + (A['結果'] || '追客中'), A['_sheet'] + ' ' + A['_row'] + '行目']);
  }
  for (var u = 0; u < d.updates.length; u++) {
    var U = d.updates[u];
    for (var f in U.fill) rows.push([ts, '空欄を埋める' + tag, U.campus, U.no, U.name, f, '', U.fill[f], U.sheet + ' ' + U.row + '行目']);
    if (U.noteAdd.length) rows.push([ts, '備考に追記' + tag, U.campus, U.no, U.name, '備考', '', U.noteAdd.join(' / '), U.sheet + ' ' + U.row + '行目']);
  }
  for (var c = 0; c < d.conflicts.length; c++) {
    var C = d.conflicts[c];
    rows.push([ts, '競合（台帳を優先）', C.campus, C.no, C.name, C.field, C.ledger, C.legacy, C.sheet + ' ' + C.row + '行目']);
  }
  if (rows.length === 1) rows.push([ts, '差分なし', '', '', '', '', '', '', '']);
  rp.getRange(1, 1, rows.length, head.length).setNumberFormat('@').setValues(rows);
  rp.setFrozenRows(1);
}

// 旧シートの日付セル → YYYY-MM-DD。Date 型はそのまま、「5/21」「5月21日」は年を補う。
// 「5/21.6/29」のような複数日はそのまま文字列で残す（Web アプリ側は文字入力として見せる）。
function legacyDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  var full = /^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/.exec(s);
  if (full) return isoDate_(Number(full[1]), Number(full[2]), Number(full[3])) || s;
  var md = /^(\d{1,2})[\/\-.月](\d{1,2})日?$/.exec(s);
  if (md) {
    var m = Number(md[1]);
    return isoDate_(m >= 5 ? LEGACY_START_YEAR : LEGACY_START_YEAR + 1, m, Number(md[2])) || s;
  }
  return s;
}

function isoDate_(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

// 〇○◯⚪︎◎ → 〇、×✕✖ → ✕
function legacyMark_(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return '';
  if (/[〇○◯⚪◎]/.test(s)) return '〇';
  if (/[×✕✖]/.test(s)) return '✕';
  return s;
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

// ---- 智翔館AI：Google ドキュメントを作る ------------------------------------
// data.title と data.markdown（見出し・箇条書き・表・段落）から文書を作り、00_進行中/AI作成 に置いてURLを返す。
function createAiDoc_(data) {
  var title = String(data.title || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80);
  var md = String(data.markdown || '');
  if (!title || !md.trim()) return { ok: false, reason: 'empty' };
  if (md.length > 30000) return { ok: false, reason: 'too_long' };
  var folder;
  try { folder = aiOutputFolder_(); } catch (e) { return { ok: false, reason: 'folder_failed', detail: String(e).slice(0, 200) }; }

  var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  var name = stamp + '_AI作成_' + title;
  var doc;
  try { doc = DocumentApp.create(name); } catch (e) { return { ok: false, reason: 'create_failed', detail: String(e).slice(0, 200) }; }
  var body = doc.getBody();
  body.clear();
  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph('智翔館AIが作った下書きです（依頼：' + String(data.campus || '') + '／' + String(data.user || '') + '、' +
    Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') + '）。数字・日付・方針は担当者が確認してから使ってください。')
    .setItalic(true);
  aiAppendMarkdown_(body, md);
  // DocumentApp.create の最初の空段落を消す
  try { if (body.getNumChildren() > 1 && body.getChild(0).asText().getText() === '') body.removeChild(body.getChild(0)); } catch (e) {}
  doc.saveAndClose();

  var file = DriveApp.getFileById(doc.getId());
  folder.addFile(file);
  try { DriveApp.getRootFolder().removeFile(file); } catch (e) {}
  if (AI_OUTPUT_SHARING === 'view') file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  if (AI_OUTPUT_SHARING === 'edit') file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
  return { ok: true, saved: 'aiDoc', name: name, url: doc.getUrl() };
}

function aiOutputFolder_() {
  // 保存先（00_進行中）を開けないとき（このスクリプトの持ち主のアカウントから見えない等）は、
  // 持ち主のマイドライブ直下の「AI作成」フォルダに置く（無ければ作る）。
  try {
    var parent = DriveApp.getFolderById(AI_OUTPUT_PARENT_ID);
    var it = parent.getFoldersByName(AI_OUTPUT_FOLDER_NAME);
    return it.hasNext() ? it.next() : parent.createFolder(AI_OUTPUT_FOLDER_NAME);
  } catch (e) {
    var name = (typeof AI_OUTPUT_FOLDER_NAME === 'string' ? AI_OUTPUT_FOLDER_NAME : 'AI作成');
    var it2 = DriveApp.getFoldersByName(name);
    return it2.hasNext() ? it2.next() : DriveApp.createFolder(name);
  }
}

// 【診断用】エディタでこの関数を選んで実行し、「実行ログ」を見る。
// このスクリプトを動かしているアカウント、保存先・読めるフォルダが開けるか、試しに文書を1つ作れるかを表示する。
function testAiDrive() {
  var log = [];
  try { log.push('実行アカウント：' + Session.getEffectiveUser().getEmail()); } catch (e) { log.push('実行アカウント：取得できず'); }
  log.push('設定の有無：AI_OUTPUT_PARENT_ID=' + (typeof AI_OUTPUT_PARENT_ID) + '、AI_READ_FOLDER_IDS=' + (typeof AI_READ_FOLDER_IDS));
  try { log.push('保存先（00_進行中）：' + DriveApp.getFolderById(AI_OUTPUT_PARENT_ID).getName() + ' → 開けた'); }
  catch (e) { log.push('保存先（00_進行中）：開けない（' + e + '）'); }
  try {
    for (var i = 0; i < AI_READ_FOLDER_IDS.length; i++) {
      try { log.push('読めるフォルダ：' + DriveApp.getFolderById(AI_READ_FOLDER_IDS[i]).getName() + ' → 開けた'); }
      catch (e) { log.push('読めるフォルダ ' + AI_READ_FOLDER_IDS[i] + '：開けない（' + e + '）'); }
    }
  } catch (e) { log.push('読めるフォルダ：設定が読めない（' + e + '）'); }
  var r = createAiDoc_({ title: '動作確認（削除してよい）', markdown: '# 動作確認\n- 智翔館AIの文書作成テスト', campus: '診断', user: 'testAiDrive' });
  log.push('文書の作成：' + JSON.stringify(r));
  Logger.log(log.join('\n'));
  return log.join('\n');
}

// 素朴な Markdown（# 見出し、- 箇条書き、1. 番号、| 表 |、段落）を文書にする。**太字** の記号は外す。
function aiAppendMarkdown_(body, md) {
  var lines = md.replace(/\r\n/g, '\n').split('\n');
  var table = [];
  function clean(s) { return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'); }
  function flushTable() {
    if (!table.length) return;
    var rows = table.filter(function (r) { return !/^\s*\|?\s*:?-{2,}/.test(r.join('|')); });
    var cells = rows.map(function (r) { return r.map(function (c) { return clean(c.trim()); }); });
    var width = 0;
    cells.forEach(function (r) { width = Math.max(width, r.length); });
    cells = cells.map(function (r) { while (r.length < width) r.push(''); return r; });
    if (cells.length) {
      var t = body.appendTable(cells);
      try { for (var c = 0; c < width; c++) t.getRow(0).getCell(c).editAsText().setBold(true); } catch (e) {}
    }
    table = [];
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) {
      table.push(line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|'));
      continue;
    }
    flushTable();
    var m;
    if (!line.trim()) continue;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      var h = [DocumentApp.ParagraphHeading.HEADING1, DocumentApp.ParagraphHeading.HEADING2, DocumentApp.ParagraphHeading.HEADING3][m[1].length - 1];
      body.appendParagraph(clean(m[2])).setHeading(h);
    } else if ((m = /^\s*[-*・]\s+(.*)$/.exec(line))) {
      body.appendListItem(clean(m[1])).setGlyphType(DocumentApp.GlyphType.BULLET);
    } else if ((m = /^\s*\d+[.)．]\s+(.*)$/.exec(line))) {
      body.appendListItem(clean(m[1])).setGlyphType(DocumentApp.GlyphType.NUMBER);
    } else {
      body.appendParagraph(clean(line));
    }
  }
  flushTable();
}

// ---- 智翔館AI：Google ドライブのファイルを読む ---------------------------------
// data.id のファイルを、AI_READ_FOLDER_IDS の中にあるときだけ文字にして返す。
// Google ドキュメント・スプレッドシート・スライドは文字にする。
// Word・Excel・PowerPoint・PDF は中身（base64）を返し、アプリ側で文字にする。
function readDriveFile_(data) {
  if (!AI_READ_FOLDER_IDS.length) return { ok: false, reason: 'not_configured' };
  var id = String(data.id || '');
  if (!/^[\w-]{10,}$/.test(id)) return { ok: false, reason: 'bad_id' };
  var file;
  try { file = DriveApp.getFileById(id); } catch (e) { return { ok: false, reason: 'not_found' }; }
  var name = file.getName();
  var lower = name.toLowerCase();
  for (var w = 0; w < AI_READ_BLOCK_WORDS.length; w++) {
    if (lower.indexOf(AI_READ_BLOCK_WORDS[w].toLowerCase()) !== -1) return { ok: false, reason: 'blocked_name', name: name };
  }
  if (!aiReadAllowed_(file)) return { ok: false, reason: 'not_allowed', name: name };

  var mime = file.getMimeType();
  try {
    if (mime === MimeType.GOOGLE_DOCS) {
      return { ok: true, name: name, kind: 'doc', text: aiCap_(DocumentApp.openById(id).getBody().getText()) };
    }
    if (mime === MimeType.GOOGLE_SHEETS) {
      return { ok: true, name: name, kind: 'sheet', text: aiCap_(aiSheetText_(SpreadsheetApp.openById(id))) };
    }
    if (mime === MimeType.GOOGLE_SLIDES) {
      return { ok: true, name: name, kind: 'slides', text: aiCap_(aiSlidesText_(SlidesApp.openById(id))) };
    }
    var office = {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'application/pdf': 'pdf'
    }[mime];
    if (!office) return { ok: false, reason: 'unsupported', name: name, mime: mime };
    if (file.getSize() > AI_READ_MAX_BYTES) return { ok: false, reason: 'too_large', name: name };
    return { ok: true, name: name, kind: office, base64: Utilities.base64Encode(file.getBlob().getBytes()) };
  } catch (err) {
    return { ok: false, reason: 'read_failed', name: name };
  }
}

// data.id のフォルダが AI_READ_FOLDER_IDS の中（またはそのもの）なら、中身の一覧を返す（60件まで）。
// 名簿・成績などの語を含む名前は一覧にも出さない。
function listDriveFolder_(data) {
  if (!AI_READ_FOLDER_IDS.length) return { ok: false, reason: 'not_configured' };
  var id = String(data.id || '');
  if (!/^[\w-]{10,}$/.test(id)) return { ok: false, reason: 'bad_id' };
  var folder;
  try { folder = DriveApp.getFolderById(id); } catch (e) { return { ok: false, reason: 'not_found' }; }
  var name = folder.getName();
  if (AI_READ_FOLDER_IDS.indexOf(id) === -1 && !aiReadAllowed_(folder)) return { ok: false, reason: 'not_allowed', name: name };
  var items = [];
  var more = false;
  function blocked(n) {
    var l = n.toLowerCase();
    for (var w = 0; w < AI_READ_BLOCK_WORDS.length; w++) if (l.indexOf(AI_READ_BLOCK_WORDS[w].toLowerCase()) !== -1) return true;
    return false;
  }
  function fmt(d) { return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'); }
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    var f = subs.next();
    if (blocked(f.getName())) continue;
    if (items.length >= 60) { more = true; break; }
    items.push({ id: f.getId(), name: f.getName(), kind: 'フォルダ', updated: fmt(f.getLastUpdated()), folder: true });
  }
  var labels = {};
  labels[MimeType.GOOGLE_DOCS] = 'Googleドキュメント';
  labels[MimeType.GOOGLE_SHEETS] = 'Googleスプレッドシート';
  labels[MimeType.GOOGLE_SLIDES] = 'Googleスライド';
  labels['application/pdf'] = 'PDF';
  labels['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] = 'Word';
  labels['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] = 'Excel';
  labels['application/vnd.openxmlformats-officedocument.presentationml.presentation'] = 'PowerPoint';
  var files = folder.getFiles();
  while (!more && files.hasNext()) {
    var file = files.next();
    if (blocked(file.getName())) continue;
    if (items.length >= 60) { more = true; break; }
    items.push({ id: file.getId(), name: file.getName(), kind: labels[file.getMimeType()] || 'その他（' + file.getMimeType() + '）', updated: fmt(file.getLastUpdated()), folder: false });
  }
  return { ok: true, name: name, items: items, more: more };
}

// ファイルの親フォルダをさかのぼり、許可したフォルダの下にあるかを調べる。
function aiReadAllowed_(file) {
  var queue = [];
  var parents = file.getParents();
  while (parents.hasNext()) queue.push(parents.next());
  var seen = {};
  for (var depth = 0; depth < 30 && queue.length; depth++) {
    var next = [];
    for (var i = 0; i < queue.length; i++) {
      var f = queue[i];
      var fid = f.getId();
      if (seen[fid]) continue;
      seen[fid] = true;
      if (AI_READ_FOLDER_IDS.indexOf(fid) !== -1) return true;
      var ps = f.getParents();
      while (ps.hasNext()) next.push(ps.next());
    }
    queue = next;
  }
  return false;
}

function aiCap_(text) {
  text = String(text || '');
  return text.length <= AI_READ_MAX_CHARS ? text : text.slice(0, AI_READ_MAX_CHARS) + '\n\n（長いため ' + AI_READ_MAX_CHARS + ' 文字で切りました）';
}

// スプレッドシート：シートごとに、表示どおりの値をタブ区切りで（1シート300行・40列まで）。
function aiSheetText_(ss) {
  var out = [];
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    var rows = Math.min(sh.getLastRow(), 300);
    var cols = Math.min(sh.getLastColumn(), 40);
    var body = '（空）';
    if (rows > 0 && cols > 0) {
      var values = sh.getRange(1, 1, rows, cols).getDisplayValues();
      var lines = [];
      for (var r = 0; r < values.length; r++) {
        var line = values[r].join('\t').replace(/\t+$/, '');
        if (line) lines.push(line.replace(/\n/g, ' '));
      }
      body = lines.join('\n') + (sh.getLastRow() > 300 ? '\n（300行で切りました）' : '');
    }
    out.push('## シート「' + sh.getName() + '」\n' + body);
  }
  return out.join('\n\n');
}

// スライド：1枚ずつ、図形と表の文字、話す内容（ノート）を。
function aiSlidesText_(pres) {
  var out = [];
  var slides = pres.getSlides();
  for (var i = 0; i < slides.length; i++) {
    var texts = [];
    var els = slides[i].getPageElements();
    for (var j = 0; j < els.length; j++) {
      var el = els[j];
      var t = el.getPageElementType();
      if (t === SlidesApp.PageElementType.SHAPE) {
        var s = el.asShape().getText().asString().trim();
        if (s) texts.push(s);
      } else if (t === SlidesApp.PageElementType.TABLE) {
        var tb = el.asTable();
        for (var r = 0; r < tb.getNumRows(); r++) {
          var cells = [];
          for (var c = 0; c < tb.getNumColumns(); c++) {
            try { cells.push(tb.getCell(r, c).getText().asString().trim()); } catch (e) { cells.push(''); }
          }
          texts.push(cells.join(' | '));
        }
      }
    }
    var notes = '';
    try { notes = slides[i].getNotesPage().getSpeakerNotesShape().getText().asString().trim(); } catch (e) {}
    out.push('## スライド ' + (i + 1) + '\n' + (texts.join('\n') || '（文字なし）') + (notes ? '\n（ノート）' + notes : ''));
  }
  return out.join('\n\n');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
