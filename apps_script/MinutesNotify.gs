/**
 * 部門会議の議事録が保存されたら、社長へ LINE WORKS で「1枚まとめ」の PDF を送る。
 *
 * ■ 置き場所
 *   Code.gs と同じ Apps Script プロジェクト（「会議サポートアプリログ」スプレッドシートの
 *   拡張機能 > Apps Script）に、ファイルを1つ追加（＋ > スクリプト、名前 MinutesNotify）して丸ごと貼る。
 *   Web アプリの再デプロイは要らない（トリガーは保存済みのコードで動く）。
 *
 * ■ 流れ
 *   1. 10分ごとのトリガーで notifyMinutesToPresident が「部門会議議事録」シートを見る
 *   2. まだ送っていない議事録を、会議DX の /api/dept-minutes/digest に送る
 *      → AI が要点をまとめ、A4 1枚の PDF とトークの本文が返ってくる（lib/deptMinutesDigest*.ts）
 *   3. LINE WORKS Bot で社長の個別トークへ PDF → 本文の順に送る
 *   4. シートの「社長送付日時」に送った日時を書く
 *
 * ■ 送る議事録
 *   - 「社長送付日時」が空
 *   - 登録日時（「日時」列）が MINUTES_NOTIFY_SINCE 以降（既定 2026-11-02 0:00）
 *   - 最後の保存（「修正日時」、無ければ「日時」）から MINUTES_NOTIFY_DELAY_MIN 分たっている（既定 10 分）
 *     保存した直後に直して保存し直すことが多いので、直しが落ち着いてから送る
 *   - 失敗が 3 回未満（3 回失敗したら止まる。「社長送付メモ」を空にすると、また試す）
 *   送ったあとで直された議事録は、MINUTES_NOTIFY_RESEND_EDITS が true のときだけ「修正版」として送り直す。
 *   1 回の実行で送るのは 3 件まで（AI と PDF で 1 件 30〜60 秒かかるため）。残りは次の回に送る。
 *
 * ■ シートに足す列（「部門会議議事録」シートの右端。初回に自動で作る）
 *   社長送付日時  送った日時。空にすると次の回で送り直す
 *   社長送付メモ  結果・失敗の理由。「失敗(2) …」のように失敗回数を持つ
 *   Code.gs の保存（saveDeptMinutes_）は 13 列目（修正者）までしか書かないので、この 2 列は消えない。
 *
 * ■ 動くもの
 *   - notifyMinutesToPresident  10分ごとのトリガーから呼ばれる本体
 *   - setupMinutesNotify        設定の確認・列づくり・トリガーづくり（最初に1回だけ実行）
 *   - removeMinutesNotify       トリガーを消す（送付を止める）
 *   - previewMinutesDigest      最新の議事録のまとめ PDF を作ってマイドライブに保存する（送らない）
 *   - testMinutesNotify         最新の議事録のまとめを MINUTES_NOTIFY_TEST_USER_ID（自分など）にだけ送る。
 *                               PDF のアップロードと送信が通るかの確認用。社長には送らない
 *
 * ■ スクリプト プロパティ（プロジェクトの設定 > スクリプト プロパティ）
 *   APP_BASE_URL              会議DX の URL（例 https://meeting-support.vercel.app。末尾の / は不要）
 *   MINUTES_DIGEST_SECRET     会議DX（Vercel）の環境変数 MINUTES_DIGEST_SECRET と同じ値
 *   MINUTES_NOTIFY_USER_IDS   送り先（社長）の LINE WORKS ユーザーID。複数ならカンマ区切り
 *   LW_CLIENT_ID / LW_CLIENT_SECRET / LW_SERVICE_ACCOUNT / LW_PRIVATE_KEY / LW_BOT_ID
 *                             LINE WORKS のアプリと Bot。要項連絡（YokoNotify.gs）と同じ値をコピーしてよい
 *   MINUTES_LW_BOT_ID         （任意）議事録だけ別の Bot から送るとき
 *   MINUTES_NOTIFY_TEST_USER_ID （任意）testMinutesNotify の送り先
 *   MINUTES_NOTIFY_SINCE      （任意）これより前に登録された議事録は送らない（ISO 形式）。既定 2026-11-02T00:00:00+09:00
 *   MINUTES_NOTIFY_DELAY_MIN  （任意）保存から送るまでの待ち時間（分）。既定 10
 *   MINUTES_NOTIFY_RESEND_EDITS （任意）true にすると、送ったあとで直された議事録を「修正版」として送り直す
 *   MINUTES_PDF_FOLDER_ID     （任意）送った PDF の控えを保存する Google ドライブのフォルダ ID
 */

var MN_SHEET = '部門会議議事録';
var MN_SENT = '社長送付日時';
var MN_MEMO = '社長送付メモ';
var MN_DEFAULT_SINCE = '2026-11-02T00:00:00+09:00';
var MN_MAX_FAILS = 3;
var MN_MAX_PER_RUN = 3;
var MN_RUNNING_KEY = 'MN_RUNNING_AT';
var MN_RUNNING_MS = 8 * 60 * 1000;

// ------------------------------------------------------------
// トリガーの本体
// ------------------------------------------------------------

function notifyMinutesToPresident() {
  // 前の回がまだ動いていれば見送る。Code.gs の保存処理が使うスクリプトロックは握らない
  //（ここは 1 件に数十秒かかるので、握ると議事録の保存が待たされて失敗する）。
  var props = PropertiesService.getScriptProperties();
  var running = Number(props.getProperty(MN_RUNNING_KEY) || 0);
  if (running && Date.now() - running < MN_RUNNING_MS) return;
  props.setProperty(MN_RUNNING_KEY, String(Date.now()));
  try {
    var cfg = mnConfig_(true);
    var sh = mnSheet_();
    var cols = mnColumns_(sh);
    var values = sh.getDataRange().getValues();
    var now = Date.now();
    var done = 0;
    for (var r = 1; r < values.length && done < MN_MAX_PER_RUN; r++) {
      var job = mnJob_(values[r], cols, cfg, now);
      if (!job) continue;
      done++;
      mnProcess_(sh, r + 1, values[r], cols, cfg, job);
    }
  } finally {
    props.deleteProperty(MN_RUNNING_KEY);
  }
}

/** 送るべき行なら { revised } を返す。送らない行は null。 */
function mnJob_(row, cols, cfg, now) {
  if (!String(row[cols['議事録']] || '').trim()) return null;
  var created = mnTime_(row[cols['日時']]);
  if (isNaN(created) || created < cfg.since) return null;
  var edited = mnTime_(row[cols['修正日時']]);
  var last = isNaN(edited) ? created : Math.max(created, edited);
  if (now - last < cfg.delayMin * 60 * 1000) return null; // 直している最中かもしれないので待つ
  if (mnFails_(row[cols[MN_MEMO]]) >= MN_MAX_FAILS) return null;
  var sentAt = mnTime_(row[cols[MN_SENT]]);
  if (isNaN(sentAt)) return { revised: false };
  if (cfg.resendEdits && !isNaN(edited) && edited > sentAt) return { revised: true };
  return null;
}

function mnProcess_(sh, rowNo, row, cols, cfg, job) {
  var id = String(row[cols['議事録ID']] || '');
  var title = String(row[cols['会議名']] || '');
  try {
    var digest = mnDigest_(cfg, row, cols, job.revised);
    var blob = Utilities.newBlob(Utilities.base64Decode(digest.pdf), 'application/pdf', digest.fileName);
    if (cfg.folderId) {
      try {
        DriveApp.getFolderById(cfg.folderId).createFile(blob.copyBlob());
      } catch (e) {
        Logger.log('PDF の控えを保存できませんでした: ' + e);
      }
    }
    var result = mnDeliver_(cfg, cfg.userIds, blob, digest.message);
    var target = mnFindRow_(sh, cols, rowNo, id);
    if (!target) throw new Error('送付後に行が見つかりません（議事録ID ' + id + '）');
    sh.getRange(target, cols[MN_SENT] + 1).setValue(new Date()).setNumberFormat('yyyy/MM/dd HH:mm');
    sh.getRange(target, cols[MN_MEMO] + 1).setValue(
      (job.revised ? '修正版を送付' : '送付') + '（' + digest.pages + '枚・' + digest.fontSize + 'pt）' + result.note
    );
    Logger.log('送付しました: ' + title + '（' + id + '）' + result.note);
  } catch (e) {
    var fails = mnFails_(row[cols[MN_MEMO]]) + 1;
    var t = mnFindRow_(sh, cols, rowNo, id);
    if (t) {
      sh.getRange(t, cols[MN_MEMO] + 1).setValue(
        '失敗(' + fails + ') ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MM/dd HH:mm') + ' ' + String(e.message || e).slice(0, 300)
      );
    }
    Logger.log('送付に失敗: ' + title + '（' + id + '）' + e);
  }
}

/** 会議DX にまとめを作ってもらう。 */
function mnDigest_(cfg, row, cols, revised) {
  var payload = {
    id: String(row[cols['議事録ID']] || ''),
    ts: mnIso_(row[cols['日時']]),
    campus: String(row[cols['部門']] || ''),
    user: String(row[cols['入力者']] || ''),
    title: String(row[cols['会議名']] || ''),
    date: mnCell_(row[cols['開催日時']]),
    place: String(row[cols['場所']] || ''),
    attendees: String(row[cols['出席者']] || ''),
    agenda: String(row[cols['予定議題']] || ''),
    minutes: String(row[cols['議事録']] || ''),
    quality: String(row[cols['会議の質チェック']] || ''),
    editedAt: mnIso_(row[cols['修正日時']]),
    editedBy: String(row[cols['修正者']] || ''),
    revised: revised === true,
  };
  var res = UrlFetchApp.fetch(cfg.baseUrl + '/api/dept-minutes/digest', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var j = null;
  try {
    j = JSON.parse(res.getContentText());
  } catch (e) {}
  if (code !== 200 || !j || j.ok !== true || !j.pdf) {
    throw new Error('まとめを作れませんでした（' + code + ' ' + ((j && j.reason) || res.getContentText().slice(0, 120)) + '）');
  }
  return j;
}

/** 送り先それぞれに PDF → 本文の順で送る。全員に失敗したら例外。 */
function mnDeliver_(cfg, userIds, blob, message) {
  var token = mnLwToken_();
  var errors = [];
  var ok = 0;
  userIds.forEach(function (uid) {
    try {
      // 先に PDF を送る。ここで失敗すれば何も届いていないので、次の回にそのままやり直せる。
      var fileId = mnLwUpload_(token, cfg.botId, blob);
      mnLwSend_(token, cfg.botId, uid, { type: 'file', fileId: fileId });
      try {
        mnLwSend_(token, cfg.botId, uid, { type: 'text', text: message });
      } catch (e) {
        // PDF は届いているので送付済みにする（やり直すと PDF が二重に届く）。
        errors.push(uid + ': 本文の送信に失敗（PDF は送付済み）' + e);
      }
      ok++;
    } catch (e) {
      errors.push(uid + ': ' + e);
    }
  });
  if (!ok) throw new Error(errors.join(' / '));
  return { note: errors.length ? ' ※一部失敗: ' + errors.join(' / ').slice(0, 200) : '' };
}

// ------------------------------------------------------------
// 設定・確認用（Apps Script エディタから実行する）
// ------------------------------------------------------------

/** 最初に1回だけ実行する。設定を確かめ、列とトリガーを作り、次の回に送る予定の議事録をログに出す。 */
function setupMinutesNotify() {
  var cfg = mnConfig_(true);
  var sh = mnSheet_();
  var cols = mnColumns_(sh);
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'notifyMinutesToPresident';
  });
  if (!exists) {
    ScriptApp.newTrigger('notifyMinutesToPresident').timeBased().everyMinutes(10).create();
    Logger.log('10分ごとのトリガーを作りました。');
  } else {
    Logger.log('トリガーは既にあります（作り直していません）。');
  }
  var values = sh.getDataRange().getValues();
  var now = Date.now();
  var pending = [];
  for (var r = 1; r < values.length; r++) {
    var job = mnJob_(values[r], cols, cfg, now);
    if (job) pending.push(mnCell_(values[r][cols['開催日時']]) + ' ' + values[r][cols['会議名']] + (job.revised ? '（修正版）' : ''));
  }
  Logger.log('送り先: ' + cfg.userIds.join(', ') + ' ／ 対象: ' +
    Utilities.formatDate(new Date(cfg.since), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') + ' 以降に登録された議事録');
  Logger.log('次の回に送る予定: ' + (pending.length ? pending.length + '件 ' + pending.join(' ／ ') : 'なし'));
}

/** 送付を止める（トリガーを消す）。 */
function removeMinutesNotify() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'notifyMinutesToPresident') {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  Logger.log('トリガーを ' + n + ' 件消しました。');
}

/** 最新の議事録のまとめ PDF を作ってマイドライブに保存する（LINE WORKS には送らない）。 */
function previewMinutesDigest() {
  var cfg = mnConfig_(false);
  var latest = mnLatest_();
  var d = mnDigest_(cfg, latest.row, latest.cols, false);
  var file = DriveApp.createFile(Utilities.newBlob(Utilities.base64Decode(d.pdf), 'application/pdf', d.fileName));
  Logger.log('作りました（' + d.pages + '枚・' + d.fontSize + 'pt）: ' + file.getUrl());
  Logger.log('トークの本文:\n' + d.message);
}

/** 最新の議事録のまとめを MINUTES_NOTIFY_TEST_USER_ID にだけ送る（社長には送らない。シートにも書かない）。 */
function testMinutesNotify() {
  var cfg = mnConfig_(false);
  var testUser = mnProp_('MINUTES_NOTIFY_TEST_USER_ID');
  if (!testUser) throw new Error('MINUTES_NOTIFY_TEST_USER_ID（テストの送り先。自分の LINE WORKS ユーザーID）を設定してください');
  var latest = mnLatest_();
  var d = mnDigest_(cfg, latest.row, latest.cols, false);
  var blob = Utilities.newBlob(Utilities.base64Decode(d.pdf), 'application/pdf', d.fileName);
  var r = mnDeliver_(cfg, [testUser], blob, '【接続テスト】\n' + d.message);
  Logger.log('送りました: ' + testUser + r.note);
}

// ------------------------------------------------------------
// シートの読み書き
// ------------------------------------------------------------

function mnSheet_() {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(MN_SHEET);
  if (!sh) throw new Error('「' + MN_SHEET + '」シートがありません');
  return sh;
}

/** 見出し名 → 列番号（0始まり）。送付の2列が無ければ右端に足す。 */
function mnColumns_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v || '').trim(); });
  [MN_SENT, MN_MEMO].forEach(function (name) {
    if (head.indexOf(name) === -1) {
      // Code.gs の列（DEPT_MINUTES_HEADERS）より右で、最初に見出しが空いている列に置く。
      var i = DEPT_MINUTES_HEADERS.length;
      while (i < head.length && head[i]) i++;
      sh.getRange(1, i + 1).setValue(name).setFontWeight('bold');
      while (head.length <= i) head.push('');
      head[i] = name;
    }
  });
  var cols = {};
  head.forEach(function (h, i) { if (h && cols[h] === undefined) cols[h] = i; });
  ['日時', '会議名', '議事録', '議事録ID', '修正日時'].forEach(function (k) {
    if (cols[k] === undefined) throw new Error('「' + MN_SHEET + '」シートに「' + k + '」列がありません');
  });
  return cols;
}

/** 書き込む直前に、その行がまだ同じ議事録か確かめる（ずれていたら議事録ID で探し直す）。 */
function mnFindRow_(sh, cols, rowNo, id) {
  if (!id) return rowNo;
  var idCol = cols['議事録ID'] + 1;
  if (String(sh.getRange(rowNo, idCol).getValue()) === id) return rowNo;
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, idCol, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

/** いちばん新しく登録された議事録（確認用）。 */
function mnLatest_() {
  var sh = mnSheet_();
  var cols = mnColumns_(sh);
  var values = sh.getDataRange().getValues();
  var best = null;
  var bestT = -Infinity;
  for (var r = 1; r < values.length; r++) {
    if (!String(values[r][cols['議事録']] || '').trim()) continue;
    var t = mnTime_(values[r][cols['日時']]);
    if (!isNaN(t) && t >= bestT) { bestT = t; best = values[r]; }
  }
  if (!best) throw new Error('議事録がまだありません');
  return { row: best, cols: cols };
}

function mnTime_(v) {
  if (v instanceof Date) return v.getTime();
  var s = String(v == null ? '' : v).trim();
  if (!s) return NaN;
  var t = Date.parse(s);
  if (!isNaN(t)) return t;
  // 'yyyy/MM/dd HH:mm' など（日本時間として読む）
  var m = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], (m[4] ? +m[4] : 0) - 9, m[5] ? +m[5] : 0);
}

function mnIso_(v) {
  var t = mnTime_(v);
  return isNaN(t) ? '' : new Date(t).toISOString();
}

/** 開催日時のセル。日付として入っていれば 'yyyy/MM/dd HH:mm'、文字ならそのまま。 */
function mnCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  return String(v == null ? '' : v);
}

function mnFails_(memo) {
  var m = /^失敗\((\d+)\)/.exec(String(memo || ''));
  return m ? Number(m[1]) : 0;
}

// ------------------------------------------------------------
// 設定
// ------------------------------------------------------------

function mnProp_(key) {
  return String(PropertiesService.getScriptProperties().getProperty(key) || '').trim();
}

function mnConfig_(needRecipients) {
  var missing = [];
  var baseUrl = mnProp_('APP_BASE_URL').replace(/\/+$/, '');
  var secret = mnProp_('MINUTES_DIGEST_SECRET');
  var botId = mnProp_('MINUTES_LW_BOT_ID') || mnProp_('LW_BOT_ID');
  var userIds = mnProp_('MINUTES_NOTIFY_USER_IDS').split(/[,、\s]+/).filter(Boolean);
  if (!baseUrl) missing.push('APP_BASE_URL');
  if (!secret) missing.push('MINUTES_DIGEST_SECRET');
  if (!botId) missing.push('LW_BOT_ID');
  if (needRecipients && !userIds.length) missing.push('MINUTES_NOTIFY_USER_IDS');
  if (missing.length) throw new Error('スクリプト プロパティが未設定です: ' + missing.join(', '));
  var since = Date.parse(mnProp_('MINUTES_NOTIFY_SINCE') || MN_DEFAULT_SINCE);
  if (isNaN(since)) throw new Error('MINUTES_NOTIFY_SINCE が読めません（例 2026-11-02T00:00:00+09:00）');
  var delay = Number(mnProp_('MINUTES_NOTIFY_DELAY_MIN') || 10);
  return {
    baseUrl: baseUrl,
    secret: secret,
    botId: botId,
    userIds: userIds,
    since: since,
    delayMin: isNaN(delay) || delay < 0 ? 10 : delay,
    resendEdits: /^(true|1|yes|はい)$/i.test(mnProp_('MINUTES_NOTIFY_RESEND_EDITS')),
    folderId: mnProp_('MINUTES_PDF_FOLDER_ID'),
  };
}

// ------------------------------------------------------------
// LINE WORKS Bot（API 2.0 / Service Account 認証）
// 認証まわりは YokoNotify.gs と同じ作り（別プロジェクトなので関数は共有できない）。
// ------------------------------------------------------------

function mnLwFetch_(url, token, body) {
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('LINE WORKS ' + code + ': ' + res.getContentText().slice(0, 200));
  var text = res.getContentText();
  return text ? JSON.parse(text) : {};
}

function mnLwSend_(token, botId, userId, content) {
  mnLwFetch_('https://www.worksapis.com/v1.0/bots/' + botId + '/users/' + encodeURIComponent(userId) + '/messages', token, { content: content });
}

/** ファイルを LINE WORKS に上げて fileId を返す（アップロード URL をもらう → そこへ multipart で送る）。 */
function mnLwUpload_(token, botId, blob) {
  var meta = mnLwFetch_('https://www.worksapis.com/v1.0/bots/' + botId + '/attachments', token, { fileName: blob.getName() });
  if (!meta.uploadUrl) throw new Error('LINE WORKS のアップロード URL が返りませんでした');
  var res = UrlFetchApp.fetch(meta.uploadUrl, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    payload: { resourceName: blob.getName(), FileData: blob },
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('LINE WORKS アップロード ' + code + ': ' + res.getContentText().slice(0, 200));
  var j = {};
  try { j = JSON.parse(res.getContentText() || '{}'); } catch (e) {}
  var fileId = j.fileId || meta.fileId;
  if (!fileId) throw new Error('LINE WORKS の fileId が返りませんでした');
  return fileId;
}

/** Service Account の JWT でアクセストークンを取る。6時間キャッシュ（有効期限は24時間）。 */
function mnLwToken_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('mn_lw_token');
  if (cached) return cached;
  var clientId = mnProp_('LW_CLIENT_ID');
  var clientSecret = mnProp_('LW_CLIENT_SECRET');
  var serviceAccount = mnProp_('LW_SERVICE_ACCOUNT');
  var privateKey = mnNormalizePem_(PropertiesService.getScriptProperties().getProperty('LW_PRIVATE_KEY'));
  if (!clientId || !clientSecret || !serviceAccount || !privateKey) {
    throw new Error('LW_CLIENT_ID / LW_CLIENT_SECRET / LW_SERVICE_ACCOUNT / LW_PRIVATE_KEY が未設定です');
  }
  var now = Math.floor(Date.now() / 1000);
  var header = mnBase64Url_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var claims = mnBase64Url_(JSON.stringify({ iss: clientId, sub: serviceAccount, iat: now, exp: now + 3600 }));
  var signature = mnBase64Url_(Utilities.computeRsaSha256Signature(header + '.' + claims, privateKey));
  var res = UrlFetchApp.fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
    method: 'post',
    payload: {
      assertion: header + '.' + claims + '.' + signature,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'bot',
    },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('LINE WORKS 認証失敗 ' + res.getResponseCode() + ': ' + res.getContentText());
  var token = JSON.parse(res.getContentText()).access_token;
  if (!token) throw new Error('LINE WORKS 認証応答に access_token がありません');
  cache.put('mn_lw_token', token, 21600);
  return token;
}

/** 貼られた秘密鍵を PEM の形に整える（改行が消えた・\n で書いた・引用符付きでも読める）。 */
function mnNormalizePem_(raw) {
  var s = String(raw || '').trim();
  s = s.replace(/^["']+|["']+$/g, '');
  s = s.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\r\n?/g, '\n');
  var type = 'PRIVATE KEY';
  var m = /-----BEGIN ([A-Z ]+?)-----/.exec(s);
  if (m) type = m[1];
  var body = s.replace(/-----BEGIN [A-Z ]+?-----/g, '').replace(/-----END [A-Z ]+?-----/g, '').replace(/[^A-Za-z0-9+\/=]/g, '');
  if (!body) return '';
  var lines = [];
  for (var i = 0; i < body.length; i += 64) lines.push(body.substr(i, 64));
  return '-----BEGIN ' + type + '-----\n' + lines.join('\n') + '\n-----END ' + type + '-----\n';
}

function mnBase64Url_(v) {
  var s = typeof v === 'string' ? Utilities.base64EncodeWebSafe(v, Utilities.Charset.UTF_8) : Utilities.base64EncodeWebSafe(v);
  return s.replace(/=+$/, '');
}
