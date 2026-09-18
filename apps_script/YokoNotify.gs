/**
 * 要項の「確定」「金額訂正」「経理記入完了」を検知して LINE WORKS Bot で経理へ連絡する。
 *
 * ■ 置き場所
 *   要項テンプレートの Google ドキュメント（04要項 フォルダの「有料講座_要項テンプレート（記入用）」
 *   「無料講座_要項テンプレート（記入用）」）それぞれに、コンテナバインド（拡張機能 > Apps Script）で
 *   このファイルを丸ごと貼る。メニューは両方のドキュメントに出る。
 *   1日1回の走査トリガーは「どちらか片方のドキュメント」にだけ設定する（両方に設定すると2回走る）。
 *
 * ■ 動くもの
 *   - onOpen         ドキュメントを開いたときにメニュー「要項連絡」を出す
 *   - notifyCurrentTab  メニュー「このタブを今すぐ確認して連絡」。編集直後に担当者が押す更新ボタン
 *   - dailyScan      時間主導トリガー（1日1回）で 04要項 フォルダの全ドキュメント・全タブを走査
 *   - scanAllNow     メニュー「全要項を確認して連絡」。dailyScan を手動で回す
 *   - setupDailyTrigger  トリガーを作る（1回だけ実行）
 *   - seedLedger     初回に台帳だけ作る（通知しない）。既に確定している要項を今さら通知したくないとき
 *   - testLineWorks  LINE WORKS の設定確認（テスト送信）
 *   - checkPrivateKey  LW_PRIVATE_KEY の形を診断してログに出す（鍵そのものは出さない）
 *
 * ■ 検知する出来事（要項台帳シートの前回値と比べる）
 *   確定        ステータスが「確定」になった            → 経理へ「経理記入欄を埋めてください」
 *   金額訂正    確定済みのまま金額に関わる節が変わった  → 経理へ【至急】。変わった行を前後で示す
 *   経理記入完了  経理記入欄の「経理記入日」が入った      → 講座担当へ「経理側の記入が終わった」
 *   確定取り下げ  確定 → 下書き に戻った                  → 経理へ「請求処理を止めてください」
 *   リマインド  経理記入待ちのまま REMIND_HOURS 経過     → 経理へ再通知（走査のたび）
 *
 *   「金額に関わる節」＝ ＜受講料＞ 全体、＜申込＞の「■ 支払い方法」、＜経理連絡事項＞の
 *   「■ 講座担当が記入」（「■ 経理記入欄」より前）。経理が経理記入欄を書いても金額訂正にはならない。
 *
 * ■ スクリプト プロパティ（プロジェクトの設定 > スクリプト プロパティ）
 *   LW_CLIENT_ID        LINE WORKS Developer Console のアプリ Client ID
 *   LW_CLIENT_SECRET    同 Client Secret
 *   LW_SERVICE_ACCOUNT  同 Service Account（xxxx@yyyy の形）
 *   LW_PRIVATE_KEY      同 Private Key。Developer Console からダウンロードした private_xxxx.key の中身
 *                       （-----BEGIN PRIVATE KEY----- で始まり -----END PRIVATE KEY----- で終わる）。
 *                       改行が消えて1行になっていても、改行が文字の「\n」になっていても、
 *                       前後に引用符が付いていても読めるように整形してから使う（normalizePem_）。
 *                       うまくいかないときは checkPrivateKey を実行するとログに診断が出る。
 *   LW_BOT_ID           通知を送る Bot の ID
 *   LW_CHANNEL_ID       通知先トークルーム（経理＋各部門担当が入っている部屋）の Channel ID
 *   YOKO_FOLDER_ID      （任意）走査するフォルダ。既定は 04要項
 *   LEDGER_SPREADSHEET_ID （自動）要項台帳のスプレッドシート ID。初回走査で作られる
 *   REMIND_HOURS        （任意）経理記入待ちの再通知までの時間。既定 20
 *
 * ■ 台帳スプレッドシート「要項台帳」（04要項 フォルダに自動作成）
 *   シート「台帳」   タブごとの前回値。手で直さない（通知が二重になる／出なくなる）
 *   シート「担当者」 A列＝要項の「作成者」に書く名前、B列＝LINE WORKS のユーザーID。
 *                    書いておくと、その人に個別トークでも届く。空でも動く（部屋への通知のみ）
 *
 * ■ テストのしかた（GAS 側）
 *   testLineWorks を実行 → 部屋に「接続テスト」が届けば設定は正しい。
 *   parse/diff の純粋関数は scripts/test-yoko-notify.mjs で Node からも確認できる。
 */

var YOKO_DEFAULT_FOLDER_ID = '1IwwmmjAqh7yznmtOgFSkTDZrNS3_x-L5'; // 14_教務運営 > 04要項
var LEDGER_NAME = '要項台帳';
var LEDGER_SHEET = '台帳';
var STAFF_SHEET = '担当者';
var LEDGER_HEADERS = [
  'docId', 'tabId', '講座名', '講座区分', 'ステータス', '作成者',
  '金額ハッシュ', '金額本文', '経理記入日', '経理確認',
  '最終確認日時', '最終通知日時', '最終通知種別', '更新履歴', 'リンク',
];

// ------------------------------------------------------------
// メニュー・トリガー
// ------------------------------------------------------------

function onOpen() {
  DocumentApp.getUi()
    .createMenu('要項連絡')
    .addItem('このタブを今すぐ確認して連絡', 'notifyCurrentTab')
    .addItem('全要項を確認して連絡', 'scanAllNow')
    .addSeparator()
    .addItem('LINE WORKS 接続テスト', 'testLineWorks')
    .addToUi();
}

/** 1回だけ実行する。毎日 9〜10 時に dailyScan を回すトリガーを作る（重複は作らない）。 */
function setupDailyTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'dailyScan';
  });
  if (exists) {
    Logger.log('dailyScan のトリガーは既にあります');
    return;
  }
  ScriptApp.newTrigger('dailyScan').timeBased().everyDays(1).atHour(9).create();
  Logger.log('dailyScan のトリガーを作りました（毎日 9〜10 時）');
}

/**
 * 初回セットアップ用。全タブを走査して台帳に現在値を記録するだけで、通知は送らない。
 * これを先に実行しておくと、次の走査からは「変わったもの」だけが通知される。
 */
function seedLedger() {
  var result = scanFolder_({ seed: true });
  Logger.log('台帳に ' + result.checked + ' 件を記録しました（通知なし）');
  return result;
}

/** 時間主導トリガーから呼ばれる。フォルダ内の全ドキュメント・全タブを走査して通知する。 */
function dailyScan() {
  var result = scanFolder_({ force: false });
  Logger.log(JSON.stringify(result));
  return result;
}

/** メニュー「全要項を確認して連絡」。 */
function scanAllNow() {
  var result = scanFolder_({ force: false });
  var ui = DocumentApp.getUi();
  var lines = [
    '確認したタブ: ' + result.checked + ' 件',
    '通知: ' + result.notified + ' 件',
  ];
  if (result.events.length) lines.push('', result.events.join('\n'));
  if (result.errors.length) lines.push('', 'エラー:', result.errors.join('\n'));
  ui.alert('要項の確認が終わりました', lines.join('\n'), ui.ButtonSet.OK);
}

/**
 * メニュー「このタブを今すぐ確認して連絡」＝更新ボタン。
 * 開いているタブだけを台帳と比べ、変化があればその通知を送る。
 * 変化が無いときは、それでも送るか聞いてから「手動連絡」を送る。
 */
function notifyCurrentTab() {
  var ui = DocumentApp.getUi();
  var doc = DocumentApp.getActiveDocument();
  var tab = doc.getActiveTab();
  if (!tab || tab.getType() !== DocumentApp.TabType.DOCUMENT_TAB) {
    ui.alert('要項のタブを開いた状態で実行してください。');
    return;
  }
  var ledger = openLedger_();
  var rows = readLedger_(ledger);
  var info = parseYoko_(tab.asDocumentTab().getBody().getText());
  if (info.isTemplate) {
    ui.alert('このタブはテンプレート本体（講座名が空）なので連絡しません。複製したタブで実行してください。');
    return;
  }
  var key = doc.getId() + '|' + tab.getId();
  var link = docTabUrl_(doc.getId(), tab.getId());
  var events = detectEvents_(rows[key] || null, info);

  if (events.length === 0) {
    var ans = ui.alert(
      '前回の連絡から変わっていません',
      '「' + info.title + '」は前回の連絡内容（ステータス・金額）から変化がありません。\n' +
        'それでも経理へ連絡を送りますか？（現在の経理連絡事項を送ります）',
      ui.ButtonSet.YES_NO
    );
    if (ans !== ui.Button.YES) return;
    events = ['手動連絡'];
  }

  var sent = [];
  events.forEach(function (ev) {
    var msg = buildMessage_(ev, info, rows[key] || null, link);
    sendLineWorks_(msg, info, ev);
    sent.push(ev);
  });
  rows[key] = nextRow_(rows[key] || null, doc.getId(), tab.getId(), info, link, sent);
  writeLedger_(ledger, rows);
  ui.alert('経理へ連絡しました', sent.join('、') + '\n' + info.title, ui.ButtonSet.OK);
}

// ------------------------------------------------------------
// 走査
// ------------------------------------------------------------

function scanFolder_(opt) {
  var folderId = prop_('YOKO_FOLDER_ID') || YOKO_DEFAULT_FOLDER_ID;
  var folder = DriveApp.getFolderById(folderId);
  var ledger = openLedger_();
  var rows = readLedger_(ledger);
  var result = { checked: 0, notified: 0, events: [], errors: [] };

  var files = folder.getFilesByType(MimeType.GOOGLE_DOCS);
  while (files.hasNext()) {
    var file = files.next();
    var doc;
    try {
      doc = DocumentApp.openById(file.getId());
    } catch (e) {
      result.errors.push(file.getName() + ': ' + e);
      continue;
    }
    var tabs = flattenTabs_(doc.getTabs());
    tabs.forEach(function (tab) {
      var title = tab.getTitle() || '';
      if (isTemplateTabTitle_(title)) return;
      var info;
      try {
        info = parseYoko_(tab.asDocumentTab().getBody().getText());
      } catch (e) {
        result.errors.push(file.getName() + ' / ' + title + ': ' + e);
        return;
      }
      if (info.isTemplate) return;
      result.checked++;
      var key = doc.getId() + '|' + tab.getId();
      var link = docTabUrl_(doc.getId(), tab.getId());
      var prev = rows[key] || null;
      var events = opt && opt.seed ? [] : detectEvents_(prev, info);
      if (!(opt && opt.seed) && events.length === 0 && needsReminder_(prev)) events = ['リマインド'];
      var sent = [];
      events.forEach(function (ev) {
        try {
          var msg = buildMessage_(ev, info, prev, link);
          sendLineWorks_(msg, info, ev);
          sent.push(ev);
          result.notified++;
          result.events.push(ev + '：' + info.title);
        } catch (e) {
          result.errors.push(info.title + '（' + ev + '）: ' + e);
        }
      });
      // 送れなかった出来事があるときは台帳を進めない（次の走査で同じ変化をもう一度拾って再送する）
      if (events.length && sent.length !== events.length) return;
      rows[key] = nextRow_(prev, doc.getId(), tab.getId(), info, link, sent);
    });
  }
  writeLedger_(ledger, rows);
  return result;
}

function flattenTabs_(tabs) {
  var out = [];
  (tabs || []).forEach(function (t) {
    if (t.getType() === DocumentApp.TabType.DOCUMENT_TAB) out.push(t);
    out = out.concat(flattenTabs_(t.getChildTabs()));
  });
  return out;
}

function docTabUrl_(docId, tabId) {
  return 'https://docs.google.com/document/d/' + docId + '/edit?tab=' + tabId;
}

// ------------------------------------------------------------
// 純粋関数（GAS の API を使わない。Node からもテストできる）
// ------------------------------------------------------------

/** テンプレート本体のタブか（取り込みスクリプトと同じ規則）。 */
function isTemplateTabTitle_(title) {
  return /^[_＿]/.test(title) || title.indexOf('テンプレート') !== -1;
}

/** 「  - 講座名：2026冬期 中等部」から値を取る。横方向の空白だけを許す（改行を跨がない）。 */
function fieldOf_(text, label) {
  var re = new RegExp('^[ \\t\\u3000\\-*・]*\\*{0,2}' + label + '\\*{0,2}[ \\t\\u3000]*[：:][ \\t\\u3000]*(.*)$', 'm');
  var m = re.exec(text);
  if (!m) return '';
  return m[1].replace(/←.*$/, '').replace(/\*/g, '').replace(/[\s　]+$/, '').trim();
}

/**
 * 要項タブの本文を読んで、通知に必要な項目を取り出す。
 *   title, kind, status(確定/下書き), owner, history(更新履歴), keirDate(経理記入日),
 *   moneyText(金額に関わる節の正規化本文), moneyHash, keiriSection(経理連絡事項の担当者記入部分),
 *   isTemplate(講座名が空＝テンプレート本体)
 */
function parseYoko_(text) {
  var lines = String(text || '').replace(/\r/g, '').split('\n');
  var sections = splitSections_(lines);

  var title = fieldOf_(text, '講座名');
  var statusRaw = fieldOf_(text, 'ステータス');
  var info = {
    title: title,
    kind: fieldOf_(text, '講座区分'),
    status: statusRaw.indexOf('確定') !== -1 ? '確定' : '下書き',
    statusRaw: statusRaw,
    owner: fieldOf_(text, '作成者'),
    history: fieldOf_(text, '更新履歴'),
    isTemplate: !title || /（例/.test(title),
  };

  var fee = sections['受講料'] || [];
  var pay = subsection_(sections['申込'] || [], '支払い方法');
  var keiriAll = sections['経理連絡事項'] || [];
  var keiriStaff = [];
  var keiriAcct = [];
  var inAcct = false;
  keiriAll.forEach(function (l) {
    if (/経理記入欄/.test(l)) inAcct = true;
    (inAcct ? keiriAcct : keiriStaff).push(l);
  });

  info.keiriSection = normalizeLines_(keiriStaff).join('\n');
  info.keiriDate = fieldOf_(keiriAcct.join('\n'), '経理記入日');
  info.moneyText = []
    .concat(['＜受講料＞'], normalizeLines_(fee))
    .concat(['＜申込＞ 支払い方法'], normalizeLines_(pay))
    .concat(['＜経理連絡事項＞ 講座担当が記入'], normalizeLines_(keiriStaff))
    .join('\n');
  info.moneyHash = hashText_(info.moneyText);
  return info;
}

/** 「＜受講料＞（税込）」のような見出し行で本文を節に切る。節名は＜＞の中身。 */
function splitSections_(lines) {
  var sections = {};
  var current = null;
  lines.forEach(function (l) {
    var m = /^[#\s]*＜(.+?)＞/.exec(l);
    if (m) {
      current = m[1].trim();
      sections[current] = [];
      return;
    }
    if (current) sections[current].push(l);
  });
  return sections;
}

/** 節の中の「■ 支払い方法」から次の「■」までを取り出す。 */
function subsection_(lines, name) {
  var out = [];
  var on = false;
  lines.forEach(function (l) {
    if (/^[#\s]*■/.test(l)) {
      on = l.indexOf(name) !== -1;
      return;
    }
    if (on) out.push(l);
  });
  return out;
}

/** 空行・装飾・前後の空白を落として比較しやすくする。「※」の注記行は金額ではないので除く。 */
function normalizeLines_(lines) {
  return lines
    .map(function (l) { return l.replace(/\*/g, '').replace(/[\s　]+/g, ' ').trim(); })
    .filter(function (l) { return l && l.charAt(0) !== '※' && !/^-{3,}$/.test(l); });
}

/** GAS でも Node でも同じ値になる簡易ハッシュ（FNV-1a 32bit）。台帳の比較にだけ使う。 */
function hashText_(s) {
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

/** 前回値（台帳の行）と今回の解析結果から、通知すべき出来事を決める。 */
function detectEvents_(prev, info) {
  var events = [];
  var prevStatus = prev ? prev['ステータス'] : '';
  var prevHash = prev ? prev['金額ハッシュ'] : '';
  var prevDate = prev ? prev['経理記入日'] : '';

  if (info.status === '確定' && prevStatus !== '確定') {
    events.push('確定');
  } else if (info.status === '確定' && prevStatus === '確定' && prevHash && prevHash !== info.moneyHash) {
    events.push('金額訂正');
  } else if (info.status !== '確定' && prevStatus === '確定') {
    events.push('確定取り下げ');
  }
  if (info.keiriDate && info.keiriDate !== prevDate) {
    events.push('経理記入完了');
  }
  return events;
}

/** 経理記入待ち（経理確認＝未）のまま REMIND_HOURS 以上たっていれば再通知する。 */
function needsReminder_(prev, nowMs, remindHours) {
  if (!prev || prev['経理確認'] !== '未') return false;
  if (prev['ステータス'] !== '確定') return false;
  var last = Date.parse(prev['最終通知日時'] || '');
  if (isNaN(last)) return false;
  var hours = remindHours != null ? remindHours : Number(prop_('REMIND_HOURS') || 20);
  var now = nowMs != null ? nowMs : Date.now();
  return now - last >= hours * 3600 * 1000;
}

/** 行単位の差分。前回だけにある行は「−」、今回だけにある行は「＋」。 */
function diffLines_(oldText, newText) {
  var a = String(oldText || '').split('\n').filter(Boolean);
  var b = String(newText || '').split('\n').filter(Boolean);
  var inA = {};
  var inB = {};
  a.forEach(function (l) { inA[l] = true; });
  b.forEach(function (l) { inB[l] = true; });
  var out = [];
  a.forEach(function (l) { if (!inB[l]) out.push('− ' + l); });
  b.forEach(function (l) { if (!inA[l]) out.push('＋ ' + l); });
  return out;
}

/** 通知本文を組み立てる。 */
function buildMessage_(event, info, prev, link) {
  var head;
  var body = [];
  var kind = info.kind ? '（' + info.kind + '）' : '';
  switch (event) {
    case '確定':
      head = '【要項 確定】' + info.title + kind;
      body.push('要項が「確定」になりました。＜経理連絡事項＞の経理記入欄（請求方法・引き落とし日・締日・計上月）の記入をお願いします。');
      body.push('', '■ 講座担当が記入した経理連絡事項', info.keiriSection || '（記載なし）');
      break;
    case '金額訂正':
      head = '【至急】【要項 金額訂正】' + info.title + kind;
      body.push('確定済みの要項で、金額に関わる記載が変わりました。請求処理への影響を確認してください。');
      if (info.history) body.push('', '■ 更新履歴', info.history);
      var diff = diffLines_(prev ? prev['金額本文'] : '', info.moneyText);
      body.push('', '■ 変わった行（− 前 ／ ＋ 後）');
      body.push(diff.length ? diff.join('\n') : '（行の差分なし。表記ゆれの可能性があります）');
      break;
    case '経理記入完了':
      head = '【経理記入完了】' + info.title + kind;
      body.push('経理記入欄の記入が終わりました（経理記入日：' + info.keiriDate + '）。');
      body.push('講座担当は＜申込＞の支払い方法と食い違いがないか確認し、問題なければ要項QAへの取り込みを依頼してください。');
      break;
    case '確定取り下げ':
      head = '【要項 確定取り下げ】' + info.title + kind;
      body.push('確定済みだった要項が「' + (info.statusRaw || '下書き') + '」に戻りました。内容が変わる可能性があるため、請求処理を一旦止めてください。');
      break;
    case 'リマインド':
      head = '【リマインド】経理記入待ち：' + info.title + kind;
      body.push('前回の連絡（' + (prev ? prev['最終通知日時'] : '') + '）から経理記入欄が埋まっていません。記入をお願いします。');
      break;
    default:
      head = '【要項 連絡】' + info.title + kind;
      body.push('講座担当からの連絡です。現在の経理連絡事項を送ります。');
      body.push('', '■ 講座担当が記入した経理連絡事項', info.keiriSection || '（記載なし）');
  }
  body.push('', '作成者：' + (info.owner || '未記入') + '　ステータス：' + (info.statusRaw || info.status));
  body.push(link);
  return head + '\n' + body.join('\n');
}

/** 台帳の次の行の値を作る。 */
function nextRow_(prev, docId, tabId, info, link, sentEvents, nowIso) {
  var now = nowIso || new Date().toISOString();
  var row = {};
  LEDGER_HEADERS.forEach(function (h) { row[h] = prev ? (prev[h] || '') : ''; });
  row['docId'] = docId;
  row['tabId'] = tabId;
  row['講座名'] = info.title;
  row['講座区分'] = info.kind;
  row['ステータス'] = info.status;
  row['作成者'] = info.owner;
  row['金額ハッシュ'] = info.moneyHash;
  row['金額本文'] = info.moneyText;
  row['経理記入日'] = info.keiriDate;
  row['更新履歴'] = info.history;
  row['リンク'] = link;
  row['最終確認日時'] = now;
  if (!prev && !(sentEvents && sentEvents.length)) {
    // 初回登録（seedLedger）。確定済みで経理記入日があれば済、無ければ空（リマインドはしない）
    row['経理確認'] = info.status === '確定' && info.keiriDate ? '済' : '';
  }
  if (sentEvents && sentEvents.length) {
    row['最終通知日時'] = now;
    row['最終通知種別'] = sentEvents.join('、');
    if (sentEvents.indexOf('経理記入完了') !== -1) row['経理確認'] = '済';
    else if (sentEvents.indexOf('確定') !== -1 || sentEvents.indexOf('金額訂正') !== -1 || sentEvents.indexOf('手動連絡') !== -1) row['経理確認'] = '未';
    else if (sentEvents.indexOf('確定取り下げ') !== -1) row['経理確認'] = '';
  }
  return row;
}

// ------------------------------------------------------------
// 台帳スプレッドシート
// ------------------------------------------------------------

function openLedger_() {
  var id = prop_('LEDGER_SPREADSHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      // 削除されていたら作り直す
    }
  }
  var ss = SpreadsheetApp.create(LEDGER_NAME);
  var folderId = prop_('YOKO_FOLDER_ID') || YOKO_DEFAULT_FOLDER_ID;
  try {
    DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(folderId));
  } catch (e) {
    Logger.log('台帳をフォルダへ移せませんでした（マイドライブ直下にあります）: ' + e);
  }
  var sh = ss.getActiveSheet();
  sh.setName(LEDGER_SHEET);
  sh.getRange(1, 1, 1, LEDGER_HEADERS.length).setValues([LEDGER_HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  var staff = ss.insertSheet(STAFF_SHEET);
  staff.getRange(1, 1, 1, 3).setValues([['作成者（要項に書く名前）', 'LINE WORKS ユーザーID', 'メモ']]).setFontWeight('bold');
  staff.setFrozenRows(1);
  PropertiesService.getScriptProperties().setProperty('LEDGER_SPREADSHEET_ID', ss.getId());
  return ss;
}

function ledgerSheet_(ss) {
  var sh = ss.getSheetByName(LEDGER_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LEDGER_SHEET);
    sh.getRange(1, 1, 1, LEDGER_HEADERS.length).setValues([LEDGER_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 台帳を { 'docId|tabId': row } の形で読む。列は見出し名で引く（列順を変えても動く）。 */
function readLedger_(ss) {
  var sh = ledgerSheet_(ss);
  var values = sh.getDataRange().getValues();
  var rows = {};
  if (values.length < 2) return rows;
  var headers = values[0].map(String);
  for (var r = 1; r < values.length; r++) {
    var row = {};
    headers.forEach(function (h, c) { row[h] = values[r][c] == null ? '' : String(values[r][c]); });
    if (!row['docId'] || !row['tabId']) continue;
    rows[row['docId'] + '|' + row['tabId']] = row;
  }
  return rows;
}

function writeLedger_(ss, rows) {
  var sh = ledgerSheet_(ss);
  var keys = Object.keys(rows).sort();
  var out = keys.map(function (k) {
    return LEDGER_HEADERS.map(function (h) { return rows[k][h] == null ? '' : rows[k][h]; });
  });
  sh.clearContents();
  sh.getRange(1, 1, 1, LEDGER_HEADERS.length).setValues([LEDGER_HEADERS]).setFontWeight('bold');
  if (out.length) sh.getRange(2, 1, out.length, LEDGER_HEADERS.length).setValues(out);
}

/** 「担当者」シートから作成者名 → LINE WORKS ユーザーID。部分一致（姓だけでも当たる）。 */
function staffUserId_(ownerName) {
  if (!ownerName) return '';
  var id = prop_('LEDGER_SPREADSHEET_ID');
  if (!id) return '';
  var sh = SpreadsheetApp.openById(id).getSheetByName(STAFF_SHEET);
  if (!sh) return '';
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    var name = String(values[r][0] || '').trim();
    var uid = String(values[r][1] || '').trim();
    if (!name || !uid) continue;
    if (ownerName.indexOf(name) !== -1 || name.indexOf(ownerName) !== -1) return uid;
  }
  return '';
}

// ------------------------------------------------------------
// LINE WORKS Bot（API 2.0 / Service Account 認証）
// ------------------------------------------------------------

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

/** 通知を送る。部屋（LW_CHANNEL_ID）には必ず送り、作成者に ID があれば個別トークにも送る。 */
function sendLineWorks_(text, info, event) {
  var botId = prop_('LW_BOT_ID');
  var channelId = prop_('LW_CHANNEL_ID');
  if (!botId || !channelId) throw new Error('LW_BOT_ID / LW_CHANNEL_ID が未設定です');
  var token = lineWorksToken_();
  lineWorksPost_('https://www.worksapis.com/v1.0/bots/' + botId + '/channels/' + encodeURIComponent(channelId) + '/messages', token, text);

  // 担当者への個別連絡（経理記入完了・確定取り下げ・リマインドは担当者にも関係する）
  var uid = staffUserId_(info && info.owner);
  if (uid && (event === '経理記入完了' || event === '確定取り下げ' || event === 'リマインド')) {
    try {
      lineWorksPost_('https://www.worksapis.com/v1.0/bots/' + botId + '/users/' + encodeURIComponent(uid) + '/messages', token, text);
    } catch (e) {
      Logger.log('担当者への個別送信に失敗: ' + e);
    }
  }
}

function lineWorksPost_(url, token, text) {
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ content: { type: 'text', text: text } }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('LINE WORKS 送信失敗 ' + code + ': ' + res.getContentText());
  }
}

/** Service Account の JWT でアクセストークンを取る。6時間キャッシュ（有効期限は24時間）。 */
function lineWorksToken_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('lw_token');
  if (cached) return cached;

  var clientId = prop_('LW_CLIENT_ID');
  var clientSecret = prop_('LW_CLIENT_SECRET');
  var serviceAccount = prop_('LW_SERVICE_ACCOUNT');
  var privateKey = normalizePem_(prop_('LW_PRIVATE_KEY'));
  if (!clientId || !clientSecret || !serviceAccount || !privateKey) {
    throw new Error('LW_CLIENT_ID / LW_CLIENT_SECRET / LW_SERVICE_ACCOUNT / LW_PRIVATE_KEY が未設定です');
  }

  var now = Math.floor(Date.now() / 1000);
  var header = base64Url_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var claims = base64Url_(JSON.stringify({ iss: clientId, sub: serviceAccount, iat: now, exp: now + 3600 }));
  var signature = base64Url_(Utilities.computeRsaSha256Signature(header + '.' + claims, privateKey));
  var assertion = header + '.' + claims + '.' + signature;

  var res = UrlFetchApp.fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
    method: 'post',
    payload: {
      assertion: assertion,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'bot',
    },
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('LINE WORKS 認証失敗 ' + code + ': ' + res.getContentText());
  var token = JSON.parse(res.getContentText()).access_token;
  if (!token) throw new Error('LINE WORKS 認証応答に access_token がありません');
  cache.put('lw_token', token, 21600);
  return token;
}

/**
 * スクリプト プロパティに貼った秘密鍵を、署名関数が受け付ける PEM の形に整える。
 * 受け付ける入れ方：
 *   - ファイルの中身をそのまま（改行あり）
 *   - 改行が消えて1行になったもの（プロパティの入力欄に貼ると起きやすい）
 *   - 改行を文字の「\n」で書いたもの
 *   - 前後に " や ' が付いたもの
 * ヘッダー（BEGIN PRIVATE KEY ／ BEGIN RSA PRIVATE KEY）は元の種類を残し、
 * 本文の base64 を 64 文字ごとに改行し直す。
 */
function normalizePem_(raw) {
  var s = String(raw || '').trim();
  s = s.replace(/^["']+|["']+$/g, '');          // 前後の引用符
  s = s.replace(/\\r\\n|\\n|\\r/g, '\n');       // 文字としての \n を本物の改行に
  s = s.replace(/\r\n?/g, '\n');
  var type = 'PRIVATE KEY';
  var m = /-----BEGIN ([A-Z ]+?)-----/.exec(s);
  if (m) type = m[1];
  var body = s
    .replace(/-----BEGIN [A-Z ]+?-----/g, '')
    .replace(/-----END [A-Z ]+?-----/g, '')
    .replace(/[^A-Za-z0-9+\/=]/g, '');           // 改行・空白・全角空白などを全部落とす
  if (!body) return '';
  var lines = [];
  for (var i = 0; i < body.length; i += 64) lines.push(body.substr(i, 64));
  return '-----BEGIN ' + type + '-----\n' + lines.join('\n') + '\n-----END ' + type + '-----\n';
}

/**
 * LW_PRIVATE_KEY の診断。Apps Script エディタで実行し、実行ログを見る。
 * 鍵の中身は出さない（種類・長さ・署名できたかだけ）。
 */
function checkPrivateKey() {
  var raw = prop_('LW_PRIVATE_KEY');
  if (!raw) {
    Logger.log('LW_PRIVATE_KEY が空です。プロジェクトの設定 > スクリプト プロパティ に入れてください。');
    return;
  }
  var hasHeader = /-----BEGIN [A-Z ]+?-----/.test(raw);
  var hasRealNewline = raw.indexOf('\n') !== -1;
  var hasLiteralNewline = raw.indexOf('\\n') !== -1;
  Logger.log('貼られた値: ' + raw.length + ' 文字 / BEGIN ヘッダー: ' + (hasHeader ? 'あり' : 'なし') +
    ' / 本物の改行: ' + (hasRealNewline ? 'あり' : 'なし') + ' / 文字の\\n: ' + (hasLiteralNewline ? 'あり' : 'なし'));
  if (!hasHeader) {
    Logger.log('警告: -----BEGIN PRIVATE KEY----- が見当たりません。private_xxxx.key の中身をそのまま貼ってください（Client Secret や Service Account ではありません）。');
  }
  var pem = normalizePem_(raw);
  var type = (/-----BEGIN ([A-Z ]+?)-----/.exec(pem) || [])[1] || '?';
  var bodyLen = pem.replace(/-----[A-Z ]+?-----/g, '').replace(/\s/g, '').length;
  Logger.log('整形後: 種類=' + type + ' / base64 本文 ' + bodyLen + ' 文字（2048bit の PKCS#8 なら約 1,600 文字）');
  try {
    var sig = Utilities.computeRsaSha256Signature('test', pem);
    Logger.log('署名テスト: OK（' + sig.length + ' バイト）。鍵は使えます。まだ失敗するなら Client ID / Secret / Service Account を確認してください。');
  } catch (e) {
    Logger.log('署名テスト: 失敗 → ' + e);
    Logger.log('対処: private_xxxx.key をテキストエディタで開き、全文（BEGIN 行から END 行まで）をコピーして貼り直してください。');
  }
}

function base64Url_(v) {
  var s = typeof v === 'string' ? Utilities.base64EncodeWebSafe(v, Utilities.Charset.UTF_8) : Utilities.base64EncodeWebSafe(v);
  return s.replace(/=+$/, '');
}

/** メニュー「LINE WORKS 接続テスト」。部屋にテスト文を送る。 */
function testLineWorks() {
  var ui = DocumentApp.getUi();
  try {
    sendLineWorks_('【接続テスト】要項連絡 Bot からのテスト送信です（' + new Date().toLocaleString('ja-JP') + '）', null, 'テスト');
    ui.alert('送信しました。LINE WORKS の部屋を確認してください。');
  } catch (e) {
    ui.alert('送信に失敗しました', String(e), ui.ButtonSet.OK);
  }
}
