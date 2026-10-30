import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import { campusesFor } from '@/lib/numberReports';
import { TASK_REPORT_DEPT, weekOptions } from '@/lib/taskReport';
import TaskReportUI from '@/components/TaskReportUI';

export const dynamic = 'force-dynamic';

export default function TaskReportPage() {
  const s = getSession();
  if (!s) redirect('/login');
  // 対象週の選択肢は開いた日（日本時間）で決まるので、サーバで作って渡す
  const { options, defaultValue } = weekOptions();
  return (
    <TaskReportUI
      name={s.name}
      campus={s.campus}
      allowed={s.campus === TASK_REPORT_DEPT}
      schools={campusesFor(TASK_REPORT_DEPT)}
      weeks={options}
      defaultWeek={defaultValue}
    />
  );
}
