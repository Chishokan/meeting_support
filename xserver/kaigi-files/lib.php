<?php
// 会議DX のファイル置き場の共通部品（api.php / photo.php から読む）。直接開いても何も出ない。

if (!defined('KAIGI_FILES')) { http_response_code(404); exit; }

// 置ける種類（拡張子 => Content-Type）。写真だけ。
//   HEIC は外す（給与・シフトの報告写真と同じ。Windows で開けないことが多いため。会議DX は送る前に JPEG にする）。
function kf_types() {
  return ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
}

function kf_config() {
  static $cfg = null;
  if ($cfg !== null) return $cfg;
  $path = __DIR__ . '/config.php';
  $cfg = is_file($path) ? (require $path) : [];
  if (!is_array($cfg)) $cfg = [];
  $cfg += ['secret' => '', 'storage_dir' => __DIR__ . '/storage', 'max_bytes' => 5 * 1024 * 1024];
  return $cfg;
}

function kf_json($code, $data) {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  header('X-Content-Type-Options: nosniff');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

// 合言葉が設定されているか（短すぎる合言葉では動かさない）
function kf_secret() {
  $s = (string)kf_config()['secret'];
  if (strlen($s) < 32) kf_json(503, ['ok' => false, 'reason' => 'not_configured']);
  return $s;
}

// ファイルの名前（キー）。英数字・-・_ のフォルダ区切りと、最後に .jpg/.png/.webp だけを許す。
//   例：kaizen/chishokan_prod/3f2a.../before-1760000000000.jpg
//   「..」や「/」始まりは通らないので、保存先の外には出られない。
function kf_valid_key($key) {
  return is_string($key) && strlen($key) <= 200
    && preg_match('~^[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*\.(jpg|png|webp)$~', $key) === 1;
}

function kf_path($key) {
  return rtrim((string)kf_config()['storage_dir'], '/') . '/' . $key;
}

function kf_ext($key) {
  return strtolower(pathinfo($key, PATHINFO_EXTENSION));
}

function kf_b64url($bin) {
  return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

// 見るための URL の署名。会議DX 側（lib/core/xserverFiles.ts の signedFileUrl）と同じ計算にする。
function kf_sign($key, $exp) {
  return kf_b64url(hash_hmac('sha256', "photo\n" . $key . "\n" . $exp, kf_secret(), true));
}
