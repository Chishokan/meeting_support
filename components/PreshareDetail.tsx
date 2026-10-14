'use client';

// 部門会議の事前共有1件の詳細（ポップアップ）。
// ダッシュボードと「部門会議議事録」画面の両方から、カードの［詳細］で開く。
// 会議中に議題・レジュメを見ながら進めるためのものなので、本文は大きめの文字で全文を出す。
// ★議事録の詳細（MinutesDetail）と同じ見た目の枠（dm-modal-*）を使っている。

import type { PreshareRow } from '@/lib/deptMinutesPreshare';
import { useModalDismiss } from '@/lib/useModalDismiss';

// 更新日時は時刻まで見せる（会議の直前に直すことがあるため）。
function fmtStamp(s: string) {
  const d = s.match(/(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})/);
  const t = s.match(/(\d{1,2}):(\d{2})/);
  if (!d) return s;
  return `${Number(d[2])}/${Number(d[3])}${t ? ` ${t[1].padStart(2, '0')}:${t[2]}` : ''}`;
}

export default function PreshareDetail({
  row,
  when,
  onClose,
  onStart,
}: {
  row: PreshareRow;
  when?: string; // 「今日」「明日」など（無ければ出さない）
  onClose: () => void;
  // 渡されたときだけ［この会議の議事録をつくる］を出す。押すと議事録の画面に会議情報を読み込む。
  onStart?: () => void;
}) {
  // Esc で閉じる／開いているあいだ後ろのページを動かさない
  useModalDismiss(onClose);

  const info = [
    { label: '開催日時', text: row.date },
    { label: '場所', text: row.place },
    { label: '出席者', text: row.attendees },
  ].filter((s) => s.text);

  return (
    <div className="dm-modal-bg" onClick={onClose}>
      <div
        className="dm-modal pre-modal"
        role="dialog"
        aria-modal="true"
        aria-label="部門会議の事前共有"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dm-modal-head">
          <div>
            <div className="dm-modal-sub">
              {when && <span className={`pre-when ${when === '今日' ? 'today' : ''}`}>{when}</span>}
              {when && '　'}
              {row.campus}
              {row.user && `　共有：${row.user}`}
            </div>
            <h2>{row.title || '（会議名なし）'}</h2>
            {info.map((s) => (
              <div key={s.label} className="dm-modal-sub">{s.label}：{s.text}</div>
            ))}
            {row.editedBy && (
              <div className="dm-modal-edited">
                更新：{fmtStamp(row.editedAt)}　{row.editedBy}
              </div>
            )}
          </div>
          <button className="dm-modal-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>

        <div className="dm-modal-body">
          <div className="share-detail-sec">
            <h3>予定している議題・レジュメ</h3>
            <pre className="dm-modal-text pre-agenda">{row.agenda || '（議題が登録されていません）'}</pre>
          </div>
        </div>

        <div className="dm-modal-foot">
          {onStart && (
            <button className="dm-modal-edit" onClick={onStart}>この会議の議事録をつくる</button>
          )}
          <button
            className="dm-copy"
            onClick={() =>
              navigator.clipboard?.writeText(
                [
                  row.title,
                  ...info.map((s) => `${s.label}：${s.text}`),
                  '',
                  row.agenda,
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
