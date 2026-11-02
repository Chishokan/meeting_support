import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import TaskCoachUI from '@/components/TaskCoachUI';

export default function TaskCoachPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <TaskCoachUI name={s.name} campus={s.campus} />;
}
