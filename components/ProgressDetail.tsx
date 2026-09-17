'use client';

// 中間報告1件の詳細（ポップアップ）。
// ダッシュボードのカードの［詳細］で開く。カードには項目名と進捗しか出さないので、
// 完了予定日・原因・その他の共有事項はここで読む。
// ★事前共有事項（ShareItemDetail）・議事録（MinutesDetail）と同じ見た目の枠（dm-modal-*）を使う。

import { useEffect } from 'react';
import type { ProgressEntry } from '@/lib/progressPrompt';

export type ProgressRow = {
  ts: string;
  campus: string;
  user: string;
  progress: ProgressEntry[];
  note?: string;
};

// 「2026/09/16 18:20」から日付だけを取り出す。読めなければそのまま出す。
function fmtDate(s: string): string {
  const m = s.match(/(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}` : s;
}

export default function ProgressDetail({
  row,
  onClose,
}: {
  row: ProgressRow;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dm-modal-bg" onClick={onClose}>
      <div
        className="dm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="中間報告の詳細"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dm-modal-head">
          <div>
            <div className="dm-modal-sub">
              {row.user}　{fmtDate(row.ts)}
            </div>
            <h2>{row.campus}　中間報告</h2>
          </div>
          <button className="dm-modal-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>

        <div className="dm-modal-body">
          {row.progress.length === 0 ? (
            <p className="dash-empty">報告内容の記録がありません。</p>
          ) : (
            <ol className="prog-detail-list">
              {row.progress.map((p, i) => (
                <li key={i}>
                  <div className="prog-detail-head">
                    <span className="prog-detail-name">{p.name}</span>
                    <span className={`progress-status ${p.status === '完了' ? 'done' : ''}`}>
                      {p.status || '—'}
                    </span>
                  </div>
                  {/* 完了予定日・原因は未完のときだけ書かれる。無い項目には行を出さない。 */}
                  {p.due && <div className="prog-detail-line"><b>完了予定日</b>{p.due}</div>}
                  {p.cause && <div className="prog-detail-line"><b>原因</b>{p.cause}</div>}
                </li>
              ))}
            </ol>
          )}

          {row.note && (
            <div className="share-detail-sec">
              <h3>その他・共有事項</h3>
              <pre className="dm-modal-text">{row.note}</pre>
            </div>
          )}
        </div>

        <div className="dm-modal-foot">
          <button
            className="dm-copy"
            onClick={() =>
              navigator.clipboard?.writeText(
                [
                  `【中間報告】${row.campus} ／ 報告者：${row.user}`,
                  '■ 進捗',
                  ...row.progress.map(
                    (p, i) =>
                      `${i + 1}. ${p.name}\n   ・進捗：${p.status || '—'}` +
                      (p.due ? `\n   ・完了予定日：${p.due}` : '') +
                      (p.cause ? `\n   ・原因：${p.cause}` : ''),
                  ),
                  ...(row.note ? ['', '■ その他・共有事項', row.note] : []),
                ].join('\n'),
              )
            }
          >
            コピー
          </button>
          <button className="dm-modal-done" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
