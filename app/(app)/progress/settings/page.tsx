import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import { ADMIN_CAMPUS } from '@/lib/core/staff';
import ProgressItemsAdmin from '@/components/ProgressItemsAdmin';

export default function ProgressSettingsPage() {
  const s = getSession();
  if (!s) redirect('/login');
  if (s.campus !== ADMIN_CAMPUS) redirect('/progress');
  return <ProgressItemsAdmin />;
}
