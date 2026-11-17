'use client';

// 本番レベル模試：受験票（/moshi/ticket）。名簿の生徒を選び、A4 に2人分か4人分ずつ並べて印刷する（切り取り線つき）。
// 模試名・実施日・会場・時間割・持ち物・注意事項は「模試の設定」の値を使う。

import { useEffect, useMemo, useState } from 'react';
import { byExamNo, campusInfo, jpDate, venueOf, type MoshiExam, type MoshiResult } from '@/lib/moshi/model';
import { ExamCampusBar, PageHead, StateNote, printPortrait, useExamCampus, useMoshiData } from './MoshiShared';

type Layout = 2 | 4;
const LAYOUT_KEY = 'moshi.ticketLayout';

export default function MoshiTicketUI({ name }: { name: string }) {
  const { state, reload } = useMoshiData();
  const exams = state.status === 'ready' ? state.exams : [];
  const results = state.status === 'ready' ? state.results : [];
  const { exam, examId, campus, pickExam, pickCampus } = useExamCampus(exams, { allowAll: true, withData: results });
  const [layout, setLayout] = useState<Layout>(4);
  useEffect(() => {
    try { if (localStorage.getItem(LAYOUT_KEY) === '2') setLayout(2); } catch {}
  }, []);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  const list = useMemo(
    () => byExamNo(results.filter((r) => r.examId === examId && (!campus || r.campus === campus))),
    [results, examId, campus],
  );
  const chosen = list.filter((r) => !unchecked.has(r.id));
  const pages = useMemo(() => {
    const out: MoshiResult[][] = [];
    for (let i = 0; i < chosen.length; i += layout) out.push(chosen.slice(i, i + layout));
    return out;
  }, [chosen, layout]);

  if (state.status !== 'ready' || !exams.length || !exam) {
    return (
      <div className="ms">
        <PageHead title="本番レベル模試｜受験票" desc="名簿の生徒の受験票を印刷します。" name={name} />
        <div className="ms-body"><StateNote state={state} onRetry={reload} /></div>
      </div>
    );
  }

  const missing: string[] = [];
  if (!exam.date) missing.push('実施日');
  if (!exam.schedule.length) missing.push('時間割');
  else if (exam.schedule.some((s) => !s.time)) missing.push('時間割の時刻');
  const noNames = chosen.filter((r) => !r.name).length;

  function pickLayout(n: Layout) {
    setLayout(n);
    try { localStorage.setItem(LAYOUT_KEY, String(n)); } catch {}
  }
  function toggle(id: string) {
    setUnchecked((u) => { const n = new Set(u); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  return (
    <div className="ms">
      <PageHead title="本番レベル模試｜受験票" desc="名簿の生徒の受験票を、A4 に2人分か4人分ずつ並べて印刷します（切り取り線つき）。" name={name} />
      <div className="ms-body">
        <ExamCampusBar exams={exams} examId={examId} campus={campus} onExam={pickExam} onCampus={pickCampus} allowAll />
        <div className="ms-toolbar ms-noprint">
          <div className="ms-seg">
            <button type="button" className={layout === 4 ? 'on' : ''} onClick={() => pickLayout(4)}>1枚に4人</button>
            <button type="button" className={layout === 2 ? 'on' : ''} onClick={() => pickLayout(2)}>1枚に2人</button>
          </div>
          <button type="button" className="ms-btn" disabled={!chosen.length} onClick={printPortrait}>印刷する（{chosen.length}人・{pages.length}枚）</button>
          <button type="button" className="ms-btn ms-btn-sub" onClick={() => setUnchecked(new Set())}>すべて選ぶ</button>
          <button type="button" className="ms-btn ms-btn-sub" onClick={() => setUnchecked(new Set(list.map((r) => r.id)))}>すべて外す</button>
        </div>
        {missing.length > 0 && (
          <p className="ms-notice warn ms-noprint">{missing.join('・')}が「模試の設定」に入っていません。空欄のまま印刷されます。</p>
        )}
        {noNames > 0 && <p className="ms-notice warn ms-noprint">氏名が入っていない人が {noNames}人います（氏名の欄は空いたまま出ます）。</p>}
        {!list.length && <p className="ms-note">この回の名簿がまだありません。「成績入力」で名簿を作ってください。</p>}

        {list.length > 0 && (
          <div className="ms-ticket-pick ms-noprint">
            {list.map((r) => (
              <label key={r.id} className="ms-check">
                <input type="checkbox" checked={!unchecked.has(r.id)} onChange={() => toggle(r.id)} />
                {r.examNo} {r.name || '（氏名なし）'}
              </label>
            ))}
          </div>
        )}

        <div className={`ms-tickets ms-tickets-${layout}`}>
          {pages.map((p, i) => (
            <div key={i} className="ms-ticket-page">
              {p.map((r) => <Ticket key={r.id} exam={exam} r={r} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Ticket({ exam, r }: { exam: MoshiExam; r: MoshiResult }) {
  return (
    <section className="ms-ticket">
      <header>
        <span className="ms-ticket-kind">受験票</span>
        <span className="ms-ticket-exam">{exam.name}{exam.grade && `（${exam.grade}）`}</span>
      </header>
      <div className="ms-ticket-body">
        <dl className="ms-ticket-main">
          <dt>受験番号</dt><dd className="ms-ticket-no">{r.examNo || '\u3000'}</dd>
          <dt>氏名</dt><dd className="ms-ticket-name">{r.name || '\u3000'}</dd>
          <dt>実施日</dt><dd>{exam.date ? jpDate(exam.date) : '\u3000'}</dd>
          <dt>会場</dt><dd>{venueOf(exam, r.campus)}</dd>
        </dl>
        <div className="ms-ticket-side">
          {exam.schedule.length > 0 && (
            <table className="ms-ticket-sched">
              <tbody>
                {exam.schedule.map((s, i) => <tr key={i}><th>{s.label}</th><td>{s.time}</td></tr>)}
              </tbody>
            </table>
          )}
          {exam.belongings && <p className="ms-ticket-note"><b>持ち物</b>{exam.belongings}</p>}
          {exam.notes && <p className="ms-ticket-note"><b>注意</b>{exam.notes}</p>}
        </div>
      </div>
      <footer>智翔館 {campusInfo(r.campus)?.label ?? r.campus}　※当日はこの受験票を持ってきてください。</footer>
    </section>
  );
}
