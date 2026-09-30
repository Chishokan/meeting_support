import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireSession } from '@/lib/core/auth';
import { canUseMeeting } from '@/lib/portalApps';
import Sidebar from '@/components/Sidebar';

export default function AppLayout({ children }: { children: ReactNode }) {
  const s = requireSession('/dashboard');
  // 会議DXは講師には開かない（lib/portalApps.ts の canUseMeeting）。メニューへ戻す。
  if (!canUseMeeting(s)) redirect('/');
  return (
    <div className="shell">
      <Sidebar name={s.name} campus={s.campus} />
      <main className="app-main">{children}</main>
    </div>
  );
}
