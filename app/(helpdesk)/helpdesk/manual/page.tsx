import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import { MANUALS } from '@/lib/manuals';

// 操作マニュアル（PDF）と動画マニュアルのダウンロード。並べる資料は lib/manuals.ts。
export default function HelpdeskManualPage() {
  const s = getSession();
  if (!s) redirect('/login?next=/helpdesk/manual');

  return (
    <div className="manuals">
      <div className="page-head">
        <h1>マニュアル</h1>
        <p>アプリの使い方の資料です。PDFは［ダウンロード］で保存できます。動画はこの画面で再生できます。</p>
      </div>

      <ul className="manual-list">
        {MANUALS.map((m) => (
          <li key={m.id} className="manual-item">
            <div className="manual-head">
              <span className={`manual-kind ${m.kind}`}>{m.kind === 'pdf' ? 'PDF' : '動画'}</span>
              <span className="manual-title">{m.title}</span>
            </div>
            <p className="manual-desc">{m.desc}</p>
            {m.kind === 'video' && (
              <video className="manual-video" controls preload="metadata" playsInline poster={m.poster}>
                <source src={m.href} type="video/mp4" />
              </video>
            )}
            <div className="manual-foot">
              <span className="manual-meta">{m.meta}</span>
              <div className="manual-actions">
                {m.kind === 'pdf' && (
                  <a className="manual-open" href={m.href} target="_blank" rel="noopener noreferrer">開く</a>
                )}
                <a className="manual-download" href={m.href} download={m.downloadName}>ダウンロード</a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
