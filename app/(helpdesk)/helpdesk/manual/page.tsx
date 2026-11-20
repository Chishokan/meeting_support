import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import ManualBrowser from '@/components/ManualBrowser';

// 操作マニュアル（PDF）と動画マニュアルのダウンロード。並べる資料は lib/manuals.ts、目次・検索は components/ManualBrowser.tsx。
export default function HelpdeskManualPage() {
  const s = getSession();
  if (!s) redirect('/login?next=/helpdesk/manual');

  return (
    <div className="manuals">
      <div className="page-head">
        <h1>マニュアル</h1>
        <p>アプリの使い方の資料です。PDFは［ダウンロード］で保存できます。動画はこの画面で再生できます。目次か検索で探してください。</p>
      </div>

      <ManualBrowser />
    </div>
  );
}
