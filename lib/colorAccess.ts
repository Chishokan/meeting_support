// 給与アプリ（Color：給与・シフト、講師育成）を智翔館アプリから開ける人。
//   管理者ロールの人と、COLOR_APP_MEMBERS に名前を書いた人だけ。ほかの社員にはメニューのカードを出さない。
//   Vercel の環境変数 COLOR_APP_MEMBERS にログイン名（給与アプリの氏名）をカンマ区切りで書く。「*」で社員全員。
//   未設定なら既定のメンバー。
import type { HubRole } from './core/auth';

export const DEFAULT_COLOR_MEMBERS = ['亀谷新', '福元崇恭'];

const key = (s: string) => s.replace(/[\s　]+/g, '');

export function colorMembers(env: string | undefined = process.env.COLOR_APP_MEMBERS): string[] | '*' {
  const v = (env ?? '').trim();
  if (v === '*') return '*';
  const names = v.split(/[,、，\n]+/).map((s) => key(s)).filter(Boolean);
  return names.length ? names : DEFAULT_COLOR_MEMBERS;
}

export function canUseColor(name: string, role: HubRole | undefined, env?: string): boolean {
  if (role === 'admin') return true;
  const m = colorMembers(env);
  return m === '*' || m.includes(key(name));
}
