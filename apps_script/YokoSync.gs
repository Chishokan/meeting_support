/**
 * 智翔館 会議DX — 要項の「確定」検知（Apps Script）
 * -------------------------------------------------------
 * 要項ドキュメント（Google ドキュメント）の各タブを見て、
 * ＜基本情報＞の「ステータス：確定」になっているタブの組が前回から変わっていたら、
 * GitHub の repository_dispatch を叩いて sync-yoko ワークフローを起動する。
 *
 * これが無くても sync-yoko は毎日 03:00 JST に走る。
 * この仕組みは「確定にしたら1時間以内に反映される」ようにするための追加部品。
 *
 * 【セットアップ】
 * 1. このファイルを Code.gs と同じ Apps Script プロジェクトに追加する（別ファイルでよい）。
 * 2. 下の YOKO_DOC_ID に要項ドキュメントの ID を入れる（URL の /d/ と /edit の間）。
 * 3. プロジェクトの設定 → スクリプト プロパティに GITHUB_TOKEN を追加する。
 *    GitHub の fine-grained personal access token で、対象リポジトリに
 *    「Contents: Read and write」だけを付けたもの（repository_dispatch に必要な最小権限）。
 * 4. エディタで installYokoTrigger() を一度実行する（1時間おきの時間主導トリガーが入る）。
 *    ※ 実行時に Docs と外部接続の権限承認が出るので許可する。
 * 5. 動作確認: checkYokoConfirmed() を手で実行し、ログに「dispatch 送信」または「変更なし」が出れば OK。
 */

var YOKO_DOC_ID = '';
var GITHUB_REPO = 'Chishokan/meeting_support';
var YOKO_PROP_KEY = 'YOKO_CONFIRMED_DIGEST';

// 1時間おきに checkYokoConfirmed() を走らせるトリガーを入れる（重複しないよう既存は消す）。
function installYokoTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkYokoConfirmed') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('checkYokoConfirmed').timeBased().everyHours(1).create();
  Logger.log('checkYokoConfirmed を1時間おきに実行するトリガーを設定しました');
}

// タブを再帰的に集める（子タブも含む）。
function collectTabs_(tabs, out) {
  for (var i = 0; i < tabs.length; i++) {
    out.push(tabs[i]);
    try {
      var kids = tabs[i].getChildTabs ? tabs[i].getChildTabs() : null;
      if (kids && kids.length) collectTabs_(kids, out);
    } catch (e) {}
  }
  return out;
}

// タブ本文から「ステータス：〜」の値を取る。欄が無ければ null。
function statusOf_(text) {
  var m = /ステータス[ \t　]*[：:][ \t　]*([^\n]*)/.exec(text);
  if (!m) return null;
  return m[1].replace(/←.*$/, '').replace(/\*/g, '').trim();
}

function digest_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

// 「確定」タブの一覧（タブ名＋本文ハッシュ）を前回と比べ、変わっていれば GitHub を起動する。
function checkYokoConfirmed() {
  if (!YOKO_DOC_ID) throw new Error('YOKO_DOC_ID が未設定です');

  var doc = DocumentApp.openById(YOKO_DOC_ID);
  var tabs = collectTabs_(doc.getTabs(), []);
  var confirmed = [];
  for (var i = 0; i < tabs.length; i++) {
    var title = '';
    var text = '';
    try {
      title = tabs[i].getTitle();
      text = tabs[i].asDocumentTab().getBody().getText();
    } catch (e) {
      continue;
    }
    if (/^[_＿]/.test(title) || title.indexOf('テンプレート') !== -1) continue;
    var st = statusOf_(text);
    if (st && st.indexOf('確定') !== -1) confirmed.push(title + '|' + digest_(text));
  }
  confirmed.sort();
  var now = digest_(confirmed.join('\n'));

  var props = PropertiesService.getScriptProperties();
  var prev = props.getProperty(YOKO_PROP_KEY) || '';
  if (now === prev) {
    Logger.log('変更なし（確定 ' + confirmed.length + ' 件）');
    return;
  }

  dispatchGithub_({ confirmed: confirmed.length, at: new Date().toISOString() });
  props.setProperty(YOKO_PROP_KEY, now);
  Logger.log('dispatch 送信（確定 ' + confirmed.length + ' 件）');
}

function dispatchGithub_(payload) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('スクリプト プロパティ GITHUB_TOKEN が未設定です');
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + GITHUB_REPO + '/dispatches', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    payload: JSON.stringify({ event_type: 'yoko-confirmed', client_payload: payload }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code !== 204) throw new Error('GitHub dispatch 失敗: ' + code + ' ' + res.getContentText().slice(0, 300));
}
