// Xサーバーの会議DX用ファイル置き場（xserver/kaigi-files/）への接続。サーバ専用（API ルートからだけ使う）。
// 給与・シフト（colorhrm-pay）の報告写真と同じく、写真は Xサーバーに置き、直接は開けないフォルダに入れる。
//
//   FILES_URL    … 置き場の URL。例 https://chishokan.co.jp/kaigi-files（末尾の / は無くてよい）
//   FILES_SECRET … 置き場の config.php の secret と同じ値（32文字以上）。ブラウザに渡さない（NEXT_PUBLIC_ を付けない）
// 未設定なら configured() が false を返し、各アプリは写真を受け付けない（開発中は data URL で代用する）。
//
// 置く・消す：このサーバから api.php を呼ぶ（ヘッダ X-Kaigi-Token に合言葉）。
// 見る：photo.php の「期限つき・署名つき URL」を作って画面に渡す。署名は photo.php（lib.php の kf_sign）と同じ計算。

import { createHmac } from 'crypto';

export type FilesFail = { ok: false; reason: string };

function config(): { url: string; secret: string } | null {
  const url = (process.env.FILES_URL ?? '').trim().replace(/\/+$/, '');
  const secret = (process.env.FILES_SECRET ?? '').trim();
  return url && secret.length >= 32 ? { url, secret } : null;
}

export function filesConfigured(): boolean {
  return config() !== null;
}

/** 置き場の名前として通るか（photo.php・api.php の kf_valid_key と同じ）。 */
export function validFileKey(key: string): boolean {
  return key.length <= 200 && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(jpg|png|webp)$/.test(key);
}

// 失敗は「files_error|理由」で返す（画面側が言い換える）。合言葉や URL は含めない。
function fail(where: string, reason: string): FilesFail {
  console.log('[xserver-files]', where, reason);
  return { ok: false, reason: `files_error|${reason}` };
}

/** 写真を置く。key は置き場の中の名前（例 kaizen/chishokan_prod/<改善ID>/before-1760000000000.jpg）。 */
export async function putFile(key: string, bytes: Buffer, mime: string): Promise<{ ok: true } | FilesFail> {
  const c = config();
  if (!c) return { ok: false, reason: 'files_not_configured' };
  if (!validFileKey(key)) return fail('put', 'bad_key');
  const form = new FormData();
  form.append('key', key);
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), key.split('/').pop());
  try {
    const res = await fetch(`${c.url}/api.php?action=put`, {
      method: 'POST',
      headers: { 'X-Kaigi-Token': c.secret },
      body: form,
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string } | null;
    if (res.ok && j?.ok) return { ok: true };
    return fail(`put ${key}`, j?.reason || `http_${res.status}`);
  } catch (e) {
    return fail(`put ${key}`, e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network_error');
  }
}

/** 写真を消す。無いものは無視される。失敗しても記録だけ残して続ける（消し残しは害が小さいため）。 */
export async function deleteFiles(keys: string[]): Promise<void> {
  const c = config();
  const list = keys.filter(validFileKey);
  if (!c || !list.length) return;
  try {
    const res = await fetch(`${c.url}/api.php?action=delete`, {
      method: 'POST',
      headers: { 'X-Kaigi-Token': c.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: list }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.log('[xserver-files] delete', res.status);
  } catch (e) {
    console.log('[xserver-files] delete', e instanceof Error ? e.message : e);
  }
}

const WINDOW = 6 * 60 * 60; // 秒

/**
 * 写真を見るための URL（期限つき・署名つき）。期限は6時間ごとの区切りの2つ先（6〜12時間後）にそろえる。
 * 同じ区切りのあいだは URL が変わらないので、ブラウザが写真を覚えておける。
 */
export function signedFileUrl(key: string, nowMs: number = Date.now()): string | null {
  const c = config();
  if (!c || !validFileKey(key)) return null;
  const exp = (Math.floor(nowMs / 1000 / WINDOW) + 2) * WINDOW;
  return `${c.url}/photo.php?k=${encodeURIComponent(key)}&e=${exp}&s=${signFile(c.secret, key, exp)}`;
}

/** photo.php（lib.php の kf_sign）と同じ署名：HMAC-SHA256(secret, "photo\n" + key + "\n" + exp) の base64url。 */
export function signFile(secret: string, key: string, exp: number): string {
  return createHmac('sha256', secret).update(`photo\n${key}\n${exp}`).digest('base64url');
}
