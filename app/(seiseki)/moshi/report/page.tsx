import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import { canUseMoshi } from '@/lib/moshi/access';
import { NotAllowed } from '@/components/MoshiShared';
import MoshiReportUI from '@/components/MoshiReportUI';

export const dynamic = 'force-dynamic';

// 生徒の氏名・成績を扱うので、使える部門（lib/moshi/access.ts。いまは管理部門）の職員だけが開ける（レイアウトと API でも確かめる）。
export default function Page() {
  const s = getSession();
  if (!s) redirect('/login');
  if (!canUseMoshi(s.campus)) return <NotAllowed title="本番レベル模試｜成績表・順位表" />;
  return <MoshiReportUI name={s.name} />;
}
