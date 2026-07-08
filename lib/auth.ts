import { cookies } from 'next/headers';

export type Session = { name: string; campus: string };
export const SESSION_COOKIE = 'chishokan_session';

export function encodeSession(s: Session): string {
  return Buffer.from(JSON.stringify(s), 'utf8').toString('base64');
}

// テスト版の簡易セッション（Base64のみ・署名なし）。本番では署名付きセッションや
// Google SSO（NextAuth 等）に置き換えること。
export function getSession(): Session | null {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Session;
  } catch {
    return null;
  }
}
