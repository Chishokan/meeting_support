import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/core/auth';
import { canUseMoshi } from '@/lib/moshi/access';
import Sidebar from '@/components/Sidebar';
import AppHeader from '@/components/AppHeader';
import { NotAllowed } from '@/components/MoshiShared';

// 成績管理（総合メニューのカード「成績管理」）。いまは本番レベル模試（/moshi）の画面だけ。
// 生徒の氏名・成績を扱うので、使える部門（lib/moshi/access.ts の MOSHI_DEPTS）の職員だけが開ける（各画面と API でも確かめる）。
// 画面の組み方（左メニュー・印刷）は会議DXと同じ。左メニューの中身は components/Sidebar.tsx の app="seiseki"。

export const metadata = {
  title: '智翔館 成績管理',
  description: '本番レベル模試の成績入力・成績表・受験票・面談',
};

export default function SeisekiLayout({ children }: { children: ReactNode }) {
  const s = getSession();
  if (!s) redirect('/login?next=/moshi');
  if (!canUseMoshi(s.campus)) {
    return (
      <div className="board-shell">
        <AppHeader title="成績管理" name={s.name} campus={s.campus} />
        <main className="board-main"><NotAllowed title="成績管理" /></main>
      </div>
    );
  }
  return (
    <div className="shell">
      <Sidebar name={s.name} campus={s.campus} app="seiseki" />
      <main className="app-main">{children}</main>
    </div>
  );
}
