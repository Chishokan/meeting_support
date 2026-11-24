// セッション Cookie の名前と有効期間、middleware 用のロールの読み取りだけを置く。middleware（Edge で動く）からも読めるよう、
// Node の機能（crypto など）を使う auth.ts とは分けている。
export const SESSION_COOKIE = 'chishokan_session';
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12時間

/**
 * Cookie の中のロールを、署名を確かめずに読む（middleware 用。Edge では auth.ts の署名の確認を使えないため）。
 * ★スタッフに開いていない画面・API を「止める」ためだけに使う（このロールだから通す、という使い方はしない）。
 *   Cookie を書き換えると署名が合わなくなり、各画面・API の getSession（auth.ts）でログインしていない扱いになる。
 * 署名付き（v2.）でない Cookie（従来のログイン）にはロールが無いので undefined。形は auth.ts の encodeSession。
 */
export function peekSessionRole(raw: string | undefined | null): string | undefined {
  if (!raw || !raw.startsWith('v2.')) return undefined;
  const payload = raw.split('.')[1] ?? '';
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const s = JSON.parse(new TextDecoder().decode(bytes)) as { role?: unknown } | null;
    return typeof s?.role === 'string' ? s.role : undefined;
  } catch {
    return undefined;
  }
}
