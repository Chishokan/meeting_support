import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import DashboardUI from '@/components/DashboardUI';

export default function DashboardPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <DashboardUI name={s.name} campus={s.campus} />;
}
