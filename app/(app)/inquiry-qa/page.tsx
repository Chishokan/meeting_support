import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import InquiryQaUI from '@/components/InquiryQaUI';

// 問合せ管理は生徒・保護者の個人情報を含むため、閲覧できる部門を限定する。
const ALLOWED_DEPTS = ['小中等部', '総務・人事・支援・管理'];

export default function InquiryQaPage() {
  const session = getSession();
  if (!session) redirect('/login');

  if (!ALLOWED_DEPTS.includes(session.campus)) {
    return (
      <div className="dash">
        <div className="page-head">
          <h1>問い合わせQA</h1>
          <p>小中等部の問合せ管理について答えるAIです。</p>
        </div>
        <div className="soon-block">
          <div className="soon-badge">閲覧できません</div>
          <p>この機能は小中等部と管理部門のみ利用できます。</p>
          <p className="soon-hint">生徒・保護者の情報を含むため、部門を限定しています。</p>
        </div>
      </div>
    );
  }

  return <InquiryQaUI name={session.name} campus={session.campus} />;
}
