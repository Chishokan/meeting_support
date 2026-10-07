import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import { canSeeAllInterviewNotes } from '@/lib/interviewNotes/access';
import InterviewNotesUI from '@/components/InterviewNotesUI';

export default function InterviewNotesPage() {
  const s = getSession();
  if (!s) redirect('/login?next=/interview-notes');
  return <InterviewNotesUI name={s.name} campus={s.campus} seeAll={canSeeAllInterviewNotes(s.campus)} />;
}
