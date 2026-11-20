import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import { TASK_EVAL_DEPT } from '@/lib/taskEval';
import TaskEvalUI from '@/components/TaskEvalUI';

export const dynamic = 'force-dynamic';

export default function TaskEvalPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <TaskEvalUI name={s.name} campus={s.campus} allowed={s.campus === TASK_EVAL_DEPT} />;
}
