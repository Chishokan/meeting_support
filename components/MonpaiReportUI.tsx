'use client';

// 門配管理：実績報告（スマホで使う想定）。自分が担当の門配を並べ、その場で配った部数と様子を入れる。

import { useEffect, useMemo, useState } from 'react';
import { isMine, shiftMonth, todayJst, weekOf, type MonpaiRecord } from '@/lib/monpai/model';
import { fetchRecords, reasonText, saveRecordApi } from '@/lib/monpai/client';

const UPCOMING_DAYS = 14;

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}（${weekOf(date)}）`;

export default function MonpaiReportUI({ me }: { me: string }) {
  const today = todayJst();
  const [records, setRecords] = useState<MonpaiRecord[]>([]);
  const [onlyMine, setOnlyMine] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // 先月（報告漏れ）〜来月（2週間先）までを読む
    const cur = today.slice(0, 7);
    fetchRecords([shiftMonth(cur, -1), cur, shiftMonth(cur, 1)]).then((r) => {
      setLoading(false);
      if (r.ok) setRecords(r.items); else setError(reasonText(r.reason));
    });
  }, [today]);

  const visible = useMemo(
    () => records.filter((r) => !onlyMine || isMine(r, me)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
    [records, onlyMine, me],
  );
  const pending = visible.filter((r) => r.status === '予定' && r.date <= today);
  const upcoming = visible.filter((r) => r.status === '予定' && r.date > today && r.date <= addDays(today, UPCOMING_DAYS));
  const reported = visible.filter((r) => r.status !== '予定' && r.date >= addDays(today, -7)).reverse();

  const replace = (r: MonpaiRecord) => setRecords((prev) => prev.map((x) => (x.id === r.id ? r : x)));

  return (
    <div className="mp mp-report">
      <div className="mp-toolbar">
        <h1 className="mp-h1">実績報告</h1>
        <label className="mp-check">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          自分の担当だけ（{me}）
        </label>
      </div>
      {error && <div className="mp-note">{error}</div>}
      {loading && <div className="mp-loading">読み込み中…</div>}

      <h2 className="mp-h2">報告待ち <span className="mp-count">{pending.length}</span></h2>
      {pending.length === 0 && !loading && <p className="mp-muted">報告待ちの門配はありません。</p>}
      {pending.map((r) => <ReportCard key={r.id} r={r} onSaved={replace} />)}

      <h2 className="mp-h2">これからの予定（{UPCOMING_DAYS}日先まで）</h2>
      {upcoming.length === 0 && !loading && <p className="mp-muted">予定はありません。</p>}
      {upcoming.map((r) => (
        <div key={r.id} className="mp-card upcoming">
          <div className="mp-card-head"><b>{md(r.date)}</b> {r.time} <span className="mp-card-school">{r.district}・{r.school}</span></div>
          <div className="mp-card-sub">担当 {r.staff1}{r.staff2 ? '・' + r.staff2 : ''}　計画 {r.planned}部{r.material ? `　${r.material}` : ''}</div>
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
    </div>
  );
}

function ReportCard({ r, onSaved }: { r: MonpaiRecord; onSaved: (r: MonpaiRecord) => void }) {
  const [done, setDone] = useState(String(r.planned || ''));
  const [reason, setReason] = useState(r.reason);
  const [memo, setMemo] = useState(r.memo);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function send(cancel: boolean) {
    setBusy(true);
    setErr('');
    const res = await saveRecordApi({
      ...r,
      done: cancel ? 0 : done === '' ? null : Number(done),
      status: cancel ? '中止' : '予定',
      reason,
      memo,
    });
    setBusy(false);
    if (!res.ok) return setErr(res.errors?.join(' ') || reasonText(res.reason));
    onSaved(res.item);
  }

  const short = done !== '' && Number(done) < r.planned;
  return (
    <div className="mp-card">
      <div className="mp-card-head"><b>{md(r.date)}</b> {r.time} <span className="mp-card-school">{r.district}・{r.school}</span></div>
      <div className="mp-card-sub">担当 {r.staff1}{r.staff2 ? '・' + r.staff2 : ''}　計画 {r.planned}部{r.material ? `　${r.material}` : ''}</div>
      <div className="mp-card-form">
        <label>配った部数<input type="number" min={0} inputMode="numeric" value={done} onChange={(e) => setDone(e.target.value)} /></label>
        <label>反応・様子<input value={memo} placeholder="例 受け取りが良かった" onChange={(e) => setMemo(e.target.value)} /></label>
        <label>{short ? '少なかった理由' : '配れなかった理由（中止のとき）'}<input value={reason} placeholder="例 雨天" onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      {err && <div className="mp-err">{err}</div>}
      <div className="mp-card-actions">
        <button className="mp-btn" disabled={busy} onClick={() => send(true)}>中止を報告</button>
        <button className="mp-btn primary" disabled={busy || done === ''} onClick={() => send(false)}>{busy ? '送信中…' : '実績を報告'}</button>
      </div>
    </div>
  );
}
