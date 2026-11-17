import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/core/auth';
import { canUseEvent, EVENT_DEPTS } from '@/lib/eventList/access';
import AppHeader from '@/components/AppHeader';

// イベント申込管理。総合メニューの独立アプリ（専用レイアウト・サイドバー無し）。
// 生徒の氏名・夢・志望校と申込フォームの回答を扱うので、使える部門（lib/eventList/access.ts）の職員だけが開ける（API でも確かめる）。
// 追いかけるイベントの中身は lib/eventList/event.ts。

export const metadata = {
  title: '智翔館 イベント申込管理',
  description: 'イベントの声掛け名簿と申込状況',
};

export default function EventLayout({ children }: { children: ReactNode }) {
  const s = getSession();
  if (!s) redirect('/login?next=/event');
  return (
    <div className="board-shell">
      <AppHeader title="イベント申込管理" name={s.name} campus={s.campus} />
      <main className="board-main">
        {canUseEvent(s.campus) ? children : (
          <div className="soon-block">
            <div className="soon-badge">閲覧できません</div>
            <p>イベント申込管理は{EVENT_DEPTS.join('と')}のみ利用できます。</p>
            <p className="soon-hint">生徒・保護者の情報を含むため、部門を限定しています。</p>
          </div>
        )}
      </main>
    </div>
  );
}
