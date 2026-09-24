import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/auth';
import { canUseInquiryBoard } from '@/lib/inquiryBoardAccess';
import BoardHeader from '@/components/BoardHeader';

// 問合せ管理は会議DXのメニューには載せない独立した画面（URL を直接共有して使う）。
// そのため会議DXのサイドバー（app/(app)/layout.tsx）は使わず、専用のヘッダだけを付ける。
// ログインは会議DXと共通（同じセッション Cookie）。

export const metadata = {
  title: '智翔館 問合せ管理',
  description: '小中等部の問い合わせを校舎ごとに登録・追客する台帳',
};

export default function BoardLayout({ children }: { children: ReactNode }) {
  const s = getSession();
  if (!s) redirect('/login?next=/inquiry-board');

  if (!canUseInquiryBoard(s.campus)) {
    return (
      <div className="board-shell">
        <BoardHeader name={s.name} campus={s.campus} />
        <main className="board-main">
          <div className="soon-block">
            <div className="soon-badge">閲覧できません</div>
            <p>問合せ管理は小中等部と管理部門のみ利用できます。</p>
            <p className="soon-hint">生徒・保護者の情報を含むため、部門を限定しています。</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="board-shell">
      <BoardHeader name={s.name} campus={s.campus} />
      <main className="board-main">{children}</main>
    </div>
  );
}
