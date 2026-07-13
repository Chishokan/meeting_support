import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import MinutesUI from '@/components/MinutesUI';

export default function MinutesPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <MinutesUI name={s.name} campus={s.campus} />;
}
