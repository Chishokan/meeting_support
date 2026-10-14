import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import InquiryQaUI from '@/components/InquiryQaUI';

// 問合せ管理の「AIに聞く」（旧・会議DXの問い合わせQA）。台帳と同じデータを使う。
// 開ける部門は問合せ管理のレイアウト（canUseInquiryBoard）で絞っている。
export default function InquiryBoardQaPage() {
  const s = getSession();
  if (!s) redirect('/login?next=/inquiry-board/qa');
  return <InquiryQaUI name={s.name} campus={s.campus} />;
}
