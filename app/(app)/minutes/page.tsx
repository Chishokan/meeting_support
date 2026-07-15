import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export default function MinutesPage() {
  if (!getSession()) redirect('/login');
  return (
    <div className="dash">
      <div className="page-head">
        <h1>議事録スレッド</h1>
        <p>会議中・直後のメモをAIが議事録に整形します。</p>
      </div>
      <div className="soon-block">
        <div className="soon-badge">準備中</div>
        <p>この機能は現在準備中です。</p>
        <p className="soon-hint">
          会議前の報告づくりは <a href="/chat">会議AI</a>、ドキュメントへの転記は <a href="/report">報告</a> をご利用ください。
        </p>
      </div>
    </div>
  );
}
