import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import YokoQaUI from '@/components/YokoQaUI';

// ヘルプデスクの最初の画面は要項QA（旧 /yoko-qa）。
// 要項は保護者対応で全部門が使うため、部門の制限はしない（個人情報を含まない）。
export default function HelpdeskYokoQaPage() {
  const s = getSession();
  if (!s) redirect('/login?next=/helpdesk');
  return <YokoQaUI name={s.name} campus={s.campus} />;
}
