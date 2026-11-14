import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, SESSION_MAX_AGE } from './sessionCookie';

export { SESSION_COOKIE, SESSION_MAX_AGE };

// ロール（給与アプリの users.role と同じ値）。
//   admin＝管理者 / staff＝社員（教室担当者） / employee＝社員（授業担当者） / teacher＝スタッフ
export type HubRole = 'admin' | 'staff' | 'employee' | 'teacher';

// name・campus は従来どおり（全アプリがこの2つで出し分けている）。
// campus は「いま使っている部門」。兼務の人はログイン時に選ぶ。
// uid 以降は共通ログイン（メール＋パスワード）で入った人だけが持つ。
export type Session = {
  name: string;
  campus: string;
  uid?: number;
  email?: string;
  role?: HubRole;
  depts?: string[];
  deptAdmin?: boolean;
  rooms?: string[];
  exp?: number; // 有効期限（UNIX秒）
};

// ------------------------------------------------------------
// 署名付きセッション（v1.0.0〜）
//   形式：v2.<内容のbase64url>.<HMAC-SHA256のbase64url>
//   鍵：SESSION_SECRET（無ければ HUB_API_SECRET）。32文字以上。
//   鍵が無いあいだは、従来の署名なしの形で作る（本番を壊さないため）。
//
// 従来のログイン（職員を選ぶ）で作られた署名なしの Cookie は、
// 並行運用のあいだだけ受け付ける。LEGACY_LOGIN=off にすると受け付けない（統合計画 第7段階）。
// ------------------------------------------------------------
function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.HUB_API_SECRET || '';
  return s.length >= 32 ? s : '';
}

export function legacyLoginEnabled(): boolean {
  return (process.env.LEGACY_LOGIN || '').toLowerCase() !== 'off';
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload: string, key: string): string {
  return b64url(createHmac('sha256', key).update(payload).digest());
}

export function encodeSession(s: Session): string {
  const key = secret();
  if (!key) return Buffer.from(JSON.stringify(s), 'utf8').toString('base64');
  const body: Session = { ...s, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE };
  const payload = b64url(Buffer.from(JSON.stringify(body), 'utf8'));
  return `v2.${payload}.${sign(payload, key)}`;
}

export function decodeSession(raw: string | undefined | null): Session | null {
  if (!raw) return null;
  try {
    if (raw.startsWith('v2.')) {
      const key = secret();
      const [, payload, sig] = raw.split('.');
      if (!key || !payload || !sig) return null;
      const want = Buffer.from(sign(payload, key));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
      const s = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as Session;
      if (!s.exp || s.exp < Date.now() / 1000) return null;
      return s.name && typeof s.campus === 'string' ? s : null;
    }
    // 従来の署名なし（並行運用のあいだだけ）
    if (!legacyLoginEnabled()) return null;
    const s = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Session;
    if (!s || typeof s.name !== 'string' || typeof s.campus !== 'string') return null;
    // 署名なしの Cookie は書き換えられるので、共通ログインの情報は信用しない
    return { name: s.name, campus: s.campus };
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  return decodeSession(cookies().get(SESSION_COOKIE)?.value);
}

// レスポンスに付ける Cookie の設定（ログイン・引き継ぎで共通）
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_MAX_AGE,
};
