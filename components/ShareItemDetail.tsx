'use client';

// 事前共有事項1件の詳細（ポップアップ）。
// ダッシュボードのカードの［詳細］で開く。カードには件名しか出さないので、
// 経緯・論点・報告者の意見はここで全文を読む。
// ★議事録の詳細（MinutesDetail）と同じ見た目の枠（dm-modal-*）を使っている。

import { useEffect } from 'react';
import type { ShareRow } from '@/app/api/share-items/route';

function kindClass(kind: string): string {
  if (kind === '協議') return 'k-giron';
  if (kind === '決裁') return 'k-kessai';
  return 'k-hokoku';
}

// 「2026/09/16 10:12」から日付だけを取り出す。読めなければそのまま出す。
function fmtDate(s: string): string {
  const m = s.match(/(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}` : s;
}

export default function ShareItemDetail({
  row,
  onClose,
}: {
  row: ShareRow;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sections: { label: string; text: string }[] = [
    { label: '経緯', text: row.background },
    { label: '論点', text: row.point },
    { label: '報告者の意見', text: row.opinion },
  ].filter((s) => s.text);

  return (
    <div className="dm-modal-bg" onClick={onClose}>
      <div
        className="dm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="事前共有事項の詳細"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dm-modal-head">
          <div>
            <div className="dm-modal-sub">
              <span className={`share-kind ${kindClass(row.kind)}`}>{row.kind || '報告'}</span>
              　{row.campus}／{row.user}　{fmtDate(row.ts)}
            </div>
            <h2>{row.title || '（件名なし）'}</h2>
          </div>
          <button className="dm-modal-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>

        <div className="dm-modal-body">
          {sections.length === 0 ? (
            <p className="dash-empty">
              この項目は件名のみの共有です（報告事項は1〜3行で書かれるため、
              内訳が無いことがあります）。
            </p>
          ) : (
            sections.map((s) => (
              <div key={s.label} className="share-detail-sec">
                <h3>{s.label}</h3>
                <pre className="dm-modal-text">{s.text}</pre>
              </div>
            ))
          )}
        </div>

        <div className="dm-modal-foot">
          <button
            className="dm-copy"
            onClick={() =>
              navigator.clipboard?.writeText(
                [
                  `【${row.kind || '報告'}】${row.title}`,
                  `${row.campus}／${row.user}`,
                  ...sections.map((s) => `■ ${s.label}\n${s.text}`),
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
