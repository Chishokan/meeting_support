import Link from 'next/link';
import { getSession } from '@/lib/core/auth';
import { portalApps } from '@/lib/portalApps';

export default function PortalPage() {
  // layout でログインを確認済み。ここではロール・部門・担当教室による出し分けに使う。
  const s = getSession();
  if (!s) return null;

  return (
    <div className="portal">
      <h1 className="portal-title">使うアプリを選んでください</h1>
      <div className="portal-grid">
        {portalApps().map((a) => {
          const allowed = !a.canUse || a.canUse(s);
          const open = a.status === 'ready' && allowed;
          const body = (
            <>
              <div className="portal-card-head">
                <span className="portal-card-name">{a.name}</span>
                {a.status === 'soon' && <span className="portal-badge">準備中</span>}
              </div>
              <p className="portal-card-desc">{a.desc}</p>
              {a.status === 'ready' && !allowed && a.deniedNote && (
                <p className="portal-card-note">{a.deniedNote}</p>
              )}
            </>
          );
          if (!open) {
            return (
              <div key={a.id} className="portal-card disabled" aria-disabled="true">
                {body}
              </div>
            );
          }
          return a.external ? (
            <a key={a.id} href={a.href} className="portal-card">
              {body}
            </a>
          ) : (
            <Link key={a.id} href={a.href} className="portal-card">
              {body}
            </Link>
          );
        })}
      </div>
      {s.role === 'admin' && (
        <p className="portal-admin">
          <Link href="/admin/users">アカウント管理（発行・ロール・担当教室）</Link>
        </p>
      )}
      <p className="portal-version">智翔館アプリ v{process.env.NEXT_PUBLIC_APP_VERSION}</p>
    </div>
  );
}
