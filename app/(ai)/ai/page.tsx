import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import ChishokanAiUI from '@/components/ChishokanAiUI';

export default function ChishokanAiPage() {
  const s = getSession();
  if (!s) redirect('/login?next=/ai');
  return <ChishokanAiUI name={s.name} campus={s.campus} />;
}
