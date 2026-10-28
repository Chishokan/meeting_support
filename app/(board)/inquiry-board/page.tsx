import { getSession } from '@/lib/core/auth';
import { redirect } from 'next/navigation';
import InquiryBoardUI from '@/components/InquiryBoardUI';

export default function InquiryBoardPage() {
  const s = getSession();
  if (!s) redirect('/login?next=/inquiry-board');
  return <InquiryBoardUI name={s.name} />;
}
