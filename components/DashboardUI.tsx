'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { STAFF } from '@/lib/staff';
import type { ProgressEntry } from '@/lib/progressPrompt';

type ProgressItem = { ts: string; campus: string; user: string; progress: ProgressEntry[] };

// メンバー行に出す進捗の最大件数（超えた分は「他N件」にまとめる）。
const MAX_SHOWN_ITEMS = 3;

function fmtDateTime(s: string) {
  // GAS からは 'yyyy/MM/dd HH:mm' 等の文字列で来る。日付部分だけ簡潔に表示。
  const m = s.match(/(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (m) return `${Number(m[2])}/${Number(m[3])}`;
  return s;
}

export default function DashboardUI({
  name,
  campus,
  isAdmin = false,
}: {
  name: string;
  campus: string;
  isAdmin?: boolean;
}) {
  const [items, setItems] = useState<ProgressItem[]>([]);
  const [deptItems, setDeptItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 提出状況と、この部門の報告項目（管理部門は項目パネルを出さないので取得しない）を並行取得。
        const [statusRes, itemsRes] = await Promise.all([
          fetch('/api/progress/latest'),
          isAdmin ? Promise.resolve(null) : fetch('/api/progress/items'),
        ]);
        const j = await statusRes.json().catch(() => ({}));
        if (!alive) return;
        if (j?.ok && Array.isArray(j.items)) {
          setItems(j.items as ProgressItem[]);
        } else if (j?.reason === 'not_configured') {
          setNote('中間報告の連携（Apps Script）が未設定です。');
        }
        if (itemsRes) {
          const j2 = await itemsRes.json().catch(() => ({}));
          if (!alive) return;
          if (j2?.ok && j2.items && Array.isArray(j2.items[campus])) {
            setDeptItems((j2.items[campus] as unknown[]).map((s) => String(s)));
          }
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
  }, [isAdmin, campus]);

  const allCampuses = useMemo(() => STAFF.map((s) => s.campus), []);
  const members = useMemo(() => STAFF.find((s) => s.campus === campus)?.names ?? [], [campus]);

  // 部門ごとの直近1件（items は新しい順なので先勝ち）。
  const latestByCampus = useMemo(() => {
    const map = new Map<string, ProgressItem>();
    for (const it of items) if (!map.has(it.campus)) map.set(it.campus, it);
    return map;
  }, [items]);

  // 自部門メンバーごとの直近1件。
  const latestByMember = useMemo(() => {
    const map = new Map<string, ProgressItem>();
    for (const it of items) {
      if (it.campus !== campus) continue;
      if (!map.has(it.user)) map.set(it.user, it);
    }
    return map;
  }, [items, campus]);

  const quickStart = (
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
  );

  // ── 管理部門（総務・人事・支援・管理）：全部門の提出状況を俯瞰する ──
  if (isAdmin) {
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
          {quickStart}

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

  // ── 各事業部：自部門メンバーの提出状況と報告内容を見る ──
  const reportedMembers = members.filter((m) => latestByMember.has(m)).length;

  return (
    <div className="dash">
      <div className="page-head">
        <h1>ダッシュボード</h1>
        <p>{campus}／{name} さん、おつかれさまです。{campus}メンバーの中間報告の状況をまとめます。</p>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-num">{reportedMembers}</div>
          <div className="stat-label">報告済みメンバー</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{members.length - reportedMembers}</div>
          <div className="stat-label">未報告メンバー</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{members.length}</div>
          <div className="stat-label">全メンバー</div>
        </div>
      </div>

      <div className="dash-grid">
        {quickStart}

        <div className="dash-panel wide">
          <h2>報告すべき項目・期日</h2>
          {deptItems.length === 0 ? (
            <p className="dash-empty">
              {loading ? '読み込み中…' : '報告項目が設定されていません。'}
            </p>
          ) : (
            <>
              <ol className="dept-items">
                {deptItems.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <p className="dept-items-note">
                この項目を「中間報告」で順に確認します。項目・期日の変更は総務・人事・支援・管理が行います。
              </p>
            </>
          )}
        </div>

        <div className="dash-panel full">
          <h2>部門メンバーの中間報告状況</h2>
          {note && <p className="dash-empty">{note}</p>}
          <ul className="member-list">
            {members.map((m) => {
              const it = latestByMember.get(m);
              const shown = it ? it.progress.slice(0, MAX_SHOWN_ITEMS) : [];
              const rest = it ? it.progress.length - shown.length : 0;
              return (
                <li key={m}>
                  <div className="member-head">
                    <span className="member-name">{m}</span>
                    <span className="recent-date">
                      {it ? fmtDateTime(it.ts) : loading ? '…' : '未報告'}
                    </span>
                  </div>
                  {it && shown.length > 0 && (
                    <ul className="member-progress">
                      {shown.map((p, i) => (
                        <li key={i}>
                          <span className="progress-name">{p.name}</span>
                          <span className={`progress-status ${p.status === '完了' ? 'done' : ''}`}>
                            {p.status || '—'}
                          </span>
                        </li>
                      ))}
                      {rest > 0 && <li className="progress-more">他{rest}件</li>}
                    </ul>
                  )}
                  {it && shown.length === 0 && (
                    <div className="member-progress-empty">報告内容の記録がありません。</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
