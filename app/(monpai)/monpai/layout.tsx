import type { ReactNode } from 'react';
import { requireSession } from '@/lib/core/auth';
import { canUseMonpai } from '@/lib/portalApps';
import AppHeader from '@/components/AppHeader';

// 門配管理。講師以外の全部門が利用できる（lib/portalApps.ts の canUseMonpai）。ログインは全アプリ共通。

export const metadata = {
  title: '智翔館 門配管理',
  description: '地区ごとの門配の月間計画・実績報告',
};

export default function MonpaiLayout({ children }: { children: ReactNode }) {
  const s = requireSession('/monpai');
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
          { href: '/monpai/schools', label: '学校' },
        ]}
      />
      <main className="board-main">
        {canUseMonpai(s) ? children : (
          <div className="soon-block">
            <div className="soon-badge">利用できません</div>
            <p>門配管理は社員（管理者・教室長・社員）のみ利用できます。</p>
          </div>
        )}
      </main>
    </div>
  );
}
