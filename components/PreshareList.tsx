'use client';

// 部門会議の事前共有のカード一覧。ダッシュボードと「部門会議議事録」画面の両方で使う。
// ★並べる順・出す範囲は lib/deptMinutesPreshare.ts の upcomingPreshares() で決める。

import { shortDate, whenLabel, type PreshareRow, type PreshareView } from '@/lib/deptMinutesPreshare';
import { summarizeSection } from '@/lib/deptMinutesParse';

export default function PreshareList({
  views,
  grid = false,
  agendaLines = 3,
  onOpen,
}: {
  views: PreshareView[];
  grid?: boolean; // ダッシュボードでは横に並べる
  agendaLines?: number;
  onOpen: (row: PreshareRow, when: string) => void;
}) {
  return (
    <ul className={`pre-list ${grid ? 'grid' : ''}`}>
      {views.map((v) => {
        const { row } = v;
        const when = whenLabel(v);
        const agenda = summarizeSection(row.agenda, agendaLines);
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
              <button className="dm-detail" onClick={() => onOpen(row, when)}>議題を見る</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
