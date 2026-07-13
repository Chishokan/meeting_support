'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';

type NavItem = { href: string; label: string; desc?: string; soon?: boolean };

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'ダッシュボード', desc: '準備状況の一覧' },
  { href: '/chat', label: 'AI壁打ち', desc: '事前報告づくり' },
  { href: '/minutes', label: '議事録スレッド', desc: '会議ごとに整理' },
  { href: '/todos', label: 'ToDo・宿題', desc: '決定事項の追跡', soon: true },
  { href: '/agenda', label: 'アジェンダ/テンプレート', desc: '会議の型', soon: true },
];

export default function Sidebar({ name, campus }: { name: string; campus: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const current = NAV.find((n) => pathname?.startsWith(n.href));

  return (
    <>
      {/* モバイル用トップバー */}
      <div className="mobilebar">
        <button className="hamburger" onClick={() => setOpen(true)} aria-label="メニュー">☰</button>
        <span className="mobilebar-title">{current?.label ?? '智翔館 会議DX'}</span>
        <span className="mobilebar-who">{name}</span>
      </div>

      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}

      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-title">智翔館 会議DX</div>
          <div className="brand-sub">会議事前準備アシスタント</div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map((n) => {
            const active = pathname?.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`nav-item ${active ? 'active' : ''} ${n.soon ? 'soon' : ''}`}
                onClick={() => setOpen(false)}
              >
                <span className="nav-body">
                  <span className="nav-label">
                    {n.label}
                    {n.soon && <span className="nav-badge">準備中</span>}
                  </span>
                  {n.desc && <span className="nav-desc">{n.desc}</span>}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-user">
            <div className="user-campus">{campus}</div>
            <div className="user-name">{name} さん</div>
          </div>
          <button className="logout-btn" onClick={logout}>ログアウト</button>
        </div>
      </aside>
    </>
  );
}
