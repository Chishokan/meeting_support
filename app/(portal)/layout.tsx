import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/core/auth';
import PortalHeader from '@/components/PortalHeader';

// 総合画面（ログイン後の最初の画面）。ここから各アプリを選ぶ。
// ログインは全アプリ共通（同じセッション Cookie）。

export const metadata = {
  title: '智翔館アプリ',
  description: '智翔館の業務アプリの入口（会議DX・問合せ管理ほか）',
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  const s = getSession();
  if (!s) redirect('/login');
  return (
    <div className="board-shell">
      <PortalHeader name={s.name} campus={s.campus} />
      <main className="board-main">{children}</main>
    </div>
  );
}
