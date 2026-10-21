import { redirect } from 'next/navigation';
import MonpaiStaffLogin from '@/components/MonpaiStaffLogin';
import { groupStaff } from '@/lib/monpai/model';
import { listStaff } from '@/lib/monpai/store';
import { currentStaff } from '@/lib/monpai/staffSession';

// 名簿はサーバで読んで画面に渡す（名簿を返す公開の API は作らない）。
export default async function MonpaiStaffLoginPage() {
  if (await currentStaff()) redirect('/monpai-staff');
  const r = await listStaff();
  const groups = r.ok ? groupStaff(r.items.filter((s) => s.active)) : [];
  return <MonpaiStaffLogin groups={groups} unavailable={!r.ok} />;
}
