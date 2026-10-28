import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import { ADMIN_CAMPUS } from '@/lib/core/staff';
import ProgressUI from '@/components/ProgressUI';

export default function ProgressPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <ProgressUI name={s.name} campus={s.campus} isAdmin={s.campus === ADMIN_CAMPUS} />;
}
