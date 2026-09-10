import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

// 全体会議振り返り（メニューだけ先に用意。中身はこれから作る）
export default function MeetingReviewPage() {
  if (!getSession()) redirect('/login');
  return (
    <div className="dash">
      <div className="page-head">
        <h1>全体会議振り返り</h1>
        <p>全体会議の振り返りをまとめます。</p>
      </div>
      <div className="soon-block">
        <div className="soon-badge">準備中</div>
        <p>この画面の中身はこれから作成します。</p>
      </div>
    </div>
  );
}
