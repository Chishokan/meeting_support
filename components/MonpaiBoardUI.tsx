'use client';

// 門配管理：月間一覧。地区を切り替え、「日付 × 学校」の表で1か月の計画と実績を見渡す。
// 表の上に学校ごとのボトム（最低配布数）と達成率を出し、足りない学校がひと目で分かるようにする。

import { useEffect, useMemo, useState } from 'react';
import {
  DISTRICTS, bottomOf, daysOf, shiftMonth, todayJst,
  type MonpaiRecord, type School,
} from '@/lib/monpai/model';
import { fetchMaster, fetchRecords, reasonText, type Master } from '@/lib/monpai/client';
import MonpaiRecordForm, { type Draft } from './MonpaiRecordForm';

const DISTRICT_KEY = 'monpai.district';

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export default function MonpaiBoardUI({ staffNames }: { staffNames: string[] }) {
  const today = todayJst();
  const [district, setDistrict] = useState<string>(DISTRICTS[0]);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [master, setMaster] = useState<Master | null>(null);
  const [records, setRecords] = useState<MonpaiRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cellList, setCellList] = useState<{ date: string; school: string } | null>(null);

  // 前回見ていた地区を覚えておく（端末ごと。読めなくても動く）
  useEffect(() => {
    try {
      const d = localStorage.getItem(DISTRICT_KEY);
      if (d && (DISTRICTS as readonly string[]).includes(d)) setDistrict(d);
    } catch {}
  }, []);
  function pickDistrict(d: string) {
    setDistrict(d);
    try { localStorage.setItem(DISTRICT_KEY, d); } catch {}
  }

  useEffect(() => {
    fetchMaster().then((r) => (r.ok ? setMaster(r.master) : setError(reasonText(r.reason))));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchRecords([month]).then((r) => {
      setLoading(false);
      if (r.ok) { setRecords(r.items); setError(''); } else setError(reasonText(r.reason));
    });
  }, [month]);

  const schools: School[] = useMemo(
    () => (master?.schools ?? []).filter((s) => s.district === district).sort((a, b) => a.order - b.order),
    [master, district],
  );
  const days = useMemo(() => daysOf(month), [month]);
  const inDistrict = useMemo(() => records.filter((r) => r.district === district), [records, district]);

  const cell = (date: string, school: string) => inDistrict.filter((r) => r.date === date && r.school === school);

  const summary = schools.map((s) => {
    const rs = inDistrict.filter((r) => r.school === s.name && r.status !== '中止');
    const planned = rs.reduce((a, r) => a + r.planned, 0);
    const done = rs.reduce((a, r) => a + (r.done ?? 0), 0);
    return { school: s, ...bottomOf(s, master?.settings ?? [], month), planned, done };
  });
  const total = summary.reduce(
    (a, x) => ({ bottom: a.bottom + x.bottom, planned: a.planned + x.planned, done: a.done + x.done }),
    { bottom: 0, planned: 0, done: 0 },
  );

  function openCell(date: string, school: string) {
    const rs = cell(date, school);
    if (rs.length === 0) setDraft({ date, district, school });
    else if (rs.length === 1) setDraft(rs[0]);
    else setCellList({ date, school });
  }

  function onSaved(r: MonpaiRecord) {
    setRecords((prev) => {
      const rest = prev.filter((x) => x.id !== r.id);
      return r.date.startsWith(month) ? [...rest, r] : rest;
    });
    setDraft(null);
  }
  function onDeleted(id: string) {
    setRecords((prev) => prev.filter((x) => x.id !== id));
    setDraft(null);
  }

  const [y, m] = month.split('-');

  return (
    <div className="mp">
      <div className="mp-toolbar">
        <div className="mp-tabs">
          {DISTRICTS.map((d) => (
            <button key={d} className={`mp-tab ${d === district ? 'active' : ''}`} onClick={() => pickDistrict(d)}>
              {d}
            </button>
          ))}
        </div>
        <div className="mp-month">
          <button className="mp-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="前の月">◀</button>
          <span className="mp-month-label">{y}年{Number(m)}月</span>
          <button className="mp-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="次の月">▶</button>
          {month !== today.slice(0, 7) && (
            <button className="mp-btn" onClick={() => setMonth(today.slice(0, 7))}>今月</button>
          )}
        </div>
      </div>

      {error && <div className="mp-note">{error}</div>}
      {master?.backend === 'local' && (
        <div className="mp-note">手元の開発用の保存先（.data/monpai.json）を使っています。</div>
      )}

      {master && schools.length === 0 ? (
        <div className="mp-empty">
          {district}地区の学校がまだ登録されていません。門配管理のスプレッドシートの「学校マスタ」に追加してください。
        </div>
      ) : (
        <>
          <div className="ib-table-wrap mp-summary-wrap">
            <table className="mp-summary">
              <thead>
                <tr><th>学校</th><th>生徒数</th><th>ボトム</th><th>計画</th><th>実績</th><th className="mp-bar-col">達成率（実績÷ボトム）</th></tr>
              </thead>
              <tbody>
                {summary.map((x) => {
                  const p = pct(x.done, x.bottom);
                  const planP = pct(x.planned, x.bottom);
                  return (
                    <tr key={x.school.name}>
                      <td className="mp-school">{x.school.name}</td>
                      <td className="mp-num">{x.school.students}</td>
                      <td className="mp-num">
                        {x.bottom}
                        <span className="mp-rate">{Math.round(x.rate * 100)}%{x.recruit ? '・募集期' : ''}</span>
                      </td>
                      <td className={`mp-num ${x.planned < x.bottom ? 'short' : ''}`}>{x.planned}</td>
                      <td className="mp-num">{x.done}</td>
                      <td>
                        <div className="mp-bar" title={`計画 ${planP}% ／ 実績 ${p}%`}>
                          <div className="mp-bar-plan" style={{ width: `${Math.min(planP, 100)}%` }} />
                          <div className={`mp-bar-done ${p >= 100 ? 'ok' : ''}`} style={{ width: `${Math.min(p, 100)}%` }} />
                          <span className="mp-bar-label">{p}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr className="mp-total">
                  <td>地区合計</td><td />
                  <td className="mp-num">{total.bottom}</td>
                  <td className="mp-num">{total.planned}</td>
                  <td className="mp-num">{total.done}</td>
                  <td className="mp-num">{pct(total.done, total.bottom)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mp-legend">
            <span className="mp-key plan" />計画 <span className="mp-key done" />実績　計画がボトムに届かない学校は計画の数字が赤。表のマスを押すと追加・編集できます。
          </p>

          <div className="ib-table-wrap">
            <table className="mp-grid">
              <thead>
                <tr>
                  <th className="mp-day">日</th>
                  <th className="mp-day">曜</th>
                  {schools.map((s) => <th key={s.name}>{s.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.date} className={`${d.holiday ? 'holiday' : ''} ${d.date === today ? 'today' : ''}`}>
                    <td className="mp-day">{d.day}</td>
                    <td className="mp-day mp-week-cell">{d.week}</td>
                    {schools.map((s) => {
                      const rs = cell(d.date, s.name);
                      const planned = rs.filter((r) => r.status !== '中止').reduce((a, r) => a + r.planned, 0);
                      const reported = rs.filter((r) => r.done != null);
                      const done = reported.reduce((a, r) => a + (r.done ?? 0), 0);
                      const canceled = rs.length > 0 && rs.every((r) => r.status === '中止');
                      const unreported = rs.some((r) => r.status === '予定') && d.date < today;
                      const cls = canceled ? 'canceled' : unreported ? 'unreported' : reported.length && done >= planned ? 'done' : rs.length ? 'planned' : '';
                      return (
                        <td key={s.name} className="mp-cell-td">
                          <button
                            className={`mp-cell ${cls}`}
                            onClick={() => openCell(d.date, s.name)}
                            title={rs.map((r) => `${r.time} ${r.staff1}${r.staff2 ? '・' + r.staff2 : ''} ${r.material}`).join('\n')}
                          >
                            {rs.length > 0 && (
                              <>
                                <span className="mp-cell-num">
                                  {canceled ? '中止' : `${planned}/${reported.length ? done : '—'}`}
                                </span>
                                <span className="mp-cell-staff">
                                  {Array.from(new Set(rs.flatMap((r) => [r.staff1, r.staff2]).filter(Boolean))).join('・')}
                                </span>
                              </>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mp-legend">マスの数字は「計画/実績」。<span className="mp-key unreported" />過ぎた日で実績が未報告　<span className="mp-key done" />計画どおり配布済み</p>
        </>
      )}
      {loading && <div className="mp-loading">読み込み中…</div>}

      {cellList && (
        <div className="mp-modal-bg" onClick={() => setCellList(null)}>
          <div className="mp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mp-modal-head"><h2>{cellList.date.slice(5).replace('-', '/')} {cellList.school}</h2></div>
            <div className="mp-form">
              {cell(cellList.date, cellList.school).map((r) => (
                <button key={r.id} className="mp-list-item" onClick={() => { setCellList(null); setDraft(r); }}>
                  {r.time || '時間未定'}　{r.staff1}{r.staff2 ? '・' + r.staff2 : ''}　計画{r.planned}／実績{r.done ?? '—'}{r.status === '中止' ? '（中止）' : ''}
                </button>
              ))}
            </div>
            <div className="mp-modal-foot">
              <span className="mp-spacer" />
              <button className="mp-btn" onClick={() => setCellList(null)}>閉じる</button>
              <button className="mp-btn primary" onClick={() => { const c = cellList; setCellList(null); setDraft({ date: c.date, district, school: c.school }); }}>＋ 追加</button>
            </div>
          </div>
        </div>
      )}

      {draft && (
        <MonpaiRecordForm
          draft={draft}
          schools={schools}
          staffNames={staffNames}
          onClose={() => setDraft(null)}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}
