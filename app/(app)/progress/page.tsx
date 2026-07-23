import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ADMIN_CAMPUS } from '@/lib/staff';
import ProgressUI from '@/components/ProgressUI';

export default function ProgressPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <ProgressUI name={s.name} campus={s.campus} isAdmin={s.campus === ADMIN_CAMPUS} />;
}
