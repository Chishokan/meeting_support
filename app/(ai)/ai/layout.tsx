import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/core/auth';
import AppHeader from '@/components/AppHeader';
import { canUseChishokanAi } from '@/lib/chishokanAi/access';

// 智翔館AI。社内ナレッジ（knowledge/）を調べて答える相談窓口。
// 試用中は lib/chishokanAi/access.ts のメンバーだけが開ける。ログインは全アプリ共通。

export const metadata = {
  title: '智翔館AI',
  description: '社内の資料（理念・方針・要項・部門の計画・地域の情報・制作の型）をもとに答え、資料づくりを手伝う社内AI',
};

export default function ChishokanAiLayout({ children }: { children: ReactNode }) {
  const s = getSession();
  if (!s) redirect('/login?next=/ai');
  return (
    <div className="board-shell">
      <AppHeader title="智翔館AI" name={s.name} campus={s.campus} />
      <main className="board-main">
        {canUseChishokanAi(s.name) ? (
          children
        ) : (
          <div className="iqa-page">
            <div className="iqa-err">智翔館AIは試用中のため、まだ利用できません。使いたい場合はシステム担当（安藤）にご連絡ください。</div>
          </div>
        )}
      </main>
    </div>
  );
}
