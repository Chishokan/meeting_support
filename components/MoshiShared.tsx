'use client';

// 本番レベル模試（/moshi）の画面で共通に使う部品：データの読み込み、回と校舎の選択、グラフ、個人成績表。
// 計算は lib/moshi/model.ts、志望校の名前は lib/moshi/schools.ts。

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CAMPUS_NAMES, SUBJECT_KEYS, SUBJECT_NAMES, campusInfo, choiceRanks, jpDate, round1, sortExams,
  strengthsAndWeaknesses, subjectMax, subjectOf, topicPoints, examMax,
  type ExamStats, type HistoryPoint, type MoshiExam, type MoshiResult, type RowStat,
} from '@/lib/moshi/model';
import { schoolName } from '@/lib/moshi/schools';
import { MOSHI_DEPTS } from '@/lib/moshi/access';

// ---- 失敗の理由 ------------------------------------------------------------

const REASONS: Record<string, string> = {
  not_configured: '保存先（スプレッドシート連携の Apps Script）が未設定です。管理者に伝えてください。',
  not_deployed: '保存先のスクリプトが古いままです。管理者に Apps Script の再デプロイを依頼してください。',
  forbidden: `${MOSHI_DEPTS.join('・')}の職員だけが使えます。`,
  unauthorized: 'ログインが切れました。ページを読み込み直して、ログインし直してください。',
  upstream_error: 'スプレッドシートの読み書きに失敗しました。少し待ってからもう一度試してください。',
  network_error: '通信エラーが起きました。もう一度試してください。',
  timeout: 'スプレッドシートの応答が遅く、途中で止まりました。もう一度試してください。',
  exam_not_found: 'この回が見つかりません（他の人が消したかもしれません）。ページを読み込み直してください。',
  bad_score: '配点を超える得点か、数字でない得点があります。',
  bad_exam_no: '受験番号は数字で入れてください。',
  bad_campus: '校舎を選び直してください。',
  no_name: '模試名を入れてください。',
  bad_date: '実施日を選び直してください。',
  bad_questions: '大問は1つ以上・10まで入れてください。',
  bad_max: '配点は1〜100の整数で入れてください。',
  has_results: 'この回には成績が入っています。',
  not_found: '見つかりませんでした（他の人が消したかもしれません）。',
};

export function reasonText(reason: unknown, detail?: unknown): string {
  const r = String(reason ?? '');
  const base = REASONS[r] ?? (r.startsWith('db_open_failed') ? 'スプレッドシートを開けませんでした。管理者に伝えてください。' : `うまくいきませんでした（${r || '不明'}）。`);
  return detail ? `${base}（${String(detail)}）` : base;
}

// ---- データの読み込み -------------------------------------------------------

export type MoshiState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; exams: MoshiExam[]; results: MoshiResult[]; backend: string; fetchedAt: string };

export function useMoshiData() {
  const [state, setState] = useState<MoshiState>({ status: 'loading' });
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/moshi', { cache: 'no-store' });
      const j = await res.json().catch(() => null);
      if (!j?.ok) { setState({ status: 'error', message: reasonText(j?.reason) }); return false; }
      setState({ status: 'ready', exams: sortExams(j.exams), results: j.results, backend: j.backend, fetchedAt: j.fetchedAt });
      return true;
    } catch {
      setState({ status: 'error', message: reasonText('network_error') });
      return false;
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const setResults = useCallback((fn: (rs: MoshiResult[]) => MoshiResult[]) => {
    setState((s) => (s.status === 'ready' ? { ...s, results: fn(s.results) } : s));
  }, []);
  const setExams = useCallback((fn: (es: MoshiExam[]) => MoshiExam[]) => {
    setState((s) => (s.status === 'ready' ? { ...s, exams: sortExams(fn(s.exams)) } : s));
  }, []);
  return { state, reload: load, setResults, setExams };
}

export function newId(): string {
  try { return crypto.randomUUID(); } catch { return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; }
}

// ---- 回と校舎の選択（端末ごとに覚える） ---------------------------------------

const EXAM_KEY = 'moshi.exam';
const CAMPUS_KEY = 'moshi.campus';
export const ALL_CAMPUSES = '';

/**
 * 回と校舎の選択。前に選んだ回（端末ごと）があればそれ、無ければ新しい回から。
 * withData を渡すと、成績が入っている回の中でいちばん新しい回を先に選ぶ（成績表・面談で、まだ空の次の回が出ないように）。
 */
export function useExamCampus(exams: MoshiExam[], { allowAll, withData }: { allowAll: boolean; withData?: MoshiResult[] }) {
  const [examId, setExamId] = useState('');
  const [campus, setCampus] = useState<string>(allowAll ? ALL_CAMPUSES : CAMPUS_NAMES[0]);
  useEffect(() => {
    try {
      const c = localStorage.getItem(CAMPUS_KEY);
      if (c && CAMPUS_NAMES.includes(c)) setCampus(c);
      else if (c === ALL_CAMPUSES && allowAll) setCampus(ALL_CAMPUSES);
    } catch {}
  }, [allowAll]);
  useEffect(() => {
    if (!exams.length) return;
    if (examId && exams.some((e) => e.id === examId)) return;
    let saved = '';
    try { saved = localStorage.getItem(EXAM_KEY) ?? ''; } catch {}
    const filled = withData ? exams.find((e) => withData.some((r) => r.examId === e.id)) : undefined;
    setExamId(exams.some((e) => e.id === saved) ? saved : (filled ?? exams[0]).id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exams, examId]);
  const pickExam = (id: string) => { setExamId(id); try { localStorage.setItem(EXAM_KEY, id); } catch {} };
  const pickCampus = (c: string) => { setCampus(c); try { localStorage.setItem(CAMPUS_KEY, c); } catch {} };
  const exam = exams.find((e) => e.id === examId) ?? null;
  return { exam, examId, campus, pickExam, pickCampus };
}

export function examOptionLabel(e: MoshiExam): string {
  return e.date ? `${e.name}（${e.date.slice(5).replace('-', '/')}）` : e.name;
}

export function ExamCampusBar({
  exams, examId, campus, onExam, onCampus, allowAll, children,
}: {
  exams: MoshiExam[]; examId: string; campus: string;
  onExam: (id: string) => void; onCampus: (c: string) => void; allowAll: boolean; children?: ReactNode;
}) {
  return (
    <div className="ms-bar ms-noprint">
      <label>
        <span>回</span>
        <select value={examId} onChange={(e) => onExam(e.target.value)}>
          {exams.map((e) => <option key={e.id} value={e.id}>{examOptionLabel(e)}</option>)}
        </select>
      </label>
      <label>
        <span>校舎</span>
        <select value={campus} onChange={(e) => onCampus(e.target.value)}>
          {allowAll && <option value={ALL_CAMPUSES}>すべての校舎</option>}
          {CAMPUS_NAMES.map((c) => <option key={c} value={c}>{campusInfo(c)?.label ?? c}</option>)}
        </select>
      </label>
      {children}
      <Link className="ms-bar-link" href="/moshi/settings">模試の設定</Link>
    </div>
  );
}

/** 回がまだ無い・読み込み中・失敗のときの表示。ready なら null。 */
export function StateNote({ state, onRetry }: { state: MoshiState; onRetry: () => void }) {
  if (state.status === 'loading') return <p className="ms-note">読み込み中…（スプレッドシートから読むので数秒かかります）</p>;
  if (state.status === 'error') return (
    <div className="ms-note ms-note-err">
      <p>{state.message}</p>
      <button type="button" onClick={onRetry}>もう一度読み込む</button>
    </div>
  );
  if (!state.exams.length) return (
    <div className="ms-note">
      <p>まだ模試の回がありません。はじめに「模試の設定」で回（模試名・実施日・配点）を作ってください。</p>
      <Link className="ms-btn" href="/moshi/settings">模試の設定を開く</Link>
    </div>
  );
  return null;
}

export function PageHead({ title, desc, name }: { title: string; desc: string; name: string }) {
  return (
    <div className="page-head ms-noprint">
      <h1>{title}</h1>
      <p>{desc}<span className="ms-who">（{name} さん）</span></p>
    </div>
  );
}

export function NotAllowed({ title }: { title: string }) {
  return (
    <div className="ms">
      <div className="page-head"><h1>{title}</h1></div>
      <p className="ms-note">{MOSHI_DEPTS.join('・')}の職員が使う画面です（生徒の氏名と成績を扱うため）。</p>
    </div>
  );
}

// ---- 表示の小物 ------------------------------------------------------------

export function fmt1(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : round1(n).toFixed(1);
}

export function fmtInt(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : String(Math.round(n));
}

export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 印刷する中身を差し替えてから印刷する（描き終わるのを待つ）。 */
export function printAfterRender(prepare: () => void) {
  prepare();
  setTimeout(() => window.print(), 150);
}

export function campusLabel(c: string): string {
  return c ? campusInfo(c)?.label ?? c : 'すべての校舎';
}

// ---- グラフ ----------------------------------------------------------------
// 色は1系列だけ（本人＝青）。平均は濃い灰色の縦線で重ね、凡例で示す（色だけに頼らない）。

/** 教科ごとの得点（横棒）と平均（縦線）。 */
export function SubjectBars({ stats, row }: { stats: ExamStats; row: RowStat }) {
  const W = 300, rowH = 26, left = 40, right = 34, top = 6;
  const plotW = W - left - right;
  const H = top + rowH * SUBJECT_KEYS.length + 18;
  return (
    <figure className="ms-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="教科ごとの得点と平均点">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={left + plotW * t} x2={left + plotW * t} y1={top} y2={top + rowH * SUBJECT_KEYS.length} className="ms-gl" />
            <text x={left + plotW * t} y={H - 4} className="ms-axis" textAnchor="middle">{Math.round(t * 100)}%</text>
          </g>
        ))}
        {SUBJECT_KEYS.map((k, i) => {
          const max = subjectMax(stats.exam, k) || 100;
          const v = row.sub[k];
          const mean = stats.overall.sub[k]?.mean;
          const y = top + rowH * i;
          const bw = v == null ? 0 : (plotW * v) / max;
          const barH = 14;
          return (
            <g key={k}>
              <text x={left - 8} y={y + rowH / 2 + 4} className="ms-axis-label" textAnchor="end">{SUBJECT_NAMES[k]}</text>
              {v != null && bw > 0 && (
                <path className="ms-bar-fill" d={barPath(left, y + (rowH - barH) / 2, bw, barH)}>
                  <title>{`${SUBJECT_NAMES[k]}：${v}点／${max}点（平均 ${fmt1(mean)}点）`}</title>
                </path>
              )}
              {mean != null && (
                <line className="ms-ref" x1={left + (plotW * mean) / max} x2={left + (plotW * mean) / max} y1={y + 3} y2={y + rowH - 3}>
                  <title>{`${SUBJECT_NAMES[k]}の平均：${fmt1(mean)}点`}</title>
                </line>
              )}
              {/* 値は棒の先か平均の線の、右にあるほうのさらに右に置く（線と重ならないように） */}
              <text x={left + Math.max(bw, mean == null ? 0 : (plotW * mean) / max) + 5} y={y + rowH / 2 + 4} className="ms-value">{v == null ? '未受験' : v}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="ms-legend">
        <span><i className="ms-key-bar" />得点</span>
        <span><i className="ms-key-ref" />平均点（智翔館の受験者）</span>
      </figcaption>
    </figure>
  );
}

// 右端だけ角を丸めた横棒（左＝0点の側は四角のまま）
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h / 2);
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}

/** 得点率の細い棒（0〜100%）と平均の縦線。表のセルの中に置く。 */
export function RateBar({ rate, mean, title }: { rate: number; mean: number; title: string }) {
  const W = 100, H = 12;
  return (
    <svg className="ms-ratebar" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={title}>
      <title>{title}</title>
      <rect x={0} y={3} width={W} height={6} rx={3} className="ms-track" />
      {rate > 0 && <path className="ms-bar-fill" d={barPath(0, 3, Math.max(2, W * Math.min(1, rate)), 6)} />}
      <line x1={W * Math.min(1, mean)} x2={W * Math.min(1, mean)} y1={0} y2={H} className="ms-ref" />
    </svg>
  );
}

/** 偏差値（5教科）の推移。1系列なので凡例は置かず、見出しで示す。 */
export function TrendChart({ history }: { history: HistoryPoint[] }) {
  const pts = history.filter((h) => h.row.dev != null);
  if (pts.length < 2) return null;
  const W = 240, H = 100, left = 26, right = 30, top = 10, bottom = 22;
  const devs = pts.map((p) => p.row.dev as number);
  const lo = Math.floor(Math.min(40, ...devs) / 5) * 5;
  const hi = Math.ceil(Math.max(60, ...devs) / 5) * 5;
  const x = (i: number) => left + ((W - left - right) * i) / (pts.length - 1);
  const y = (d: number) => top + ((H - top - bottom) * (hi - d)) / (hi - lo);
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += 10) ticks.push(t);
  const last = pts[pts.length - 1];
  return (
    <figure className="ms-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="偏差値の推移">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className={t === 50 ? 'ms-gl ms-gl-50' : 'ms-gl'} />
            <text x={left - 5} y={y(t) + 3} className="ms-axis" textAnchor="end">{t}</text>
          </g>
        ))}
        <polyline className="ms-line" points={pts.map((p, i) => `${x(i)},${y(p.row.dev as number)}`).join(' ')} />
        {pts.map((p, i) => (
          <g key={p.exam.id}>
            <circle cx={x(i)} cy={y(p.row.dev as number)} r={4} className="ms-dot">
              <title>{`${p.exam.name}：偏差値 ${fmt1(p.row.dev)}・${p.row.total}点・${p.row.rank}位／${p.n}人`}</title>
            </circle>
            <text x={x(i)} y={H - 8} className="ms-axis" textAnchor="middle">{shortExamName(p.exam)}</text>
          </g>
        ))}
        <text x={x(pts.length - 1) + 7} y={y(last.row.dev as number) + 4} className="ms-value">{fmt1(last.row.dev)}</text>
      </svg>
    </figure>
  );
}

/** 「2026 本番レベル模試 11月」→「11月」、日付があれば「11/22」。 */
export function shortExamName(e: MoshiExam): string {
  const m = /(\d{1,2}月)/.exec(e.name);
  if (m) return m[1];
  return e.date ? e.date.slice(5).replace('-', '/') : e.name.slice(0, 6);
}

// ---- 個人成績表（印刷・面談の画面で共通） -------------------------------------

export function ReportCard({
  stats, row, history, campusStats = true,
}: { stats: ExamStats; row: RowStat; history: HistoryPoint[]; campusStats?: boolean }) {
  const { exam } = stats;
  const r = row.r;
  const campusN = stats.rows.filter((x) => x.r.campus === r.campus && x.total != null).length;
  const pts = useMemo(() => topicPoints(stats, row), [stats, row]);
  const sw = useMemo(() => strengthsAndWeaknesses(pts), [pts]);
  const choices = useMemo(() => choiceRanks(stats, row), [stats, row]);
  const cs = stats.byCampus[r.campus];
  const leftKeys = SUBJECT_KEYS.slice(0, 3);
  const rightKeys = SUBJECT_KEYS.slice(3);
  return (
    <article className="ms-card">
      <header className="ms-card-head">
        <div>
          <div className="ms-card-title">{exam.name}　個人成績表</div>
          <div className="ms-card-sub">{exam.grade}{exam.date && `　実施日 ${jpDate(exam.date)}`}</div>
        </div>
        <div className="ms-card-who">
          <div>智翔館 {campusInfo(r.campus)?.label ?? r.campus}　受験番号 {r.examNo || '—'}</div>
          <div className="ms-card-name">{r.name || '（氏名未入力）'} さん</div>
        </div>
      </header>

      <section className="ms-kpis">
        <div><span>5教科合計</span><b>{row.total ?? '—'}</b><small>／{examMax(exam)}点</small></div>
        <div><span>偏差値</span><b>{fmt1(row.dev)}</b></div>
        <div><span>順位（智翔館内）</span><b>{row.rank ?? '—'}</b><small>位／{stats.complete}人</small></div>
        {campusStats && <div><span>校舎内順位</span><b>{row.campusRank ?? '—'}</b><small>位／{campusN}人</small></div>}
      </section>
      {row.total == null && <p className="ms-card-note">5教科すべての得点がそろっていないため、合計の順位・偏差値は出していません。</p>}

      <section className="ms-card-row">
        <table className="ms-table ms-subj">
          <thead>
            <tr><th>教科</th><th>得点</th><th>平均点</th><th>偏差値</th><th>順位</th>{campusStats && <th>校舎平均</th>}</tr>
          </thead>
          <tbody>
            {SUBJECT_KEYS.map((k) => (
              <tr key={k}>
                <th>{SUBJECT_NAMES[k]}</th>
                <td className="num"><b>{row.sub[k] ?? '—'}</b><small>／{subjectMax(exam, k)}</small></td>
                <td className="num">{fmt1(stats.overall.sub[k]?.mean)}</td>
                <td className="num">{fmt1(row.subDev[k])}</td>
                <td className="num">{row.subRank[k] == null ? '—' : `${row.subRank[k]}／${stats.overall.sub[k]?.n ?? 0}`}</td>
                {campusStats && <td className="num">{fmt1(cs?.sub[k]?.mean)}</td>}
              </tr>
            ))}
            <tr className="ms-sum">
              <th>合計</th>
              <td className="num"><b>{row.total ?? '—'}</b><small>／{examMax(exam)}</small></td>
              <td className="num">{fmt1(stats.overall.total?.mean)}</td>
              <td className="num">{fmt1(row.dev)}</td>
              <td className="num">{row.rank == null ? '—' : `${row.rank}／${stats.complete}`}</td>
              {campusStats && <td className="num">{fmt1(cs?.total?.mean)}</td>}
            </tr>
          </tbody>
        </table>
        <SubjectBars stats={stats} row={row} />
      </section>

      <section>
        <h3 className="ms-card-h">大問別の得点（出題分野）</h3>
        <div className="ms-topics">
          {[leftKeys, rightKeys].map((keys, ci) => (
            <table key={ci} className="ms-table ms-topic">
              <thead><tr><th>教科</th><th>分野</th><th>得点</th><th>得点率（｜は平均）</th></tr></thead>
              <tbody>
                {keys.map((k) => subjectOf(exam, k).questions.map((q, i) => {
                  const taken = row.sub[k] != null;
                  const score = r.scores[k]?.[i];
                  const meanRate = (stats.overall.questionMean[k][i] ?? 0) / q.max;
                  const rate = (score ?? 0) / q.max;
                  return (
                    <tr key={`${k}${i}`} className={i === 0 ? 'ms-topic-first' : ''}>
                      {i === 0 && <th rowSpan={subjectOf(exam, k).questions.length}>{SUBJECT_NAMES[k]}</th>}
                      <td className="ms-topic-name">{i + 1}. {q.topic || `大問${i + 1}`}</td>
                      <td className="num">{taken ? `${score ?? 0}／${q.max}` : '—'}</td>
                      <td className="ms-topic-bar">
                        {taken ? <><RateBar rate={rate} mean={meanRate} title={`得点率 ${pct(rate)}・平均 ${pct(meanRate)}`} /><span>{pct(rate)}</span></> : '—'}
                      </td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          ))}
        </div>
      </section>

      <section className="ms-card-row ms-card-row-2">
        <div>
          <h3 className="ms-card-h">平均と比べて</h3>
          <dl className="ms-sw">
            <dt>よくできた分野</dt>
            <dd>{sw.strong.length ? sw.strong.map((p) => <span key={`${p.key}${p.index}`}>{SUBJECT_NAMES[p.key]}「{p.topic}」<small>平均より +{Math.round(p.diff * 100)}ポイント</small></span>) : <span className="ms-muted">平均を上回った分野はありません</span>}</dd>
            <dt>伸ばしたい分野</dt>
            <dd>{sw.weak.length ? sw.weak.map((p) => <span key={`${p.key}${p.index}`}>{SUBJECT_NAMES[p.key]}「{p.topic}」<small>平均より {Math.round(p.diff * 100)}ポイント</small></span>) : <span className="ms-muted">平均を下回った分野はありません</span>}</dd>
          </dl>
        </div>
        <div>
          <h3 className="ms-card-h">志望校</h3>
          <table className="ms-table ms-choice">
            <thead><tr><th></th><th>学校</th><th>第一志望者内</th><th>志望者内</th></tr></thead>
            <tbody>
              {choices.map((c, i) => (
                <tr key={i}>
                  <th>第{['一', '二', '三', '四'][i]}</th>
                  <td>{schoolName(c.choice) || <span className="ms-muted">—</span>}</td>
                  <td className="num">{c.first ? `${c.first.rank}位／${c.first.n}人` : '—'}</td>
                  <td className="num">{c.any ? `${c.any.rank}位／${c.any.n}人` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ms-fine">志望者内＝この学校を第一〜第四志望のどこかに書いた、5教科を受けた人の中での順位。</p>
        </div>
      </section>

      <section className="ms-card-row ms-card-row-2 ms-card-last">
        <div>
          <h3 className="ms-card-h">これまでの結果</h3>
          {history.length >= 2 ? (
            <div className="ms-hist-wrap">
              <TrendChart history={history} />
              <table className="ms-table ms-hist">
                <thead><tr><th>回</th><th>合計</th><th>偏差値</th><th>順位</th></tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.exam.id} className={h.exam.id === exam.id ? 'ms-cur' : ''}>
                      <td title={h.exam.name}>{shortExamName(h.exam)}</td>
                      <td className="num">{h.row.total ?? '—'}</td>
                      <td className="num">{fmt1(h.row.dev)}</td>
                      <td className="num">{h.row.rank == null ? '—' : `${h.row.rank}／${h.n}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="ms-muted ms-fine">前の回の記録がありません（2回目から推移が出ます）。</p>}
        </div>
        <div>
          <h3 className="ms-card-h">先生から</h3>
          <div className="ms-comment">{r.comment || ''}</div>
        </div>
      </section>
      <footer className="ms-card-foot">順位・偏差値・平均点は、この回を受けた智翔館の中3生（{stats.complete}人）の中でのものです。</footer>
    </article>
  );
}
