# kaigi-files（会議DX のファイル置き場・Xサーバー）

会議DX（Vercel）の写真を Xサーバーに置くための小さな PHP。いまは **つきいち改善** の Before／After の写真に使う。
給与・シフト（colorhrm の `payroll/`）の報告写真と同じ考え方で作ってある。

- 写真は `storage/` に入れ、`.htaccess` で直接は開けないようにする（給与・シフトの `uploads/reports/` と同じ）
- 置く・消すのは会議DX のサーバだけ（`api.php`。ヘッダ `X-Kaigi-Token` に合言葉）
- 見るのは `photo.php` の **期限つき・署名つきの URL** だけ。URL は会議DX にログインした人の画面にだけ渡る（6〜12時間で切れる）
- データベースは使わない（どの写真がどの改善のものかは、会議DX 側の Supabase に持つ）

| ファイル | 役割 |
|---|---|
| `api.php` | 会議DX のサーバ用の窓口。`?action=ping`（設定の確認）／`put`（置く）／`delete`（消す） |
| `photo.php` | 写真を見る窓口。`?k=名前&e=期限&s=署名` が正しいときだけ写真を返す |
| `lib.php` | 共通部品（名前の検査・署名の計算）。直接は開けない |
| `config.php.example` | 設定のひな形。サーバー上で `config.php` にして合言葉を入れる（Git には上げない） |
| `storage/` | 写真の保存先。直接は開けない（`.htaccess`） |

置ける写真：JPEG／PNG／WebP、1枚5MBまで（`config.php` の `max_bytes`）。中身を見て種類を確かめる（拡張子だけ変えたファイルは断る）。
名前は `kaizen/chishokan_prod/<改善ID>/before-<時刻>.jpg` の形。英数字・`-`・`_` 以外や `..` を含む名前は断る。

## 初めて置くとき

公開URLの例：`https://chishokan.co.jp/kaigi-files/`（配置先 `/chishokan.co.jp/public_html/kaigi-files/`）

1. **合言葉を決める**：32文字以上のランダムな文字列（例：ターミナルで `openssl rand -hex 32`）。人に送らない
2. **FTP アカウントを作る**：サーバーパネル →［FTPアカウント設定］で、ホームを `public_html/kaigi-files` にした専用アカウントを作る
   （給与・シフトの `colorhrm-pay` 用アカウントと同じやり方）
3. **GitHub に登録**（meeting_support の Settings → Secrets and variables → Actions）
   - Secrets：`FTP_FILES_SERVER`（例 `sv8550.xserver.jp`）／`FTP_FILES_USERNAME`／`FTP_FILES_PASSWORD`
   - Variables（任意）：`FTP_FILES_SERVER_DIR`（既定 `/`。専用アカウントのホームが kaigi-files なら不要）
4. **デプロイ**：Actions →「Deploy kaigi-files to Xserver」→ Run workflow（最初は Dry run にチェックで中身を確認）。
   以後は `main` で `xserver/kaigi-files/` を直すと自動で上がる
5. **config.php を置く**：`config.php.example` をコピーして `secret` に 1. の合言葉を入れ、サーバーの `kaigi-files/config.php` に
   **FTP かファイルマネージャの［アップロード］で**置く（Web 編集で新規作成して貼り付ける方法は、空のファイルになることがあるので使わない）
6. **Vercel に登録**（Environment Variables。Production・Preview・Development すべて）して再デプロイする
   - `FILES_URL` = `https://chishokan.co.jp/kaigi-files`
   - `FILES_SECRET` = 1. の合言葉
   - dev と本番で同じ置き場を使ってよい（中のフォルダを `SUPABASE_SCHEMA` の値で分けている）
7. **確認**：ターミナルで
   `curl -H "X-Kaigi-Token: <合言葉>" https://chishokan.co.jp/kaigi-files/api.php?action=ping`
   → `{"ok":true,"writable":true,...}` なら準備完了。続けて会議DX の dev 環境で、つきいち改善に写真つきで1件出して表示されるか確かめる
   - `https://chishokan.co.jp/kaigi-files/storage/` を開いて **403（見られない）** になることも確かめる

## うまくいかないとき

| 症状 | 確かめること |
|---|---|
| ping が `401 unauthorized` | 合言葉の打ち間違い。`config.php` と Vercel の `FILES_SECRET` が同じか |
| ping が `503 not_configured` | `config.php` が無い・空・`secret` が32文字未満 |
| ping の `writable` が `false` | `storage/` に書き込めない。ファイルマネージャで `storage` フォルダのパーミッションを 755 に |
| 会議DX で「写真が大きすぎます」 | Xサーバーの［php.ini設定］の `upload_max_filesize` / `post_max_size` が 5MB より小さくないか |
| 写真が表示されない | 画面を開いたまま 6時間以上たつと URL が切れる。開き直す |
| `storage/` の中が直接見えてしまう | `storage/.htaccess` が上がっているか（FTP で隠しファイルも表示して確かめる） |

## 写真を消すとき

会議DX で写真を外す・差し替える・改善を消すと、ここからも消える（元に戻せない）。
置き場ごと引っ越すときは `storage/` の中身をそのままコピーし、`FILES_URL` を変えればよい（名前は変わらない）。
