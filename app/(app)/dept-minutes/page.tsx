import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import DeptMinutesUI from '@/components/DeptMinutesUI';

export default function DeptMinutesPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <DeptMinutesUI name={s.name} campus={s.campus} />;
}
