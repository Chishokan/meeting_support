import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: '智翔館 会議DX（テスト版）',
  description: '会議事前準備アシスタント：AI壁打ち・議事録スレッド・ダッシュボード',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
