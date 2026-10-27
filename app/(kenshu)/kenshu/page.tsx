import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import KenshuSurveyUI from '@/components/KenshuSurveyUI';

export default function KenshuPage() {
  const s = getSession();
  if (!s) redirect('/login?next=/kenshu');
  return <KenshuSurveyUI name={s.name} campus={s.campus} />;
}
