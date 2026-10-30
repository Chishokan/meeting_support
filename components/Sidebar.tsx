'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';

type NavItem = { href: string; label: string; desc?: string; soon?: boolean; hidden?: boolean; depts?: string[] };
type NavGroup = { title?: string; items: NavItem[] };

// 左メニュー。会議DXの基本は「部門会議」（事前共有 → 録音 → 議事録 → 次回の事前共有）なので、
// ダッシュボードのすぐ下に置く。全体会議で使うものは見出しの下にまとめる。
// 要項QAと「ご意見・不具合の報告」はヘルプデスク（総合メニューのアプリ・/helpdesk）へ移した。
// ★hidden: true はメニューに出さないだけで、画面は URL で開ける。戻すときは hidden を外す。
// ★depts を付けた項目は、その部門でログインした人にだけ出す（項目が1つも出ない見出しは見出しごと出さない）。
const NAV: NavGroup[] = [
  {
    items: [
      { href: '/dashboard', label: 'ダッシュボード', desc: '今日の会議・直近の議事録' },
      { href: '/dept-minutes', label: '部門会議', desc: '事前共有 → 録音 → 議事録 → 次回へ' },
    ],
  },
  {
    title: '全体会議',
    items: [
      { href: '/numbers', label: '数値報告', desc: '会議前｜月次・講習期の数値を登録' },
      { href: '/chat', label: '会議AI', desc: '会議前｜事前報告・月次報告・講習の結果報告' },
      { href: '/meeting-review', label: '全体会議振り返り', desc: '会議後｜感想・気づき・やると決めたこと' },
      // 事前報告は会議AIの「報告完了」で自動転記するので、メニューからは外す（会議AIの画面から手で転記もできる）。
      { href: '/report', label: '報告の転記', desc: '事前報告を会議ドキュメントへ', hidden: true },
      { href: '/progress', label: '中間報告', desc: '次の会議まで｜決議事項の進捗', hidden: true },
    ],
  },
  {
    title: '小中等部',
    items: [
      { href: '/task-report', label: '重要タスク報告', desc: '毎週｜マイルストーンの進み具合と改善・工夫', depts: ['小中等部'] },
    ],
  },
];

const ALL_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

// 前方一致だけだと、頭が同じ別の画面（/report と /report-xxx など）までアクティブになるので、
// 完全一致か「その配下のパス」だけをアクティブとみなす。
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + '/');
}

export default function Sidebar({ name, campus }: { name: string; campus: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  // 非表示の画面を URL で開いたときも、スマホの上のバーに画面名を出す。
  const current = ALL_ITEMS.find((n) => isActive(pathname, n.href));

  const groups = NAV
    .map((g) => ({ ...g, items: g.items.filter((n) => !n.hidden && (!n.depts || n.depts.includes(campus))) }))
    .filter((g) => g.items.length > 0);

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
          <Link href="/" className="sidebar-back" onClick={() => setOpen(false)}>← メニューへ</Link>
          <div className="brand-title">智翔館 会議DX</div>
          <div className="brand-sub">会議事前準備アシスタント</div>
        </div>

        <nav className="sidebar-nav">
          {groups.map((g, gi) => (
            <div key={g.title ?? gi} className="nav-group">
              {g.title && <div className="nav-group-title">{g.title}</div>}
              {g.items.map((n) => {
                const active = isActive(pathname, n.href);
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
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-user">
            <div className="user-campus">{campus}</div>
            <div className="user-name">{name} さん</div>
          </div>
          <button className="logout-btn" onClick={logout}>ログアウト</button>
          <div className="app-version">v{process.env.NEXT_PUBLIC_APP_VERSION}</div>
        </div>
      </aside>
    </>
  );
}
