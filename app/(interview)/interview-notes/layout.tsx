import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/core/auth';
import AppHeader from '@/components/AppHeader';

// 面談記録。全部門が記録を作れる（見られるのは自部門の記録だけ。lib/interviewNotes/access.ts）。
// ログインは全アプリ共通。

export const metadata = {
  title: '智翔館 面談記録',
  description: '面談の録音から面談記録をまとめる',
};

export default function InterviewNotesLayout({ children }: { children: ReactNode }) {
  const s = getSession();
  if (!s) redirect('/login?next=/interview-notes');
  return (
    <div className="board-shell">
      <AppHeader title="面談記録" name={s.name} campus={s.campus} />
      <main className="board-main">{children}</main>
    </div>
  );
}
