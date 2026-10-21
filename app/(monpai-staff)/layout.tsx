import type { ReactNode } from 'react';

// 門配スタッフ（大学生・アルバイト）専用の画面。社員のログインとは別で、ここから他のアプリには行けない。
// ログインの確認は各ページで行う（ログイン画面は確認しない）。

export const metadata = {
  title: '智翔館 門配報告',
  description: '門配スタッフ用：自分の担当の門配の実績報告と月間の計画',
};

export default function MonpaiStaffLayout({ children }: { children: ReactNode }) {
  return <div className="board-shell">{children}</div>;
}
