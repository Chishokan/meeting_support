'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// 問合せ管理（/inquiry-board）専用のヘッダ。会議DXのサイドバーは使わない。
// 画面の切り替え（台帳／AIに聞く）は門配管理などと同じ app-nav の見た目にそろえる。
// 「AIに聞く」は旧・会議DXの「問い合わせQA」。同じ台帳を使い、使える部門も同じなのでここへ移した。
const NAV = [
  { href: '/inquiry-board', label: '台帳' },
  { href: '/inquiry-board/qa', label: 'AIに聞く', badge: 'テスト中' },
];

export default function BoardHeader({ name, campus }: { name: string; campus: string }) {
  const pathname = usePathname();
  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login?next=/inquiry-board';
  }
  return (
    <header className="board-head">
      <div className="board-brand">
        <Link href="/" className="board-back">← メニュー</Link>
        <span className="board-title">智翔館 問合せ管理</span>
        <span className="board-sub">小中等部</span>
        <nav className="app-nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`app-nav-item ${pathname === n.href ? 'active' : ''}`}>
              {n.label}
              {n.badge && <span className="app-nav-badge">{n.badge}</span>}
            </Link>
          ))}
        </nav>
      </div>
      <div className="board-who">
        <span className="board-user">{campus}／{name} さん</span>
        <button className="board-logout" onClick={logout}>ログアウト</button>
      </div>
    </header>
  );
}
