import MonpaiSchoolsUI from '@/components/MonpaiSchoolsUI';
import { getSession } from '@/lib/core/auth';
import { canEditMaster } from '@/lib/monpai/model';

export default function MonpaiSchoolsPage() {
  return <MonpaiSchoolsUI canEdit={canEditMaster(getSession()?.campus ?? '')} />;
}
