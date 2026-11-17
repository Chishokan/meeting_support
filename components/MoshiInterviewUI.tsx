'use client';

// 成績管理：面談（個人成績）（/moshi/interview）。生徒を1人選んで、面談でそのまま見せられる画面に出す。
// 上の「見る模試」で本番レベル模試と県一斉模試を切り替える（県一斉模試は components/MoshiKenUI.tsx の KenInterviewView）。
// どちらも業者の成績の画面と同じ形の詳しい画面（本番レベル模試は components/MoshiHonbanDetail.tsx）。
//   - 前回との比較：前回＝この回より前のいちばん新しい回（県一斉模試も含む。11月なら10月の県一斉模試。lib/moshi/model.ts の prevRecordFor）
//   - 「大きく表示」で左の一覧とメニューを隠す（ほかの生徒の名前を見せないため）。印刷は個人成績表（A4 横）
//   - 過去テスト一覧で回を選ぶと、その回（本番レベル模試・県一斉模試）に切り替わる

import { useEffect, useMemo, useState } from 'react';
import {
  SUBJECT_KEYS, byExamNo, computeStats, kenExams, prevRecordFor, reportFigures,
  type PrevRecord, type RowStat,
} from '@/lib/moshi/model';
import {
  ExamCampusBar, KindSwitch, PageHead, StateNote, fmt1, hasHonbanScores, printLandscape,
  NO_KEN, useExamCampus, useKind, useMoshiData,
} from './MoshiShared';
import { ReportSheet } from './MoshiReportSheet';
import { KenInterviewView } from './MoshiKenUI';
import { HonbanDetail } from './MoshiHonbanDetail';

export default function MoshiInterviewUI({ name }: { name: string }) {
  const { state, reload } = useMoshiData();
  const exams = state.status === 'ready' ? state.exams : [];
  const results = state.status === 'ready' ? state.results : [];
  const kenitsu = state.status === 'ready' ? state.kenitsu : NO_KEN;
  const { exam, examId, campus, pickExam, pickCampus } = useExamCampus(exams, { allowAll: true, withData: results });
  const statsList = useMemo(() => exams.map((e) => computeStats(e, results)), [exams, results]);
  const stats = statsList.find((s) => s.exam.id === examId) ?? null;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState('');
  const [big, setBig] = useState(false);
  const [printing, setPrinting] = useState(false);
  const kenList = useMemo(() => kenExams(kenitsu), [kenitsu]);
  const hasHonban = useMemo(() => hasHonbanScores(results), [results]);
  const { kind, pickKind, kenExam, pickKen } = useKind(hasHonban, kenList);

  const list = useMemo(() => {
    if (!stats) return [] as RowStat[];
    const k = q.replace(/[\s　]/g, '');
    return byExamNo(stats.rows
      .filter((x) => !campus || x.r.campus === campus)
      .filter((x) => !k || x.r.name.replace(/[\s　]/g, '').includes(k) || x.r.examNo.includes(k))
      .map((x) => ({ ...x, examNo: x.r.examNo, name: x.r.name })));
  }, [stats, campus, q]);
  const takers = list.filter((x) => SUBJECT_KEYS.some((k) => x.sub[k] != null));
  const row = list.find((x) => x.r.id === sel) ?? takers[0] ?? null;
  const prev = useMemo(() => (row && stats ? prevRecordFor(statsList, kenitsu, stats.exam, row.r) : null), [row, stats, statsList, kenitsu]);
  // 過去テスト一覧で選んだ回へ切り替える（県一斉模試なら「見る模試」も切り替える）
  const onPick = (k: 'honban' | 'ken', id: string) => {
    if (k === 'ken') { pickKind('ken'); pickKen(id); } else { pickKind('honban'); pickExam(id); }
  };

  // 大きく表示：左のメニューと生徒の一覧を隠す（Esc で戻る）
  useEffect(() => {
    document.body.classList.toggle('ms-focus', big);
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false); };
    if (big) window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); document.body.classList.remove('ms-focus'); };
  }, [big]);

  const head = <PageHead title="成績管理｜面談（個人成績）" desc="生徒を1人選んで、面談で見せる画面を出します。「大きく表示」でほかの生徒の名前を隠せます。本番レベル模試と県一斉模試を切り替えられます。" name={name} />;
  if (state.status !== 'ready') {
    return <div className="ms">{head}<div className="ms-body"><StateNote state={state} onRetry={reload} /></div></div>;
  }
  if (kind === 'ken' || !exams.length || !exam || !stats) {
    return (
      <div className="ms">
        {head}
        <div className="ms-body">
          <KindSwitch kind={kind} onKind={pickKind} kenCount={kenList.length} />
          {kind === 'ken'
            ? <KenInterviewView kenitsu={kenitsu} kenList={kenList} kenExam={kenExam} onKen={pickKen} onPick={onPick} campus={campus} onCampus={pickCampus} exams={exams} results={results} statsList={statsList} />
            : <StateNote state={state} onRetry={reload} />}
        </div>
      </div>
    );
  }

  const idx = row ? takers.findIndex((x) => x.r.id === row.r.id) : -1;

  return (
    <div className={`ms ms-interview${big ? ' big' : ''}`}>
      {head}
      <div className="ms-body">
        {!big && <KindSwitch kind={kind} onKind={pickKind} kenCount={kenList.length} />}
        {!big && <ExamCampusBar exams={exams} examId={examId} campus={campus} onExam={pickExam} onCampus={pickCampus} allowAll />}
        <div className="ms-split">
          {!big && (
            <aside className="ms-noprint">
              <input className="ms-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="氏名・受験番号で探す" />
              <ul className="ms-pick">
                {list.map((x) => {
                  const taken = SUBJECT_KEYS.some((k) => x.sub[k] != null);
                  return (
                    <li key={x.r.id} className={row?.r.id === x.r.id ? 'on' : ''}>
                      <button type="button" disabled={!taken} onClick={() => setSel(x.r.id)}>
                        <span className="ms-pick-no">{x.r.examNo}</span>
                        <span className="ms-pick-name">{x.r.name || '（氏名なし）'}</span>
                        <span className="ms-pick-score">{taken ? (x.rank ? `${x.rank}位` : '途中') : '未受験'}</span>
                      </button>
                    </li>
                  );
                })}
                {!list.length && <li className="ms-muted">見つかりません</li>}
              </ul>
            </aside>
          )}
          <div className="ms-preview">
            {!row ? <p className="ms-note">得点が入っている生徒がまだいません。</p> : (
              <>
                <div className="ms-toolbar ms-noprint">
                  <button type="button" className="ms-btn ms-btn-sub" disabled={idx <= 0} onClick={() => setSel(takers[idx - 1].r.id)}>← 前の生徒</button>
                  <button type="button" className="ms-btn ms-btn-sub" disabled={idx < 0 || idx >= takers.length - 1} onClick={() => setSel(takers[idx + 1].r.id)}>次の生徒 →</button>
                  <span className="ms-spacer" />
                  <button type="button" className="ms-btn ms-btn-sub" onClick={() => setBig((b) => !b)}>{big ? '一覧に戻る（Esc）' : '大きく表示'}</button>
                  <button type="button" className="ms-btn" onClick={() => printLandscape(() => setPrinting(true))}>成績表を印刷</button>
                </div>
                {prev && <PrevCompare prev={prev} stats={stats} row={row} />}
                <div className="ms-noprint">
                  <HonbanDetail stats={stats} statsList={statsList} row={row} kenitsu={kenitsu} prev={prev} onPick={onPick} />
                </div>
                {printing && (
                  <div className="ms-print-only">
                    <div className="ms-page"><ReportSheet stats={stats} statsList={statsList} row={row} kenitsu={kenitsu} /></div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function diffText(n: number, unit: string, digits = 0): string {
  const v = digits ? Math.round(n * 10) / 10 : Math.round(n);
  if (v === 0) return `±0${unit}`;
  return `${v > 0 ? '+' : ''}${digits ? v.toFixed(1) : v}${unit}`;
}

/** 前回（11月なら10月の県一斉模試）との比較：5教科の得点・偏差値（偏差値は成績表と同じ換算）。 */
function PrevCompare({ prev, stats, row }: { prev: PrevRecord; stats: Parameters<typeof reportFigures>[0]; row: RowStat }) {
  const k5 = reportFigures(stats, row).find((f) => f.key === 'k5');
  const b = prev.stats.k5;
  if (!k5 || k5.score == null || b?.score == null) return null;
  const up = k5.score - b.score;
  return (
    <div className="ms-compare ms-noprint">
      <span className="ms-compare-h">前回（{prev.name}）との比較</span>
      <span>5教科 <b className={up > 0 ? 'up' : up < 0 ? 'down' : ''}>{diffText(up, '点')}</b>（{b.score} → {k5.score}）</span>
      {b.dev != null && k5.dev != null && <span>偏差値 <b>{diffText(k5.dev - b.dev, '', 1)}</b>（{fmt1(b.dev)} → {fmt1(k5.dev)}）</span>}
      {b.rank != null && <span>前回の{prev.rankLabel} {b.rank.toLocaleString('ja-JP')}位</span>}
    </div>
  );
}
