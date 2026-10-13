import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import KaizenUI from '@/components/KaizenUI';

export default function KaizenPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <KaizenUI name={s.name} />;
}
