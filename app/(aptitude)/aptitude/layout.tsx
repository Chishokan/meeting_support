import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/core/auth';
import { canUseAptitude, APTITUDE_DEPTS } from '@/lib/aptitude/access';
import AppHeader from '@/components/AppHeader';

// 適性検査（職員側）。性格検査の結果を扱うため、開ける部門を絞る（lib/aptitude/access.ts）。
// 受検者が開く受検画面は app/(exam)/exam/[token]/（ログイン不要）。

export const metadata = {
  title: '智翔館 適性検査',
  description: '講師・事務スタッフ・社員の採用選考で使う適性検査の受検管理と結果',
};

const NAV = [
  { href: '/aptitude', label: '受検者' },
  { href: '/aptitude/history', label: '受検履歴' },
  { href: '/aptitude/master', label: '設問・判定基準' },
];

export default function AptitudeLayout({ children }: { children: ReactNode }) {
  const s = getSession();
  if (!s) redirect('/login?next=/aptitude');

  if (!canUseAptitude(s.campus)) {
    return (
      <div className="board-shell">
        <AppHeader title="適性検査" name={s.name} campus={s.campus} />
        <main className="board-main">
          <div className="soon-block">
            <div className="soon-badge">閲覧できません</div>
            <p>適性検査は{APTITUDE_DEPTS.join('、')}のみ利用できます。</p>
            <p className="soon-hint">性格検査の結果は機微な個人情報のため、見られる人を限定しています。</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="board-shell">
      <AppHeader title="適性検査" name={s.name} campus={s.campus} nav={NAV} />
      <main className="board-main">{children}</main>
    </div>
  );
}
