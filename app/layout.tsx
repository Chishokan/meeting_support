import './globals.css';
import type { ReactNode } from 'react';
import EnvBanner from '@/components/EnvBanner';

export const metadata = {
  title: '智翔館 会議DX（テスト版）',
  description: '会議事前準備アシスタント：会議AI（事前報告・夏の結果報告）・議事録スレッド・ダッシュボード',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <EnvBanner />
        {children}
      </body>
    </html>
  );
}
