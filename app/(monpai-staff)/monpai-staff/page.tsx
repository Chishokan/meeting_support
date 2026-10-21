import { redirect } from 'next/navigation';
import MonpaiStaffUI from '@/components/MonpaiStaffUI';
import { currentStaff } from '@/lib/monpai/staffSession';

export default async function MonpaiStaffPage() {
  const me = await currentStaff();
  if (!me) redirect('/monpai-staff/login');
  return <MonpaiStaffUI name={me.name} affiliation={me.affiliation} />;
}
