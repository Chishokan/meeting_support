// 面談管理（別アプリ：RED_Interview_reservation・面談予約システム）の管理画面を開く設定。
// 面談予約システムの管理画面にはログインの仕組みが無く、URL を開けばそのまま使える。
// メニューのカードは、下の部門の人にだけ開ける状態で出す（URL を知っていれば誰でも開ける点に注意）。

import { ADMIN_CAMPUS } from './core/staff';

// 既定は本番の https://red-interview-reservation.vercel.app。別の環境を開きたいときだけ INTERVIEW_APP_URL で上書きする。
export function interviewAppUrl(): string {
  return (process.env.INTERVIEW_APP_URL?.trim() || 'https://red-interview-reservation.vercel.app').replace(/\/+$/, '');
}

// 面談予約システムの部門（URL の /red・/chutobu）と、メニューでカードを開ける智翔館アプリの部門。
// ★開ける部門を変えるときはここだけ直す。
export const INTERVIEW_DEPTS = {
  red: { label: 'RED部門', campuses: ['RED個別', ADMIN_CAMPUS] },
  chutobu: { label: '中等部', campuses: ['小中等部', ADMIN_CAMPUS] },
} as const;

export type InterviewDept = keyof typeof INTERVIEW_DEPTS;

export function canUseInterview(dept: InterviewDept, campus: string): boolean {
  return (INTERVIEW_DEPTS[dept].campuses as readonly string[]).includes(campus);
}
