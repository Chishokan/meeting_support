'use client';

// 門配管理：月の集計。全地区の1か月分を、地区・学校・担当ごとにまとめる（月の実績報告・会議資料用）。
// 数え方は月間一覧の集計表と同じ（lib/monpai/model.ts の summarizeMonth）。CSV で保存して Excel でも開ける。

import { useEffect, useMemo, useState } from 'react';
import { shiftMonth, summarizeMonth, todayJst, weekOf, type MonpaiRecord, type Tally } from '@/lib/monpai/model';
import { fetchMaster, fetchRecords, reasonText, type Master } from '@/lib/monpai/client';

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const rateText = (t: Tally) => (t.bottom > 0 ? `${pct(t.done, t.bottom)}%` : '—');
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}（${weekOf(date)}）`;
const staffOf = (r: MonpaiRecord) => [r.staff1, r.staff2].filter(Boolean).join('・');

/** BOM 付きの CSV（Excel で文字化けしない）を保存する。 */
function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Bar({ t }: { t: Tally }) {
  const p = pct(t.done, t.bottom);
  const planP = pct(t.planned, t.bottom);
  if (t.bottom <= 0) return <span className="mp-muted">ボトムなし</span>;
  return (
    <div className="mp-bar" title={`計画 ${planP}% ／ 実績 ${p}%`}>
      <div className="mp-bar-plan" style={{ width: `${Math.min(planP, 100)}%` }} />
      <div className={`mp-bar-done ${p >= 100 ? 'ok' : ''}`} style={{ width: `${Math.min(p, 100)}%` }} />
      <span className="mp-bar-label">{p}%</span>
    </div>
  );
}

/** 地区・学校の表で共通の数字の列。 */
function Cells({ t }: { t: Tally }) {
  return (
    <>
      <td className="mp-num">{t.bottom || '—'}</td>
      <td className={`mp-num ${t.bottom > 0 && t.planned < t.bottom ? 'short' : ''}`}>{t.planned}</td>
      <td className="mp-num"><b>{t.done}</b></td>
      <td><Bar t={t} /></td>
      <td className="mp-num">{t.visits}</td>
      <td className="mp-num">{t.canceled || ''}</td>
      <td className={`mp-num ${t.unreported ? 'short' : ''}`}>{t.unreported || ''}</td>
    </>
  );
}

const HEAD = (
  <>
    <th className="mp-num">ボトム</th><th className="mp-num">計画</th><th className="mp-num">実績</th>
    <th className="mp-bar-col">達成率（実績÷ボトム）</th>
    <th className="mp-num">実施回数</th><th className="mp-num">中止</th><th className="mp-num">未報告</th>
  </>
);

export default function MonpaiSummaryUI() {
  const today = todayJst();
  // 実績の集計は終わった月を見ることが多いので、先月から開く
  const lastMonth = shiftMonth(today.slice(0, 7), -1);
  const [month, setMonth] = useState(lastMonth);
  const [master, setMaster] = useState<Master | null>(null);
  const [records, setRecords] = useState<MonpaiRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMaster().then((r) => (r.ok ? setMaster(r.master) : setError(reasonText(r.reason))));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchRecords([month]).then((r) => {
      setLoading(false);
      if (r.ok) { setRecords(r.items); setError(''); } else { setRecords([]); setError(reasonText(r.reason)); }
    });
  }, [month]);

  const s = useMemo(
    () => summarizeMonth(records, master?.schools ?? [], master?.settings ?? [], month, today),
    [records, master, month, today],
  );
  const ready = !loading && !!master;
  const [y, m] = month.split('-');
  const title = `${y}年${Number(m)}月`;

  function saveSummaryCsv() {
    const row = (district: string, school: string, t: Tally) =>
      [district, school, t.bottom, t.planned, t.done, t.bottom > 0 ? pct(t.done, t.bottom) : null, t.visits, t.canceled, t.unreported, t.upcoming];
    downloadCsv(`門配集計_${month}.csv`, [
      ['地区', '学校', 'ボトム', '計画部数', '実施部数', '達成率(%)', '実施回数', '中止', '未報告', '予定'],
      ...s.districts.flatMap((d) => [
        ...d.schools.map((x) => row(d.district, x.registered ? x.school : `${x.school}（学校マスタに無し）`, x)),
        row(d.district, '（地区計）', d),
      ]),
      row('全地区合計', '', s.total),
    ]);
  }

  function saveRecordsCsv() {
    const rs = records.filter((r) => r.date.startsWith(month)).sort((a, b) => (a.date + a.district + a.time).localeCompare(b.date + b.district + b.time));
    downloadCsv(`門配記録_${month}.csv`, [
      ['日付', '曜日', '時間', '地区', '学校', '担当1', '担当2', '配布物', '計画部数', '実施部数', '状態', '不実施理由', '反応・様子'],
      ...rs.map((r) => [r.date, weekOf(r.date), r.time, r.district, r.school, r.staff1, r.staff2, r.material, r.planned, r.done, r.status, r.reason, r.memo]),
    ]);
  }

  return (
    <div className="mp mp-summary-page">
      <div className="mp-toolbar">
        <h1 className="mp-h1">月の集計（全地区）</h1>
        <div className="mp-month">
          <button className="mp-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="前の月">◀</button>
          <span className="mp-month-label">{title}</span>
          <button className="mp-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="次の月">▶</button>
          {month !== lastMonth && <button className="mp-btn" onClick={() => setMonth(lastMonth)}>先月</button>}
          <button className="mp-btn" disabled={!ready} onClick={saveSummaryCsv} title="地区・学校ごとの集計（Excel で開けます）">集計CSV</button>
          <button className="mp-btn" disabled={!ready} onClick={saveRecordsCsv} title="この月の門配の記録を1件1行で（Excel で開けます）">記録CSV</button>
        </div>
      </div>

      {error && <div className="mp-note">{error}</div>}
      {loading && <div className="mp-loading">読み込み中…</div>}

      {ready && (
        <>
          {s.total.unreported > 0 && (
            <div className="mp-note warn">
              実績が未報告の門配が {s.total.unreported} 件あります。報告されるまで実績に入りません（一覧は下の「未報告」）。
            </div>
          )}

          <div className="mp-kpis">
            <div className="mp-kpi main"><span>実績（実施部数）</span><b>{s.total.done.toLocaleString()}</b><small>部</small></div>
            <div className="mp-kpi"><span>ボトム</span><b>{s.total.bottom.toLocaleString()}</b><small>部</small></div>
            <div className="mp-kpi"><span>達成率</span><b>{rateText(s.total)}</b><small>実績÷ボトム</small></div>
            <div className="mp-kpi"><span>計画</span><b>{s.total.planned.toLocaleString()}</b><small>部（中止を除く）</small></div>
            <div className="mp-kpi"><span>実施回数</span><b>{s.total.visits}</b><small>回</small></div>
            <div className="mp-kpi"><span>中止</span><b>{s.total.canceled}</b><small>回</small></div>
            <div className={`mp-kpi ${s.total.unreported ? 'warn' : ''}`}><span>未報告</span><b>{s.total.unreported}</b><small>回</small></div>
          </div>

          <h2 className="mp-h2">地区別</h2>
          <div className="ib-table-wrap">
            <table className="mp-summary">
              <thead><tr><th>地区</th>{HEAD}</tr></thead>
              <tbody>
                {s.districts.map((d) => (
                  <tr key={d.district}><td className="mp-school">{d.district}</td><Cells t={d} /></tr>
                ))}
                <tr className="mp-total"><td>全地区合計</td><Cells t={s.total} /></tr>
              </tbody>
            </table>
          </div>
          <p className="mp-legend">
            <span className="mp-key plan" />計画 <span className="mp-key done" />実績　計画・実績に中止の回は数えません。実施回数は実績を報告した回数（0部の回も含む）。計画がボトムに届かない行は計画の数字が赤。
          </p>

          <h2 className="mp-h2">学校別</h2>
          <div className="ib-table-wrap">
            <table className="mp-summary">
              <thead><tr><th>地区</th><th>学校</th>{HEAD}</tr></thead>
              <tbody>
                {s.districts.filter((d) => d.schools.length > 0).map((d) => [
                  ...d.schools.map((x) => (
                    <tr key={d.district + x.school}>
                      <td className="mp-muted">{d.district}</td>
                      <td className="mp-school">{x.school}{!x.registered && <span className="mp-rate">学校マスタに無し</span>}</td>
                      <Cells t={x} />
                    </tr>
                  )),
                  <tr key={d.district + '計'} className="mp-subtotal"><td>{d.district}</td><td>地区計</td><Cells t={d} /></tr>,
                ])}
              </tbody>
            </table>
          </div>

          <h2 className="mp-h2">担当別</h2>
          {s.staff.length === 0 ? (
            <p className="mp-muted">この月は担当が書かれた記録がありません。</p>
          ) : (
            <>
              <div className="ib-table-wrap">
                <table className="mp-summary mp-staff-table">
                  <thead><tr><th>担当</th><th className="mp-num">実施回数</th><th className="mp-num">配布部数</th><th className="mp-num">中止</th><th className="mp-num">未報告</th></tr></thead>
                  <tbody>
                    {s.staff.map((x) => (
                      <tr key={x.name}>
                        <td className="mp-school">{x.name}</td>
                        <td className="mp-num">{x.visits}</td>
                        <td className="mp-num"><b>{x.done}</b></td>
                        <td className="mp-num">{x.canceled || ''}</td>
                        <td className={`mp-num ${x.unreported ? 'short' : ''}`}>{x.unreported || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mp-legend">2人で担当した回は、それぞれに回数・部数を数えます（担当別の合計は全体の実績と一致しません）。姓だけと姓名で書かれた人は1人にまとめています。</p>
            </>
          )}

          {s.unreported.length > 0 && (
            <>
              <h2 className="mp-h2">未報告 <span className="mp-count">{s.unreported.length}</span></h2>
              <div className="ib-table-wrap">
                <table className="mp-summary">
                  <thead><tr><th>日付</th><th>地区</th><th>学校</th><th>時間</th><th>担当</th><th className="mp-num">計画</th></tr></thead>
                  <tbody>
                    {s.unreported.map((r) => (
                      <tr key={r.id}><td>{md(r.date)}</td><td>{r.district}</td><td className="mp-school">{r.school}</td><td>{r.time}</td><td>{staffOf(r) || '未定'}</td><td className="mp-num">{r.planned}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mp-legend">担当の人は「実績報告」から、ほかの人は「月間一覧」の表のマスから実績を入れられます。</p>
            </>
          )}

          {s.canceled.length > 0 && (
            <>
              <h2 className="mp-h2">中止</h2>
              <div className="ib-table-wrap">
                <table className="mp-summary">
                  <thead><tr><th>日付</th><th>地区</th><th>学校</th><th>担当</th><th>理由</th></tr></thead>
                  <tbody>
                    {s.canceled.map((r) => (
                      <tr key={r.id}><td>{md(r.date)}</td><td>{r.district}</td><td className="mp-school">{r.school}</td><td>{staffOf(r)}</td><td className="mp-wrap">{r.reason}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
