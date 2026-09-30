import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role } from './roles';

// ログインのセッション（Cookie）。全アプリ共通の1回ログイン。
// 中身は「<内容の base64url>.<署名の base64url>」。署名は HMAC-SHA256（鍵は SESSION_SECRET）。
// 署名が合わない・期限切れの Cookie は「未ログイン」として扱うので、手で書き換えても通らない。
//
// name / campus は従来どおり（各アプリは「氏名」「事業部（campus）」で報告先などを決めている）。

export type Session = {
  uid: string;
  email: string;
  name: string;
  campus: string;         // 事業部（app_users.dept）
  role: Role;
  classrooms: string[];   // 担当教室
  mustChange?: boolean;   // 初期パスワードのまま（パスワード変更画面へ誘導する）
  exp: number;            // 有効期限（UNIX 秒）
};

export const SESSION_COOKIE = 'chishokan_session';
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12時間

function secret(): string {
  return (process.env.SESSION_SECRET ?? '').trim();
}

/** SESSION_SECRET が十分な長さで設定されているか。未設定ならログインさせない。 */
export function sessionConfigured(): boolean {
  return secret().length >= 32;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function encodeSession(s: Omit<Session, 'exp'>): string {
  const body: Session = { ...s, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE };
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(raw: string | undefined): Session | null {
  if (!raw || !sessionConfigured()) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session;
    if (!s || typeof s.exp !== 'number' || s.exp < Date.now() / 1000) return null;
    if (!s.uid || !s.name) return null;
    return s;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  return decodeSession(cookies().get(SESSION_COOKIE)?.value);
}

/** Cookie の属性（本番は HTTPS なので Secure を付ける）。 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  };
}

/**
 * 画面（layout）用：ログインしていなければログイン画面へ、初期パスワードのままならパスワード変更画面へ送る。
 * next はログイン後に戻す先（"/" で始まる相対パス）。
 */
export function requireSession(next = '/'): Session {
  const s = getSession();
  if (!s) redirect(next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`);
  if (s.mustChange) redirect('/password');
  return s;
}
