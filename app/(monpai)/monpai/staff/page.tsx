import MonpaiStaffAdminUI from '@/components/MonpaiStaffAdminUI';
import { getSession } from '@/lib/core/auth';
import { canEditMaster } from '@/lib/monpai/model';

export default function MonpaiStaffAdminPage() {
  return <MonpaiStaffAdminUI canEdit={canEditMaster(getSession()?.campus ?? '')} />;
}
