'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { STAFF } from '@/lib/staff';

type ProgressItem = { ts: string; campus: string; user: string };

function fmtDateTime(s: string) {
  // GAS からは 'yyyy/MM/dd HH:mm' 等の文字列で来る。日付部分だけ簡潔に表示。
  const m = s.match(/(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (m) return `${Number(m[2])}/${Number(m[3])}`;
  return s;
}

export default function DashboardUI({ name, campus }: { name: string; campus: string }) {
  const [items, setItems] = useState<ProgressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/progress/latest');
        const j = await res.json().catch(() => ({}));
        if (!alive) return;
        if (j?.ok && Array.isArray(j.items)) {
          setItems(j.items as ProgressItem[]);
        } else if (j?.reason === 'not_configured') {
          setNote('中間報告の連携（Apps Script）が未設定です。');
        }
      } catch {
        if (alive) setNote('中間報告状況の取得に失敗しました。');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const allCampuses = useMemo(() => STAFF.map((s) => s.campus), []);

  // 部門ごとの直近1件（items は新しい順）。
  const latestByCampus = useMemo(() => {
    const map = new Map<string, ProgressItem>();
    for (const it of items) {
      if (!map.has(it.campus)) map.set(it.campus, it);
    }
    return map;
  }, [items]);

  const reportedCount = allCampuses.filter((c) => latestByCampus.has(c)).length;
  const recent = items.slice(0, 8);

  return (
    <div className="dash">
      <div className="page-head">
        <h1>ダッシュボード</h1>
        <p>{campus}／{name} さん、おつかれさまです。中間報告の提出状況をまとめます。</p>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-num">{reportedCount}</div>
          <div className="stat-label">報告済み部門</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{allCampuses.length - reportedCount}</div>
          <div className="stat-label">未報告部門</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{allCampuses.length}</div>
          <div className="stat-label">全部門</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-panel">
          <h2>クイックスタート</h2>
          <div className="quick-links">
            <Link href="/chat" className="quick-link">
              <span>
                <b>会議AIで事前報告をつくる</b>
                <small>会議前の報告を対話で整理</small>
              </span>
            </Link>
            <Link href="/progress" className="quick-link">
              <span>
                <b>中間報告を送る</b>
                <small>決議事項の進捗を締切までに報告</small>
              </span>
            </Link>
            <Link href="/report" className="quick-link">
              <span>
                <b>報告をドキュメントへ転記</b>
                <small>会議AIの出力を貼り付けて転記</small>
              </span>
            </Link>
          </div>
        </div>

        <div className="dash-panel">
          <h2>部門別の中間報告状況</h2>
          {note && <p className="dash-empty">{note}</p>}
          <ul className="recent-list">
            {allCampuses.map((c) => {
              const it = latestByCampus.get(c);
              return (
                <li key={c}>
                  <span>{c}</span>
                  {it ? (
                    <span className="recent-date">{it.user}／{fmtDateTime(it.ts)}</span>
                  ) : (
                    <span className="recent-date">{loading ? '…' : '未報告'}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="dash-panel">
          <h2>直近の中間報告</h2>
          {recent.length === 0 ? (
            <p className="dash-empty">
              {loading ? '読み込み中…' : 'まだ中間報告はありません。'}
              {!loading && <> <Link href="/progress">中間報告</Link>から送れます。</>}
            </p>
          ) : (
            <ul className="recent-list">
              {recent.map((it, i) => (
                <li key={i}>
                  <span>{it.campus}／{it.user}</span>
                  <span className="recent-date">{fmtDateTime(it.ts)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
