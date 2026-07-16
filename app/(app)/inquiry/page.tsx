import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import InquiryUI from '@/components/InquiryUI';

export default function InquiryPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <InquiryUI name={s.name} campus={s.campus} />;
}
