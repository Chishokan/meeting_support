/**
 * 要項ドキュメント（Google ドキュメント）を Drive API で Markdown に書き出す。
 * 人が「ファイル > ダウンロード > Markdown」でやっている操作と同じ結果を、
 * GitHub Actions から取れるようにするためのもの（scripts/import-yoko.mjs --sync に渡す）。
 *
 * 使い方:
 *   YOKO_DOC_ID=<ドキュメントID> GOOGLE_SERVICE_ACCOUNT_JSON='<サービスアカウントの鍵 JSON>' \
 *     node scripts/export-yoko-doc.mjs <出力先ファイル>
 *
 *   - YOKO_DOC_ID … 要項ドキュメントの ID（URL の /d/ と /edit の間）
 *   - GOOGLE_SERVICE_ACCOUNT_JSON … サービスアカウントの鍵ファイルの中身（JSON 文字列）。
 *     代わりに GOOGLE_APPLICATION_CREDENTIALS に鍵ファイルのパスを渡してもよい。
 *   - 要項ドキュメントをそのサービスアカウントのメールアドレスに「閲覧者」で共有しておくこと。
 *
 * 依存パッケージは使わない（JWT の署名は node:crypto で行う）。
 * 権限は drive.readonly だけ。書き込みはしない。
 */
import { createSign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2];
const DOC_ID = process.env.YOKO_DOC_ID;

if (!OUT || !DOC_ID) {
  console.error('使い方: YOKO_DOC_ID=… GOOGLE_SERVICE_ACCOUNT_JSON=… node scripts/export-yoko-doc.mjs <出力先>');
  process.exit(1);
}

function loadCredentials() {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const raw = inline || (path ? readFileSync(path, 'utf8') : '');
  if (!raw) {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON か GOOGLE_APPLICATION_CREDENTIALS を設定してください。');
    process.exit(1);
  }
  const c = JSON.parse(raw);
  if (!c.client_email || !c.private_key) {
    console.error('サービスアカウントの鍵に client_email / private_key がありません。');
    process.exit(1);
  }
  return c;
}

const b64url = (s) => Buffer.from(s).toString('base64url');

// サービスアカウントの鍵で JWT を作り、アクセストークンに交換する。
async function accessToken(cred) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: cred.client_email,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const sig = signer.sign(cred.private_key, 'base64url');
  const assertion = `${header}.${claim}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    console.error(`トークン取得に失敗: ${res.status} ${JSON.stringify(j)}`);
    process.exit(1);
  }
  return j.access_token;
}

const cred = loadCredentials();
const token = await accessToken(cred);

const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(DOC_ID)}/export?mimeType=${encodeURIComponent('text/markdown')}`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) {
  const text = await res.text().catch(() => '');
  console.error(`書き出しに失敗: ${res.status}\n${text.slice(0, 500)}`);
  if (res.status === 404) console.error('ドキュメント ID が違うか、サービスアカウントに共有されていません。');
  process.exit(1);
}
const md = await res.text();
writeFileSync(OUT, md, 'utf8');

const tabs = (md.match(/^# (?!\*).+$/gm) || []).length;
console.log(`書き出し完了: ${OUT}（${md.length}字、タブ見出し ${tabs} 件）`);
if (tabs === 0) {
  console.error('タブ見出し（# …）が1つも見つかりません。ドキュメントの構成を確認してください。');
  process.exit(1);
}
