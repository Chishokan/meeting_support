'use client';

// 総合画面から開く各アプリの共通ヘッダ（← メニュー／アプリ名／画面の切り替え／ログアウト）。
// 見た目は問合せ管理と同じ board-* のスタイルを使う。

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type AppNavItem = { href: string; label: string };

export default function AppHeader({
  title, name, campus, nav = [],
}: { title: string; name: string; campus: string; nav?: AppNavItem[] }) {
  const pathname = usePathname();
  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  }
  return (
    <header className="board-head">
      <div className="board-brand">
        <Link href="/" className="board-back">← メニュー</Link>
        <span className="board-title">{title}</span>
        {nav.length > 0 && (
          <nav className="app-nav">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={`app-nav-item ${pathname === n.href ? 'active' : ''}`}>
                {n.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
      <div className="board-who">
        <span className="board-user">{campus}／{name} さん</span>
        <button className="board-logout" onClick={logout}>ログアウト</button>
      </div>
    </header>
  );
}
