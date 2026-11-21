'use client';

// 部門会議の事前共有のカード一覧。ダッシュボードと「部門会議議事録」画面の両方で使う。
// ★並べる順・出す範囲は lib/deptMinutesPreshare.ts の upcomingPreshares() で決める。

import { confirmSummary } from '@/lib/attendees';
import { agendaPreview, shortDate, whenLabel, type PreshareRow, type PreshareView } from '@/lib/deptMinutesPreshare';
import ZoomButtons from '@/components/ZoomButtons';

// 出席者のうち何人が「確認しました」を付けたか（カードの「確認 2/5」）。
function seenOf(row: PreshareRow) {
  return confirmSummary(row.attendees, row.confirmed);
}

export default function PreshareList({
  views,
  grid = false,
  agendaLines = 3,
  onOpen,
  onStart,
}: {
  views: PreshareView[];
  grid?: boolean; // ダッシュボードでは横に並べる
  agendaLines?: number;
  onOpen: (row: PreshareRow, when: string) => void;
  // 渡されたときだけ、カードに［議事録をつくる］を出す（ダッシュボードから議事録の画面へ直接移る）。
  onStart?: (row: PreshareRow) => void;
}) {
  return (
    <ul className={`pre-list ${grid ? 'grid' : ''}`}>
      {views.map((v) => {
        const { row } = v;
        const when = whenLabel(v);
        const agenda = agendaPreview(row.agenda, agendaLines);
        const past = v.offset < 0;
        return (
          <li key={row.id || `${row.ts}-${row.title}`} className={`pre-item ${when === '今日' ? 'today' : ''} ${past ? 'past' : ''}`}>
            <div className="dm-meet-head">
              {when && <span className={`pre-when ${when === '今日' ? 'today' : ''}`}>{when}</span>}
              <span className="dm-meet-date">{shortDate(row.date) || '日時未定'}</span>
              <span className="dm-dec-campus">{row.campus}</span>
            </div>
            <div className="dm-meet-title">{row.title || '（会議名なし）'}</div>
            {row.place && <div className="pre-place">{row.place}</div>}
            {agenda.length > 0 && (
              <ul className="dm-meet-agenda">
                {agenda.map((a, k) => <li key={k}>{a}</li>)}
              </ul>
            )}
            <div className="dm-meet-foot">
              <span className="dm-meet-count">
                {past ? '議事録はまだありません' : row.user && `共有：${row.user}`}
              </span>
              {/* Zoom の録画から下書きができている会議（［議事録をつくる］で読み込める） */}
              {row.minutesJob === 'done' && <span className="pre-draft">録画から下書きあり</span>}
              {/* 出席者のうち、事前に議題を確認した人数 */}
              {!past && seenOf(row).total > 0 && (
                <span className={`pre-seen${seenOf(row).done === seenOf(row).total ? ' all' : ''}`}>
                  確認 {seenOf(row).done}/{seenOf(row).total}
                </span>
              )}
              <div className="pre-actions">
                <button className="dm-detail" onClick={() => onOpen(row, when)}>議題を見る</button>
                {/* Zoom ミーティングを作った会議だけ、［Zoomに参加］か［ホストとして開始］が出る */}
                <ZoomButtons row={row} />
                {onStart && (
                  <button className="pre-start" onClick={() => onStart(row)}>議事録をつくる</button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
