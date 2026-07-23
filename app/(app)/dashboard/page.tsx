import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ADMIN_CAMPUS } from '@/lib/staff';
import DashboardUI from '@/components/DashboardUI';

export default function DashboardPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <DashboardUI name={s.name} campus={s.campus} isAdmin={s.campus === ADMIN_CAMPUS} />;
}
