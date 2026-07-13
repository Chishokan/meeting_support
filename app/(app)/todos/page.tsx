import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export default function TodosPage() {
  if (!getSession()) redirect('/login');
  return (
    <div className="dash">
      <div className="page-head">
        <h1>✅ ToDo・宿題</h1>
        <p>会議で決まったアクション項目を、担当・期限・進捗で追跡します。</p>
      </div>
      <div className="soon-block">
        <div className="soon-badge">次フェーズで実装予定</div>
        <p>この画面では、以下を予定しています：</p>
        <ul>
          <li>議事録スレッドの ToDo（<code>- [ ]</code>）を自動収集して一覧化</li>
          <li>担当者・期限でのフィルタ／並べ替え</li>
          <li>チェックで進捗更新、次回会議冒頭の「前回ToDo確認」ビュー</li>
        </ul>
        <p className="soon-hint">
          まずは <a href="/minutes">議事録スレッド</a> で ToDo を書き溜めてください。ここに集約されます。
        </p>
      </div>
    </div>
  );
}
