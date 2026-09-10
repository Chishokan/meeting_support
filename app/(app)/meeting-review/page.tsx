import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import MeetingReviewUI from '@/components/MeetingReviewUI';

export default function MeetingReviewPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <MeetingReviewUI name={s.name} campus={s.campus} />;
}
