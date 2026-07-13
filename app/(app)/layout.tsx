import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/auth';
import Sidebar from '@/components/Sidebar';

export default function AppLayout({ children }: { children: ReactNode }) {
  const s = getSession();
  if (!s) redirect('/login');
  return (
    <div className="shell">
      <Sidebar name={s.name} campus={s.campus} />
      <main className="app-main">{children}</main>
    </div>
  );
}
