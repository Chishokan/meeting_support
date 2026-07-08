import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: '智翔館 週間計画アシスタント（テスト版）',
  description: '社内向け 週間計画づくりAIアシスタント',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
