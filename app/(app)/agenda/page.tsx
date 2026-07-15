import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export default function AgendaPage() {
  if (!getSession()) redirect('/login');
  return (
    <div className="dash">
      <div className="page-head">
        <h1>アジェンダ/テンプレート</h1>
        <p>定例会議の「智翔館の型」をテンプレ化し、事前報告を集約してアジェンダを自動生成します。</p>
      </div>
      <div className="soon-block">
        <div className="soon-badge">次フェーズで実装予定</div>
        <p>この画面では、以下を予定しています：</p>
        <ul>
          <li>事業部ごとの定例会議テンプレート（報告・協議の枠）の登録</li>
          <li>各メンバーの事前報告（会議AIの出力）を1枚のアジェンダに自動集約</li>
          <li>協議事項を時間配分つきで並べた「当日進行表」の生成</li>
        </ul>
        <p className="soon-hint">
          テンプレートの型は、運用しながら智翔館の実際の会議に合わせて育てていきます。
        </p>
      </div>
    </div>
  );
}
