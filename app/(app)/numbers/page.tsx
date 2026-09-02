import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import NumbersUI from '@/components/NumbersUI';

export default function NumbersPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <NumbersUI name={s.name} campus={s.campus} />;
}
