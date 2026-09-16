'use client';

// 議事録1件の詳細（ポップアップ）。
// 「部門会議議事録」画面とダッシュボードの両方から、カードの［詳細］で開く。
// ★見た目・項目を変えるときはここだけを直せば両方に反映される。

import { useEffect } from 'react';
import type { MinutesRow } from '@/app/api/dept-minutes/list/route';

// 「2026/9/14 18:00〜19:30」から日付だけを取り出す。読めなければそのまま出す。
function fmtDate(s: string) {
  const m = s.match(/(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}` : s;
}

export default function MinutesDetail({
  row,
  onClose,
}: {
  row: MinutesRow;
  onClose: () => void;
}) {
  // 開いているあいだは Esc で閉じられるようにする。
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
        aria-label="議事録の詳細"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dm-modal-head">
          <div>
            <div className="dm-modal-sub">
              {fmtDate(row.date || row.ts)}　{row.campus}
              {row.user && `　記録：${row.user}`}
            </div>
            <h2>{row.title || '（会議名なし）'}</h2>
            {row.attendees && <div className="dm-modal-sub">出席者：{row.attendees}</div>}
          </div>
          <button className="dm-modal-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>

        <div className="dm-modal-body">
          <pre className="dm-modal-text">{row.minutes || '（本文がありません）'}</pre>
          {row.quality && (
            <div className="dm-modal-quality">
              <h3>会議の質チェック</h3>
              <pre className="dm-modal-text">{row.quality}</pre>
            </div>
          )}
        </div>

        <div className="dm-modal-foot">
          <button
            className="dm-copy"
            onClick={() =>
              navigator.clipboard?.writeText(
                row.quality
                  ? `${row.minutes}\n\n【会議の質チェック】\n${row.quality}`
                  : row.minutes,
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
