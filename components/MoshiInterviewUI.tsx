'use client';

// 本番レベル模試：面談（個人成績）（/moshi/interview）。生徒を1人選んで、面談でそのまま見せられる画面に出す。
//   - 合計・偏差値・順位、教科ごとの得点と平均、大問別の得点率、よくできた／伸ばしたい分野、志望者内の順位、これまでの推移
//   - 前の回との差（合計・偏差値・順位）
//   - 「大きく表示」で左の一覧とメニューを隠す（ほかの生徒の名前を見せないため）
//   - 成績表のコメント（先生から）をここで書いて保存し、成績表に印刷する
// 中身は個人成績表（components/MoshiReportSheet.tsx）と同じものを、画面の幅に合わせて出す。

import { useEffect, useMemo, useState } from 'react';
import {
  MAX_COMMENT, SUBJECT_KEYS, byExamNo, campusInfo, computeStats, dev5Of, historyOf,
  type MoshiResult, type RowStat,
} from '@/lib/moshi/model';
import {
  ExamCampusBar, PageHead, StateNote, fmt1, printLandscape, reasonText, shortExamName,
  useExamCampus, useMoshiData,
} from './MoshiShared';
import { FitSheet, ReportSheet } from './MoshiReportSheet';

export default function MoshiInterviewUI({ name }: { name: string }) {
  const { state, reload, setResults } = useMoshiData();
  const exams = state.status === 'ready' ? state.exams : [];
  const results = state.status === 'ready' ? state.results : [];
  const { exam, examId, campus, pickExam, pickCampus } = useExamCampus(exams, { allowAll: true, withData: results });
  const statsList = useMemo(() => exams.map((e) => computeStats(e, results)), [exams, results]);
  const stats = statsList.find((s) => s.exam.id === examId) ?? null;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState('');
  const [big, setBig] = useState(false);
  const [printing, setPrinting] = useState(false);

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
  const history = useMemo(() => (row ? historyOf(statsList, row.r) : []), [statsList, row]);

  // 大きく表示：左のメニューと生徒の一覧を隠す（Esc で戻る）
  useEffect(() => {
    document.body.classList.toggle('ms-focus', big);
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false); };
    if (big) window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); document.body.classList.remove('ms-focus'); };
  }, [big]);

  if (state.status !== 'ready' || !exams.length || !exam || !stats) {
    return (
      <div className="ms">
        <PageHead title="本番レベル模試｜面談（個人成績）" desc="生徒を1人選んで、面談で見せる画面を出します。" name={name} />
        <div className="ms-body"><StateNote state={state} onRetry={reload} /></div>
      </div>
    );
  }

  const idx = row ? takers.findIndex((x) => x.r.id === row.r.id) : -1;
  const at = history.findIndex((h) => h.exam.id === exam.id);
  const before = at > 0 ? history[at - 1] : null;

  return (
    <div className={`ms ms-interview${big ? ' big' : ''}`}>
      <PageHead title="本番レベル模試｜面談（個人成績）" desc="生徒を1人選んで、面談で見せる画面を出します。「大きく表示」でほかの生徒の名前を隠せます。" name={name} />
      <div className="ms-body">
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
                {before && (
                  <Compare
                    before={before.row} now={row} label={shortExamName(before.exam)} beforeN={before.n} nowN={stats.complete}
                    beforeDev={dev5Of(before.exam, before.row)} nowDev={dev5Of(exam, row)}
                  />
                )}
                <div className="ms-noprint ms-interview-card">
                  <FitSheet max={1.6}><ReportSheet stats={stats} statsList={statsList} row={row} /></FitSheet>
                </div>
                <CommentEditor key={row.r.id} r={row.r} examId={exam.id} onSaved={(c) => setResults((rs) => rs.map((x) => (x.id === row.r.id ? { ...x, comment: c } : x)))} />
                {printing && (
                  <div className="ms-print-only">
                    <div className="ms-page"><ReportSheet stats={stats} statsList={statsList} row={row} /></div>
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

// 偏差値は成績表と同じ計算（業者の平均点・標準偏差があればその値。lib/moshi/model.ts の dev5Of）
function Compare({ before, now, label, beforeN, nowN, beforeDev, nowDev }: {
  before: RowStat; now: RowStat; label: string; beforeN: number; nowN: number; beforeDev: number | null; nowDev: number | null;
}) {
  if (before.total == null || now.total == null) return null;
  const up = now.total - before.total;
  return (
    <div className="ms-compare ms-noprint">
      <span className="ms-compare-h">前回（{label}）との比較</span>
      <span>合計 <b className={up > 0 ? 'up' : up < 0 ? 'down' : ''}>{diffText(up, '点')}</b>（{before.total} → {now.total}）</span>
      {beforeDev != null && nowDev != null && <span>偏差値 <b>{diffText(nowDev - beforeDev, '', 1)}</b>（{fmt1(beforeDev)} → {fmt1(nowDev)}）</span>}
      {before.rank != null && now.rank != null && <span>順位 {before.rank}位／{beforeN}人 → <b>{now.rank}位</b>／{nowN}人</span>}
    </div>
  );
}

function CommentEditor({ r, examId, onSaved }: { r: MoshiResult; examId: string; onSaved: (c: string) => void }) {
  const [text, setText] = useState(r.comment);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const changed = text !== r.comment;
  async function save() {
    setBusy(true);
    setMsg('保存中…');
    try {
      const res = await fetch('/api/moshi/results', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examId,
          rows: [{ row: { id: r.id, campus: r.campus, examNo: r.examNo, name: r.name, gender: r.gender, choices: r.choices, scores: r.scores, comment: text }, fields: ['comment'] }],
        }),
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) { setMsg(reasonText(j?.reason, j?.detail)); return; }
      onSaved(text);
      setMsg('保存しました。成績表の「先生から」に出ます。');
    } catch {
      setMsg(reasonText('network_error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ms-comment-edit ms-noprint">
      <label htmlFor="ms-comment">成績表のコメント（先生から）<small>{text.length}/{MAX_COMMENT}字・{campusInfo(r.campus)?.label} {r.name} さん</small></label>
      <textarea id="ms-comment" value={text} maxLength={MAX_COMMENT} rows={3} onChange={(e) => setText(e.target.value)} placeholder="面談で伝えたこと・次の回までにやること" />
      <div className="ms-actions">
        <button type="button" className="ms-btn" disabled={busy || !changed} onClick={save}>コメントを保存</button>
        {msg && <span className="ms-msg">{msg}</span>}
      </div>
    </div>
  );
}
