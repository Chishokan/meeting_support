import type { ReactNode } from 'react';

// 受検者が開く受検画面。ログイン不要（受検URLのトークンだけで開く）。職員側のヘッダ・メニューは出さない。
// 検索エンジンに載らないよう noindex を付ける。

export const metadata = {
  title: '適性検査｜智翔館グループ',
  description: '採用選考の適性検査',
  robots: { index: false, follow: false },
};

export default function ExamLayout({ children }: { children: ReactNode }) {
  return (
    <div className="exam-shell">
      <header className="exam-head">
        <span className="exam-brand">智翔館グループ</span>
        <span className="exam-title">適性検査</span>
      </header>
      <main className="exam-main">{children}</main>
    </div>
  );
}
