<?php
// 会議DX のファイル置き場：会議DX のサーバ（Vercel）だけが使う窓口。
//   ヘッダ X-Kaigi-Token に合言葉（config.php の secret）が無いと何もしない。
//   ※ Authorization ヘッダは Xサーバー（CGI 版 PHP）で PHP に届かないことがあるので使わない。
//
//   GET  api.php?action=ping   … 設定の確認（合言葉が合っているか・保存先に書けるか）
//   POST api.php?action=put    … 写真を置く（multipart/form-data：key＝置き場の名前、file＝写真）
//   POST api.php?action=delete … 写真を消す（JSON：{"keys": ["…", …]}。無いものは無視）

define('KAIGI_FILES', true);
require __DIR__ . '/lib.php';

$secret = kf_secret();
$token = (string)($_SERVER['HTTP_X_KAIGI_TOKEN'] ?? '');
if ($token === '' || !hash_equals($secret, $token)) kf_json(401, ['ok' => false, 'reason' => 'unauthorized']);

$cfg = kf_config();
$dir = rtrim((string)$cfg['storage_dir'], '/');
$action = (string)($_GET['action'] ?? '');

if ($action === 'ping') {
  if (!is_dir($dir)) @mkdir($dir, 0755, true);
  kf_json(200, ['ok' => true, 'writable' => is_dir($dir) && is_writable($dir), 'php' => PHP_VERSION]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') kf_json(405, ['ok' => false, 'reason' => 'method_not_allowed']);

if ($action === 'put') {
  // 写真が post_max_size を超えると、本文ごと捨てられて $_POST も $_FILES も空になる
  if (empty($_POST) && empty($_FILES) && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
    kf_json(413, ['ok' => false, 'reason' => 'too_large']);
  }
  $key = (string)($_POST['key'] ?? '');
  if (!kf_valid_key($key)) kf_json(400, ['ok' => false, 'reason' => 'bad_key']);
  $f = $_FILES['file'] ?? null;
  $err = is_array($f) ? ($f['error'] ?? UPLOAD_ERR_NO_FILE) : UPLOAD_ERR_NO_FILE;
  if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) kf_json(413, ['ok' => false, 'reason' => 'too_large']);
  if ($err !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) kf_json(400, ['ok' => false, 'reason' => 'no_file']);
  if ((int)$f['size'] > (int)$cfg['max_bytes']) kf_json(413, ['ok' => false, 'reason' => 'too_large']);

  // 拡張子の偽装に備えて、中身から種類を確かめる（名前の拡張子と一致しなければ断る）
  $finfo = finfo_open(FILEINFO_MIME_TYPE);
  $mime = $finfo ? (string)finfo_file($finfo, $f['tmp_name']) : '';
  if ($finfo) finfo_close($finfo);
  if ($mime !== kf_types()[kf_ext($key)]) kf_json(415, ['ok' => false, 'reason' => 'bad_type']);

  $dest = kf_path($key);
  if (file_exists($dest)) kf_json(409, ['ok' => false, 'reason' => 'exists']);
  $sub = dirname($dest);
  if (!is_dir($sub) && !@mkdir($sub, 0755, true) && !is_dir($sub)) kf_json(500, ['ok' => false, 'reason' => 'mkdir_failed']);
  if (!move_uploaded_file($f['tmp_name'], $dest)) kf_json(500, ['ok' => false, 'reason' => 'save_failed']);
  @chmod($dest, 0644);
  kf_json(200, ['ok' => true, 'key' => $key, 'bytes' => (int)$f['size']]);
}

if ($action === 'delete') {
  $body = json_decode((string)file_get_contents('php://input'), true);
  $keys = is_array($body) && isset($body['keys']) && is_array($body['keys']) ? $body['keys'] : null;
  if ($keys === null || count($keys) > 100) kf_json(400, ['ok' => false, 'reason' => 'bad_keys']);
  $deleted = 0;
  foreach ($keys as $key) {
    if (!kf_valid_key($key)) continue;
    $path = kf_path($key);
    if (is_file($path) && @unlink($path)) {
      $deleted++;
      @rmdir(dirname($path)); // 空になったフォルダ（改善ごと）も片づける。空でなければ何もしない
    }
  }
  kf_json(200, ['ok' => true, 'deleted' => $deleted]);
}

kf_json(400, ['ok' => false, 'reason' => 'bad_action']);
