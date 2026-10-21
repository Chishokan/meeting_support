'use client';

// 門配スタッフ（大学生・アルバイト）専用の画面（/monpai-staff）。スマホで使う想定。
//   報告      … 自分が担当の門配のうち、日付が来たものに配った部数・様子を入れる
//   月間の計画 … 自分が担当の門配を月ごとに一覧で見る（見るだけ。計画の変更は社員が行う）
// 他のアプリ（会議DXなど）へのリンクは置かない。読み書きは /api/monpai-staff だけ。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { samePerson, shiftMonth, staffNames, todayJst, weekOf, type MonpaiRecord } from '@/lib/monpai/model';
import { fetchMyRecords, reasonText, reportMyRecord } from '@/lib/monpai/client';
import { ReportCard } from './MonpaiReportUI';

const UPCOMING_DAYS = 14;

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}（${weekOf(date)}）`;
const monthLabel = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;
const byDate = (a: MonpaiRecord, b: MonpaiRecord) => (a.date + a.time).localeCompare(b.date + b.time);

/** 一緒に回る人（自分以外の担当）。 */
function partner(r: MonpaiRecord, me: string): string {
  return staffNames(r).filter((n) => !samePerson(n, me)).join('・');
}

type Tab = 'report' | 'plan';

export default function MonpaiStaffUI({ name, affiliation }: { name: string; affiliation: string }) {
  const [tab, setTab] = useState<Tab>('report');

  async function logout() {
    await fetch('/api/monpai-staff/logout', { method: 'POST' });
    window.location.href = '/monpai-staff/login';
  }

  return (
    <>
      <header className="board-head">
        <div className="board-brand">
          <span className="board-title">門配報告</span>
          <nav className="app-nav">
            <button className={`app-nav-item ${tab === 'report' ? 'active' : ''}`} onClick={() => setTab('report')}>報告</button>
            <button className={`app-nav-item ${tab === 'plan' ? 'active' : ''}`} onClick={() => setTab('plan')}>月間の計画</button>
          </nav>
        </div>
        <div className="board-who">
          <span className="board-user">{affiliation}／{name} さん</span>
          <button className="board-logout" onClick={logout}>ログアウト</button>
        </div>
      </header>
      <main className="board-main">
        <p className="mp-staff-me">{affiliation}／{name} さん</p>
        {tab === 'report' ? <ReportTab me={name} /> : <PlanTab me={name} />}
      </main>
    </>
  );
}

/** ログインが切れたらログイン画面へ戻す。 */
function useLoad(months: string[]) {
  const [items, setItems] = useState<MonpaiRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const key = months.join(',');
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    fetchMyRecords(key.split(',')).then((r) => {
      if (!alive) return;
      setLoading(false);
      if (r.ok) return setItems(r.items);
      if (r.reason === 'unauthorized') window.location.href = '/monpai-staff/login';
      else setError(reasonText(r.reason));
    });
    return () => { alive = false; };
  }, [key]);
  const replace = useCallback((r: MonpaiRecord) => setItems((p) => p.map((x) => (x.id === r.id ? r : x))), []);
  return { items, loading, error, replace };
}

function ReportTab({ me }: { me: string }) {
  const today = todayJst();
  const cur = today.slice(0, 7);
  // 先月（報告漏れ）〜来月（2週間先）までを読む
  const months = useMemo(() => [shiftMonth(cur, -1), cur, shiftMonth(cur, 1)], [cur]);
  const { items, loading, error, replace } = useLoad(months);

  const sorted = useMemo(() => [...items].sort(byDate), [items]);
  const pending = sorted.filter((r) => r.status === '予定' && r.date <= today);
  const upcoming = sorted.filter((r) => r.status === '予定' && r.date > today && r.date <= addDays(today, UPCOMING_DAYS));
  const reported = sorted.filter((r) => r.status !== '予定' && r.date >= addDays(today, -7)).reverse();

  return (
    <div className="mp mp-report">
      {error && <div className="mp-note">{error}</div>}
      {loading && <div className="mp-loading">読み込み中…</div>}

      <h2 className="mp-h2" style={{ marginTop: 0 }}>報告待ち <span className="mp-count">{pending.length}</span></h2>
      {pending.length === 0 && !loading && <p className="mp-muted">報告待ちの門配はありません。</p>}
      {pending.map((r) => <ReportCard key={r.id} r={r} onSaved={replace} submit={reportMyRecord} />)}

      <h2 className="mp-h2">これからの予定（{UPCOMING_DAYS}日先まで）</h2>
      {upcoming.length === 0 && !loading && <p className="mp-muted">予定はありません。</p>}
      {upcoming.map((r) => (
        <div key={r.id} className="mp-card upcoming">
          <div className="mp-card-head"><b>{md(r.date)}</b> {r.time} <span className="mp-card-school">{r.district}・{r.school}</span></div>
          <div className="mp-card-sub">
            {partner(r, me) && `一緒に回る人 ${partner(r, me)}　`}計画 {r.planned}部{r.material ? `　${r.material}` : ''}
          </div>
        </div>
      ))}

      {reported.length > 0 && (
        <>
          <h2 className="mp-h2">最近の報告（1週間）</h2>
          {reported.map((r) => (
            <div key={r.id} className={`mp-card done ${r.status === '中止' ? 'canceled' : ''}`}>
              <div className="mp-card-head"><b>{md(r.date)}</b> <span className="mp-card-school">{r.district}・{r.school}</span></div>
              <div className="mp-card-sub">
                {r.status === '中止' ? `中止：${r.reason}` : `計画 ${r.planned}部 → 実施 ${r.done}部`}{r.memo ? `　${r.memo}` : ''}
              </div>
            </div>
          ))}
        </>
      )}
      <p className="mp-legend">担当や日付が違うときは、担当の社員に連絡してください（この画面では計画は変えられません）。</p>
    </div>
  );
}

function PlanTab({ me }: { me: string }) {
  const today = todayJst();
  const [month, setMonth] = useState(today.slice(0, 7));
  const months = useMemo(() => [month], [month]);
  const { items, loading, error } = useLoad(months);

  const rows = useMemo(() => [...items].sort(byDate), [items]);
  const active = rows.filter((r) => r.status !== '中止');
  const planned = active.reduce((a, r) => a + r.planned, 0);
  const done = active.reduce((a, r) => a + (r.done ?? 0), 0);

  return (
    <div className="mp">
      <div className="mp-toolbar">
        <div className="mp-month">
          <button className="mp-btn" onClick={() => setMonth(shiftMonth(month, -1))}>‹ 前の月</button>
          <span className="mp-month-label">{monthLabel(month)}</span>
          <button className="mp-btn" onClick={() => setMonth(shiftMonth(month, 1))}>次の月 ›</button>
        </div>
      </div>
      {error && <div className="mp-note">{error}</div>}
      {loading && <div className="mp-loading">読み込み中…</div>}

      {!loading && (
        <p className="mp-muted">
          この月の担当 {active.length}回　計画 {planned}部　実施 {done}部
          {rows.length > active.length && `　（中止 ${rows.length - active.length}回）`}
        </p>
      )}
      {rows.length === 0 && !loading && !error && <p className="mp-muted">この月の担当の門配はありません。</p>}

      {rows.map((r) => {
        const state = r.status === '中止' ? '中止' : r.done != null ? '報告済み' : r.date < today ? '報告待ち' : r.date === today ? '今日' : '予定';
        return (
          <div key={r.id} className={`mp-card upcoming ${r.status === '中止' ? 'canceled' : ''}`}>
            <div className="mp-card-head">
              <b>{md(r.date)}</b> {r.time} <span className="mp-card-school">{r.district}・{r.school}</span>
              <span className={`mp-staff-state s-${state}`}>{state}</span>
            </div>
            <div className="mp-card-sub">
              {partner(r, me) && `一緒に回る人 ${partner(r, me)}　`}
              計画 {r.planned}部{r.done != null && r.status !== '中止' ? ` → 実施 ${r.done}部` : ''}
              {r.material ? `　${r.material}` : ''}
              {r.status === '中止' && r.reason ? `　理由：${r.reason}` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}
