import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import ConsultUI from '@/components/ConsultUI';

export default function ConsultPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <ConsultUI name={s.name} campus={s.campus} />;
}
