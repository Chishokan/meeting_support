import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import { canUseMoshi } from '@/lib/moshi/access';
import { NotAllowed } from '@/components/MoshiShared';
import MoshiInterviewUI from '@/components/MoshiInterviewUI';

export const dynamic = 'force-dynamic';

// 生徒の氏名・成績を扱うので、小中等部の職員だけが開ける（API でも確かめる）。
export default function Page() {
  const s = getSession();
  if (!s) redirect('/login');
  if (!canUseMoshi(s.campus)) return <NotAllowed title="本番レベル模試｜面談（個人成績）" />;
  return <MoshiInterviewUI name={s.name} />;
}
