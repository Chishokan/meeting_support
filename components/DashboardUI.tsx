'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { STAFF } from '@/lib/staff';
import YokoCard, { type YokoCardData } from '@/components/YokoCard';
import MinutesDetail from '@/components/MinutesDetail';
import { extractDecisions, extractSection, summarizeSection } from '@/lib/deptMinutesParse';
import type { ProgressEntry } from '@/lib/progressPrompt';
import type { SuccessRow } from '@/app/api/success/route';
import type { MinutesRow } from '@/app/api/dept-minutes/list/route';
import type { ShareRow } from '@/app/api/share-items/route';

type ProgressItem = { ts: string; campus: string; user: string; progress: ProgressEntry[] };

// ★中間報告まわりの表示を一時的に止めている。
//   再開するときはここを true に戻すだけでよい（提出状況の数値・部門別の状況・
//   報告すべき項目・部門メンバーの報告状況・直近の中間報告がまとめて戻る）。
//   false の間は中間報告の API も呼ばない。
const SHOW_PROGRESS = false;

// メンバー行に出す進捗の最大件数（超えた分は「他N件」にまとめる）。
const MAX_SHOWN_ITEMS = 3;
// 成功事例パネルに出す件数（新しい順）。
const MAX_SHOWN_CASES = 6;
// ダッシュボードに出す直近の議事録・要項カードの件数。
const MAX_SHOWN_MINUTES = 5;
const MAX_SHOWN_YOKO = 4;
// 事前共有事項のカード件数。協議・決裁は会議で扱うので、報告より前に出す。
const MAX_SHOWN_SHARE = 6;
const SHARE_ORDER: Record<string, number> = { 協議: 0, 決裁: 1, 報告: 2 };

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
  const [cases, setCases] = useState<SuccessRow[]>([]);
  const [minutes, setMinutes] = useState<MinutesRow[]>([]);
  const [shareItems, setShareItems] = useState<ShareRow[]>([]);
  // ［詳細］で開く議事録。画面を移らずにこのページ上で開く。
  const [openMinutes, setOpenMinutes] = useState<MinutesRow | null>(null);
  const [yoko, setYoko] = useState<YokoCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 中間報告は非表示のあいだ取得しない（GAS への無駄な往復を減らす）。
        const [statusRes, itemsRes, successRes, minutesRes, yokoRes, shareRes] = await Promise.all([
          SHOW_PROGRESS ? fetch('/api/progress/latest') : Promise.resolve(null),
          SHOW_PROGRESS && !isAdmin ? fetch('/api/progress/items') : Promise.resolve(null),
          fetch('/api/success').catch(() => null),
          fetch('/api/dept-minutes/list?scope=minutes').catch(() => null),
          fetch('/api/yoko-qa').catch(() => null),
          fetch('/api/share-items').catch(() => null),
        ]);
        if (statusRes) {
          const j = await statusRes.json().catch(() => ({}));
          if (!alive) return;
          if (j?.ok && Array.isArray(j.items)) {
            setItems(j.items as ProgressItem[]);
          } else if (j?.reason === 'not_configured') {
            setNote('中間報告の連携（Apps Script）が未設定です。');
          }
        }
        if (itemsRes) {
          const j2 = await itemsRes.json().catch(() => ({}));
          if (!alive) return;
          if (j2?.ok && j2.items && Array.isArray(j2.items[campus])) {
            setDeptItems((j2.items[campus] as unknown[]).map((s) => String(s)));
          }
        }
        // 以下は取得できなくても他の表示は止めない（未設定・未集計なら空のまま）。
        const j3 = successRes ? await successRes.json().catch(() => ({})) : {};
        if (!alive) return;
        if (j3?.ok && Array.isArray(j3.items)) setCases(j3.items as SuccessRow[]);

        const j4 = minutesRes ? await minutesRes.json().catch(() => ({})) : {};
        if (!alive) return;
        if (j4?.ok && Array.isArray(j4.items)) setMinutes(j4.items as MinutesRow[]);

        const j5 = yokoRes ? await yokoRes.json().catch(() => ({})) : {};
        if (!alive) return;
        if (j5?.ok && Array.isArray(j5.cards)) setYoko(j5.cards as YokoCardData[]);

        const j6 = shareRes ? await shareRes.json().catch(() => ({})) : {};
        if (!alive) return;
        if (j6?.ok && Array.isArray(j6.items)) setShareItems(j6.items as ShareRow[]);
      } catch {
        if (alive) setNote('情報の取得に失敗しました。');
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
        <Link href="/dept-minutes" className="quick-link">
          <span>
            <b>部門会議の議事録をつくる</b>
            <small>録音から議事録・決定事項を共有</small>
          </span>
        </Link>
        <Link href="/chat" className="quick-link">
          <span>
            <b>会議AIで事前報告をつくる</b>
            <small>会議前の報告を対話で整理</small>
          </span>
        </Link>
        {SHOW_PROGRESS && (
          <Link href="/progress" className="quick-link">
            <span>
              <b>中間報告を送る</b>
              <small>決議事項の進捗を締切までに報告</small>
            </span>
          </Link>
        )}
        <Link href="/report" className="quick-link">
          <span>
            <b>報告をドキュメントへ転記</b>
            <small>会議AIの出力を貼り付けて転記</small>
          </span>
        </Link>
      </div>
    </div>
  );

  // 直近の議事録（全部門）。カードの見た目は「部門会議議事録」画面と同じものを使う。
  const minutesPanel = (
    <div className="dash-panel">
      <h2>
        直近の議事録
        <Link href="/dept-minutes" className="panel-more">すべて見る</Link>
      </h2>
      {minutes.length === 0 ? (
        <p className="dash-empty">
          {loading ? '読み込み中…' : 'まだ保存された議事録はありません。'}
          {!loading && <> <Link href="/dept-minutes">部門会議議事録</Link>から作れます。</>}
        </p>
      ) : (
        <ul className="dm-meet-list">
          {minutes.slice(0, MAX_SHOWN_MINUTES).map((m, i) => {
            const agenda = summarizeSection(extractSection(m.minutes, '議題') || m.agenda, 2);
            const decCount = extractDecisions(m.minutes).length;
            return (
              <li key={`${m.ts}-${i}`}>
                <div className="dm-meet-head">
                  <span className="dm-meet-date">{fmtDateTime(m.date || m.ts)}</span>
                  <span className="dm-dec-campus">{m.campus}</span>
                </div>
                <div className="dm-meet-title">{m.title || '（会議名なし）'}</div>
                {agenda.length > 0 && (
                  <ul className="dm-meet-agenda">
                    {agenda.map((a, k) => <li key={k}>{a}</li>)}
                  </ul>
                )}
                <div className="dm-meet-foot">
                  <span className="dm-meet-count">
                    決定 {decCount} 件{m.user && ` ／ ${m.user}`}
                  </span>
                  <button className="dm-detail" onClick={() => setOpenMinutes(m)}>詳細</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  // 直近の事前共有事項。会議AIで作り「報告」で転記した「協議・決裁・報告」を全部門分まとめる。
  // 会議の前にここを見れば、当日どこで議論になるかが分かる状態にするのが狙い。
  const sharePanel = (
    <div className="dash-panel">
      <h2>
        直近の事前共有事項
        <Link href="/chat" className="panel-more">会議AIでつくる</Link>
      </h2>
      {shareItems.length === 0 ? (
        <p className="dash-empty">
          {loading
            ? '読み込み中…'
            : 'まだ事前共有事項はありません。会議AIで事前報告をまとめ、'}
          {!loading && <><Link href="/report">報告</Link>から転記すると、ここに集まります。</>}
        </p>
      ) : (
        <ul className="share-list">
          {[...shareItems]
            .sort((a, b) => (SHARE_ORDER[a.kind] ?? 9) - (SHARE_ORDER[b.kind] ?? 9))
            .slice(0, MAX_SHOWN_SHARE)
            .map((s, i) => (
              <li key={`${s.ts}-${i}`} className={`share-item ${s.kind === '協議' ? 'k-giron' : s.kind === '決裁' ? 'k-kessai' : 'k-hokoku'}`}>
                <div className="share-top">
                  <span className="share-kind">{s.kind || '報告'}</span>
                  <span className="share-meta">{s.campus}／{s.user}　{fmtDateTime(s.ts)}</span>
                </div>
                <div className="share-title">{s.title}</div>
                {s.point && <p className="share-line"><b>論点</b>{s.point}</p>}
                {s.opinion && <p className="share-line"><b>意見</b>{s.opinion}</p>}
              </li>
            ))}
        </ul>
      )}
    </div>
  );

  // 実施中・開始間近の要項。保護者対応でその場で見るものなので、全部門に同じものを出す。
  const yokoPanel = (
    <div className="dash-panel full">
      <h2>
        実施期間中の要項
        <Link href="/yoko-qa" className="panel-more">要項QAで聞く</Link>
      </h2>
      {yoko.length === 0 ? (
        <p className="dash-empty">
          {loading ? '読み込み中…' : '実施中・開始間近の要項はありません。'}
          {!loading && <> <Link href="/yoko-qa">要項QA</Link>で確定済みの一覧を見られます。</>}
        </p>
      ) : (
        <div className="iqa-cards">
          {yoko.slice(0, MAX_SHOWN_YOKO).map((c) => (
            <YokoCard key={c.file} card={c} compact />
          ))}
        </div>
      )}
    </div>
  );

  const successPanel = (
    <div className="dash-panel full">
      <h2>この夏の成功事例（全部門）</h2>
      {cases.length === 0 ? (
        <p className="dash-empty">
          {loading
            ? '読み込み中…'
            : 'まだ成功事例はありません。会議AIの「夏の結果報告」でまとめ、'}
          {!loading && <><Link href="/report">報告</Link>から転記すると、ここに集まります。</>}
        </p>
      ) : (
        <ul className="case-list">
          {cases.slice(0, MAX_SHOWN_CASES).map((c, i) => (
            <li key={i} className="case-item">
              <div className="case-head">
                <span className="case-title">{c.title || '（件名なし）'}</span>
                <span className="recent-date">{c.campus}／{c.user}　{fmtDateTime(c.ts)}</span>
              </div>
              {c.action && <p className="case-line"><b>取り組み</b>{c.action}</p>}
              {c.result && <p className="case-line"><b>結果</b>{c.result}</p>}
              {c.point && <p className="case-line"><b>ポイント</b>{c.point}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  // ── 中間報告を止めているあいだのダッシュボード ──
  // 直近の議事録と、いま使う要項を出す。SHOW_PROGRESS を true に戻すと、
  // ここを素通りして下の従来のダッシュボード（提出状況）に戻る。
  if (!SHOW_PROGRESS) {
    return (
      <div className="dash">
        <div className="page-head">
          <h1>ダッシュボード</h1>
          <p>
            {campus}／{name} さん、おつかれさまです。
            直近の議事録・会議前に共有された協議事項・実施期間中の要項をまとめます。
          </p>
        </div>

        {note && <p className="dash-note">{note}</p>}

        <div className="dash-grid">
          {quickStart}
          {minutesPanel}
          {sharePanel}
          {yokoPanel}
          {successPanel}
        </div>

        {/* 議事録の詳細（ポップアップ）。議事録画面と同じ部品を使う。 */}
        {openMinutes && (
          <MinutesDetail row={openMinutes} onClose={() => setOpenMinutes(null)} />
        )}
      </div>
    );
  }

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

          {successPanel}
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

        {successPanel}
      </div>
    </div>
  );
}
