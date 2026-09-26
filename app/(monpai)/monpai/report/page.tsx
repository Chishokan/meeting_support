import MonpaiReportUI from '@/components/MonpaiReportUI';
import { getSession } from '@/lib/core/auth';

export default function MonpaiReportPage() {
  return <MonpaiReportUI me={getSession()?.name ?? ''} />;
}
