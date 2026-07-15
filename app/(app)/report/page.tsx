import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import ReportUI from '@/components/ReportUI';

export default function ReportPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <ReportUI name={s.name} campus={s.campus} />;
}
