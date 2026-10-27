import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/core/auth';
import AppHeader from '@/components/AppHeader';

// 全体研修会アンケート。総合メニューの独立アプリ（全部門が利用できる）。
// ログインは全アプリ共通。中身・回数の設定は lib/kenshu/survey.ts。

export const metadata = {
  title: '智翔館 全体研修会アンケート',
  description: 'この1年で、仕事と人生・プライベートで達成したいこと・やってみたいことを書き出す事前アンケート',
};

export default function KenshuLayout({ children }: { children: ReactNode }) {
  const s = getSession();
  if (!s) redirect('/login?next=/kenshu');
  return (
    <div className="board-shell">
      <AppHeader title="全体研修会アンケート" name={s.name} campus={s.campus} />
      <main className="board-main">{children}</main>
    </div>
  );
}
