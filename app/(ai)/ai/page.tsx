import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import { roleCanUseApp } from '@/lib/roleAccess';
import ChishokanAiUI from '@/components/ChishokanAiUI';

export default function ChishokanAiPage() {
  const s = getSession();
  if (!s) redirect('/login?next=/ai');
  // スタッフはヘルプデスクを開けない（lib/roleAccess.ts）ので、不具合報告・要望の窓でヘルプデスクへのリンクを出さない
  return <ChishokanAiUI name={s.name} campus={s.campus} helpdesk={roleCanUseApp(s.role, 'helpdesk')} />;
}
