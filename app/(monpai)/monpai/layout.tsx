import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/core/auth';
import AppHeader from '@/components/AppHeader';

// 門配管理。全部門が利用できる。ログインは全アプリ共通。

export const metadata = {
  title: '智翔館 門配管理',
  description: '地区ごとの門配の月間計画・実績報告',
};

export default function MonpaiLayout({ children }: { children: ReactNode }) {
  const s = getSession();
  if (!s) redirect('/login?next=/monpai');
  return (
    <div className="board-shell">
      <AppHeader
        title="門配管理"
        name={s.name}
        campus={s.campus}
        nav={[
          { href: '/monpai', label: '月間一覧' },
          { href: '/monpai/report', label: '実績報告' },
          { href: '/monpai/materials', label: '配布物' },
        ]}
      />
      <main className="board-main">{children}</main>
    </div>
  );
}
