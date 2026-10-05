// 面談管理（別アプリ：RED_Interview_reservation・面談予約システム）の管理画面を開く設定と、
// メニューから開いたときに ID・パスワードなしで入れるようにする自動ログイン（SSO）のトークン作成。サーバ専用。
//
// しくみ：メニューのカードは /api/interview-sso?dept=red を開く。ここでログイン中の部門を確かめ、
// 「部門・氏名・有効期限（60秒）」に CHISHOKAN_SSO_SECRET で署名したトークンを付けて
// 面談予約システムの /api/admin/sso に転送する。面談予約システムは同じ鍵で署名を確かめてログインさせる。
// ★トークンの形は面談予約システムの lib/sso.js と揃えること（片方だけ変えると自動ログインできなくなる）。
//
// 面談予約システムの管理画面には ID・パスワードの入力画面が無く、ここからしか入れない。
// 未ログインで管理画面を開いた人も、管理画面がここ（/api/interview-sso）へ回してくる。
// CHISHOKAN_SSO_SECRET が未設定（または24文字未満）だと、管理画面に入れない（案内が出るだけ）。

import crypto from 'node:crypto';
import { ADMIN_CAMPUS } from './core/staff';

// 既定は本番の https://red-interview-reservation.vercel.app。別の環境を開きたいときだけ INTERVIEW_APP_URL で上書きする。
export function interviewAppUrl(): string {
  return (process.env.INTERVIEW_APP_URL?.trim() || 'https://red-interview-reservation.vercel.app').replace(/\/+$/, '');
}

// 面談予約システムの部門（URL の /red・/chutobu）と、それを開ける智翔館アプリの部門。
// ★開ける部門を変えるときはここだけ直す（メニューの表示と /api/interview-sso の両方がここを読む）。
export const INTERVIEW_DEPTS = {
  red: { label: 'RED部門', campuses: ['RED個別', ADMIN_CAMPUS] },
  chutobu: { label: '中等部', campuses: ['小中等部', ADMIN_CAMPUS] },
} as const;

export type InterviewDept = keyof typeof INTERVIEW_DEPTS;

export function isInterviewDept(v: string): v is InterviewDept {
  return Object.prototype.hasOwnProperty.call(INTERVIEW_DEPTS, v);
}

export function canUseInterview(dept: InterviewDept, campus: string): boolean {
  return (INTERVIEW_DEPTS[dept].campuses as readonly string[]).includes(campus);
}

const SSO_AUDIENCE = 'interview-admin';
const SSO_LIFETIME_SEC = 60;
const MIN_SECRET_LENGTH = 24;

function ssoSecret(): string | null {
  const s = process.env.CHISHOKAN_SSO_SECRET ?? '';
  return s.length >= MIN_SECRET_LENGTH ? s : null;
}

/**
 * 面談予約システムの管理画面を開く URL。
 * 自動ログインが有効なら署名付きトークンを付けた /api/admin/sso、無効なら管理画面そのもの。
 */
export function interviewAdminUrl(dept: InterviewDept, who: { name: string; campus: string }): string {
  const base = interviewAppUrl();
  const secret = ssoSecret();
  if (!secret) return `${base}/${dept}/admin`;

  const iat = Math.floor(Date.now() / 1000);
  const payload = { aud: SSO_AUDIENCE, dept, name: who.name, campus: who.campus, iat, exp: iat + SSO_LIFETIME_SEC };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  // dept は署名が通らなかったときにログイン画面へ戻す先（トークンの中身とは別に付ける）
  return `${base}/api/admin/sso?dept=${dept}&token=${encodeURIComponent(`${encoded}.${sig}`)}`;
}
