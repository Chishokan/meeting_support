import Link from 'next/link';
import { getSession } from '@/lib/core/auth';
import { PORTAL_APPS } from '@/lib/portalApps';

export default function PortalPage() {
  // layout でログインを確認済み。ここでは部門による出し分けにだけ使う。
  const campus = getSession()?.campus ?? '';

  return (
    <div className="portal">
      <h1 className="portal-title">使うアプリを選んでください</h1>
      <div className="portal-grid">
        {PORTAL_APPS.map((a) => {
          const allowed = !a.canUse || a.canUse(campus);
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
          return open ? (
            <Link key={a.id} href={a.href} className="portal-card">
              {body}
            </Link>
          ) : (
            <div key={a.id} className="portal-card disabled" aria-disabled="true">
              {body}
            </div>
          );
        })}
      </div>
      <p className="portal-version">智翔館アプリ v{process.env.NEXT_PUBLIC_APP_VERSION}</p>
    </div>
  );
}
