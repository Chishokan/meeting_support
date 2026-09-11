import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import YokoQaUI from '@/components/YokoQaUI';

// 要項は保護者対応で全部門が使うため、部門の制限はしない（個人情報を含まない）。
export default function YokoQaPage() {
  const session = getSession();
  if (!session) redirect('/login');
  return <YokoQaUI name={session.name} campus={session.campus} />;
}
