import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import InquiryUI from '@/components/InquiryUI';

// ご意見・不具合の報告（旧 /inquiry）。送り先・データ（/api/inquiry）は会議DXにあったときと同じ。
export default function HelpdeskFeedbackPage() {
  const s = getSession();
  if (!s) redirect('/login?next=/helpdesk/feedback');
  return <InquiryUI name={s.name} campus={s.campus} />;
}
