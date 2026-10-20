import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/core/auth';
import AppHeader from '@/components/AppHeader';

// ヘルプデスク。困ったときに開く画面をまとめたアプリ（旧・会議DXの左メニューにあった要項QAと、
// ご意見・不具合の報告、操作マニュアルのダウンロード）。どれも個人情報を含まないので、全部門が利用できる。
// ログインは全アプリ共通。

export const metadata = {
  title: '智翔館 ヘルプデスク',
  description: '要項QA（実施要項の確認）、操作マニュアル、アプリへのご意見・不具合の報告',
};

const NAV = [
  { href: '/helpdesk', label: '要項QA' },
  { href: '/helpdesk/manual', label: 'マニュアル' },
  { href: '/helpdesk/feedback', label: 'ご意見・不具合の報告' },
];

export default function HelpdeskLayout({ children }: { children: ReactNode }) {
  const s = getSession();
  if (!s) redirect('/login?next=/helpdesk');
  return (
    <div className="board-shell">
      <AppHeader title="ヘルプデスク" name={s.name} campus={s.campus} nav={NAV} />
      <main className="board-main">{children}</main>
    </div>
  );
}
