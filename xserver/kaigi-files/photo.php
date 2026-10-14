<?php
// 会議DX のファイル置き場：写真を見る窓口（ブラウザが直接開く）。
//   photo.php?k=<置き場の名前>&e=<期限（UNIX 秒）>&s=<署名>
//   署名は会議DX のサーバが合言葉で作る（lib/core/xserverFiles.ts の signedFileUrl）。
//   会議DX にログインした人の画面にだけ、期限つきの URL が渡る。期限を過ぎた URL・書き換えた URL は開けない。

define('KAIGI_FILES', true);
require __DIR__ . '/lib.php';

$key = (string)($_GET['k'] ?? '');
$exp = (string)($_GET['e'] ?? '');
$sig = (string)($_GET['s'] ?? '');
$now = time();

if (!kf_valid_key($key) || !ctype_digit($exp)) { http_response_code(400); exit('URL が正しくありません。'); }
// 期限切れ、または先すぎる期限（7日より先）は受け付けない
if ((int)$exp < $now || (int)$exp > $now + 7 * 86400) { http_response_code(403); exit('URL の期限が切れています。画面を開き直してください。'); }
if (!hash_equals(kf_sign($key, $exp), $sig)) { http_response_code(403); exit('URL が正しくありません。'); }

$path = kf_path($key);
if (!is_file($path)) { http_response_code(404); exit('写真が見つかりません。'); }

header('Content-Type: ' . kf_types()[kf_ext($key)]);
header('Content-Length: ' . filesize($path));
header('Content-Disposition: inline; filename="' . basename($key) . '"');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
// URL の期限までは、見た人のブラウザにだけ残してよい（共有のキャッシュには残さない）
header('Cache-Control: private, max-age=' . max(0, (int)$exp - $now));
readfile($path);
