'use client';

// 本番レベル模試の面談画面（詳細）。県一斉模試の面談画面（components/MoshiKenDetail.tsx）と同じ形で、生徒1人の詳しい成績をタブで見せる。
//   成績一覧：今回の成績（得点・平均点・偏差値・偏差値グラフ・塾内順位、前回の得点と偏差値）／設問別得点／教科別レーダーチャート／教科別偏差値推移
//   志望校判定：第1〜第4志望の判定・仮想順位・前回（10月県一斉）の判定。選んだ学校の判定教科・判定得点・判定偏差値・判定ライン・あと何点
//   過去テスト一覧：県一斉模試と本番レベル模試の回（押すとその回に切り替わる）
//   成績表：印刷するのと同じ個人成績表（A4 横）
// 前回は、この回より前のいちばん新しい回（県一斉模試も含む。2026年11月なら10月の県一斉模試。lib/moshi/model.ts の prevRecordFor）。
// 回に過去の実施データ（同じ問題を県全体で受けたときの集計）を結んであれば、県内順位（推定）・県全体の得点の分布・設問別の県平均も出す。

import { useMemo, useState } from 'react';
import {
  SUBJECT_KEYS, SUBJECT_NAMES, campusInfo, choiceKey, choiceRanks, honbanFirstChoiceMean, judgeOf, reportFigures, studentHistory, subjectMax,
  subjectOf, trendRows,
  type ExamStats, type KenitsuResult, type PrevRecord, type RowStat,
} from '@/lib/moshi/model';
import { schoolName } from '@/lib/moshi/schools';
import { FitSheet, ReportSheet, f1 } from './MoshiReportSheet';
import { NowTable, ORDER, PastTable, RADAR_ORDER, RadarMulti, TabBar, TrendView } from './MoshiDetailParts';
import { PastDistView, pastOf, pastQuestionCells, pastRankText } from './MoshiPast';

type Tab = 'score' | 'judge' | 'past' | 'sheet';
type Sub = 'now' | 'q' | 'dist' | 'radar' | 'trend';

export function HonbanDetail({ stats, statsList, row, kenitsu, prev, onPick }: {
  stats: ExamStats; statsList: ExamStats[]; row: RowStat; kenitsu: KenitsuResult[]; prev: PrevRecord | null;
  onPick: (kind: 'honban' | 'ken', id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('score');
  const [sub, setSub] = useState<Sub>('now');
  const { exam } = stats;
  const r = row.r;
  const figs = useMemo(() => reportFigures(stats, row), [stats, row]);
  const outside = figs.some((f) => f.outside);
  const trend = useMemo(() => trendRows(statsList, exam, r, kenitsu), [statsList, exam, r, kenitsu]);
  const past = pastOf(exam);
  const cur: Sub = sub === 'dist' && !past ? 'now' : sub;
  const subs: [Sub, string][] = [['now', '今回の成績'], ['q', '設問別得点'], ...(past ? [['dist', '県全体の分布'] as [Sub, string]] : []), ['radar', '教科別レーダーチャート'], ['trend', '教科別偏差値推移']];
  return (
    <section className="kd">
      <div className="kd-head">
        <span>氏名：<b>{r.name || '（氏名なし）'}</b>（受験番号：{r.examNo}）</span>
        <span className="kd-sub">智翔館 {campusInfo(r.campus)?.label ?? r.campus}・{exam.name}{prev ? `・前回は${prev.name}` : ''}</span>
      </div>
      <TabBar<Tab> tabs={[['score', '成績一覧'], ['judge', '志望校判定'], ['past', '過去テスト一覧'], ['sheet', '成績表']]} value={tab} onChange={setTab} />
      {tab === 'score' && (
        <div className="kd-panel">
          <TabBar<Sub> sub tabs={subs} value={cur} onChange={setSub} />
          {cur === 'now' && (
            <>
              <h3 className="kd-h">今回の成績</h3>
              <NowTable
                meanHead={outside ? '県平均' : '平均点'} rankHead="順位（塾内）" prevHead={prev ? `前回（${prev.label}）` : undefined}
                insideHead={past ? '県内順位（推定）' : undefined}
                rows={ORDER.map((key) => {
                  const f = figs.find((x) => x.key === key)!;
                  return {
                    key, score: f.score, max: f.max, mean: f.mean, dev: f.dev,
                    rank: f.rank != null ? <><b>{f.rank}</b><small> 位 / {f.rankN}人中</small></> : '—',
                    inside: past ? (pastRankText(past, key, f.score, f.max) || '—') : undefined,
                    prevScore: prev?.stats[key]?.score ?? null, prevDev: prev?.stats[key]?.dev ?? null,
                  };
                })}
              />
              <p className="kd-note">
                {outside ? `平均点・偏差値は${exam.outside?.source || '県一斉模試'}の平均点・標準偏差で換算した参考値（県一斉模試の偏差値と同じものさし）。` : '平均点・偏差値は、この回を受けた智翔館の受験者の中でのもの。'}
                順位はこの回を受けた智翔館の中での順位。
                {past && `県内順位（推定）は、同じ問題を県全体で受けた人（${past.label}・全県）の得点の分布から出した目安。`}
                {prev && `前回は${prev.name}の${prev.kind === 'ken' ? '得点・偏差値（業者の値）' : '得点・偏差値'}。`}
              </p>
            </>
          )}
          {cur === 'q' && <QuestionTable stats={stats} row={row} />}
          {cur === 'dist' && past && (
            <PastDistView
              past={past}
              scores={Object.fromEntries(figs.map((f) => [f.key, f.score]))}
              maxes={Object.fromEntries(figs.map((f) => [f.key, f.max]))}
            />
          )}
          {cur === 'radar' && <HbRadar stats={stats} statsList={statsList} row={row} prev={prev} outside={outside} />}
          {cur === 'trend' && <TrendView trend={trend} />}
        </div>
      )}
      {tab === 'judge' && <div className="kd-panel"><HbJudge stats={stats} row={row} prev={prev} /></div>}
      {tab === 'past' && <div className="kd-panel"><PastTable entries={studentHistory(statsList, kenitsu, r, schoolName)} current={{ kind: 'honban', id: exam.id }} onPick={onPick} /></div>}
      {tab === 'sheet' && <div className="kd-panel ms-interview-card"><FitSheet max={1.6}><ReportSheet stats={stats} statsList={statsList} row={row} kenitsu={kenitsu} /></FitSheet></div>}
    </section>
  );
}

// ---- 設問別得点 -----------------------------------------------------------------

function QuestionTable({ stats, row }: { stats: ExamStats; row: RowStat }) {
  const { exam } = stats;
  const r = row.r;
  const past = pastOf(exam);
  const pq = pastQuestionCells(exam, past);
  return (
    <>
      <h3 className="kd-h">設問別得点</h3>
      <div className="kd-scroll">
        <table className="kd-table kd-q">
          <thead><tr><th>教科</th><th>大問</th><th>分野</th><th>配点</th><th>得点</th><th>得点率</th><th>塾平均</th>{pq && <th>県平均</th>}<th className="kd-qbar-h">得点率のグラフ（線は塾平均）</th></tr></thead>
          <tbody>
            {SUBJECT_KEYS.map((k) => {
              const qs = subjectOf(exam, k).questions;
              const taken = row.sub[k] != null;
              return qs.map((q, i) => {
                const score = r.scores[k]?.[i];
                const rate = taken ? (score ?? 0) / q.max : null;
                const mean = stats.overall.sub[k] ? (stats.overall.questionMean[k][i] ?? 0) / q.max : null;
                const low = rate != null && mean != null && rate < mean;
                return (
                  <tr key={`${k}${i}`} className={i === 0 ? 'kd-q-first' : ''}>
                    {i === 0 && <th rowSpan={qs.length}>{SUBJECT_NAMES[k]}<br /><small>{taken ? `${row.sub[k]}点 / ${subjectMax(exam, k)}点` : '未受験'}</small></th>}
                    <td className="num">{i + 1}</td>
                    <td>{q.topic || `大問${i + 1}`}</td>
                    <td className="num">{q.max}</td>
                    <td className="num"><b>{taken ? score ?? 0 : '—'}</b></td>
                    <td className={`num${low ? ' kd-low' : ''}`}>{rate == null ? '—' : `${Math.round(rate * 100)}%`}</td>
                    <td className="num">{mean == null ? '—' : `${Math.round(mean * 100)}%`}</td>
                    {pq && (() => {
                      const c = pq[k]?.[i];
                      if (c === 'skip') return null;
                      return <td className="num kd-ken-mean" rowSpan={c ? c.span : 1}>{c ? `${c.rate}%` : '—'}</td>;
                    })()}
                    <td className="kd-graph">
                      <div className="kd-track kd-qtrack">
                        {rate != null && <div className="kd-bar" style={{ width: `${Math.round(rate * 100)}%`, background: low ? '#e0675a' : '#5b9bd5' }} />}
                        {mean != null && <b className="kd-prev" style={{ left: `${Math.round(mean * 100)}%` }} />}
                      </div>
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      <p className="kd-note">
        得点率が塾平均より低い大問は赤。塾平均は、この回を受けた智翔館の受験者の得点率の平均です。
        {pq && `県平均は、同じ問題を県全体で受けた人（${past!.label}）の得点率の平均（大問の配点が合う教科だけ。2つの大問で1つの値のところもあります）。`}
      </p>
    </>
  );
}

// ---- 教科別レーダーチャート ---------------------------------------------------------

function HbRadar({ stats, statsList, row, prev, outside }: { stats: ExamStats; statsList: ExamStats[]; row: RowStat; prev: PrevRecord | null; outside: boolean }) {
  const { exam } = stats;
  const figs = reportFigures(stats, row);
  const opts = row.r.choices.map((c, i) => ({ c, i })).filter((x) => x.c);
  const [pick, setPick] = useState(0);
  const cur = opts[Math.min(pick, Math.max(0, opts.length - 1))];
  const fc = useMemo(() => honbanFirstChoiceMean(stats, cur?.c ?? ''), [stats, cur]);
  const max = (k: (typeof RADAR_ORDER)[number]) => subjectMax(exam, k) || 100;
  const prevMax = (k: (typeof RADAR_ORDER)[number]) => {
    if (!prev || prev.kind === 'ken') return 100;
    const pe = statsList.find((s) => s.exam.id === prev.id)?.exam;
    return pe ? subjectMax(pe, k) || 100 : 100;
  };
  const rate = (v: number | null | undefined, m: number) => (v == null ? null : (v / m) * 100);
  return (
    <>
      <h3 className="kd-h">教科別レーダーチャート</h3>
      <div className="kd-row">
        <label className="kd-select">
          <span>くらべる志望校</span>
          <select value={pick} onChange={(e) => setPick(Number(e.target.value))} disabled={!opts.length}>
            {opts.map((o, j) => <option key={o.i} value={j}>第{o.i + 1}志望 {schoolName(o.c)}</option>)}
            {!opts.length && <option>志望校の記入なし</option>}
          </select>
        </label>
        <span className="kd-muted">5教科の得点率（その教科の満点に対する割合）。凡例を押すと線の表示を切り替えられます。</span>
      </div>
      <RadarMulti series={[
        { id: 'me', label: 'あなたの得点率', color: '#3aa757', fill: 'rgba(58,167,87,.22)', vals: RADAR_ORDER.map((k) => rate(row.sub[k], max(k))) },
        { id: 'avg', label: `${outside ? '県平均' : '平均'}の得点率`, color: '#5bb6d9', fill: 'rgba(91,182,217,.16)', vals: RADAR_ORDER.map((k) => rate(figs.find((f) => f.key === k)?.mean, max(k))) },
        ...(prev ? [{ id: 'prev', label: `前回（${prev.label}）の得点率`, color: '#8a8f98', fill: 'rgba(138,143,152,.08)', vals: RADAR_ORDER.map((k) => rate(prev.stats[k]?.score, prevMax(k))) }] : []),
        ...(cur && fc.n ? [{ id: 'fc', label: `塾内の第1志望者の得点率（${fc.n}人）`, color: '#e58ad0', fill: 'rgba(229,138,208,.14)', vals: RADAR_ORDER.map((k) => rate(fc.mean[k], max(k))) }] : []),
      ]} />
      <p className="kd-note">第1志望者は、この学校を第1志望に書いた智翔館の生徒（この回）の平均です。前回は点線。</p>
    </>
  );
}

// ---- 志望校判定 -----------------------------------------------------------------

function HbJudge({ stats, row, prev }: { stats: ExamStats; row: RowStat; prev: PrevRecord | null }) {
  const opts = row.r.choices.map((c, i) => ({ c, i })).filter((x) => x.c);
  const [pick, setPick] = useState(0);
  const ranks = useMemo(() => choiceRanks(stats, row), [stats, row]);
  const cur = opts[Math.min(pick, Math.max(0, opts.length - 1))];
  if (!opts.length) return <p className="kd-muted">志望校の記入がありません（成績入力の名簿で入れられます）。</p>;
  const prevOf = (code: string) => prev?.choices?.find((x) => x.code && choiceKey(x.code) === choiceKey(code)) ?? null;
  const j = judgeOf(stats, row, cur.c);
  const pc = prevOf(cur.c);
  const cr = ranks[cur.i];
  return (
    <div className="kd-judge">
      <div>
        <h3 className="kd-h">志望校判定</h3>
        <p className="kd-muted">確かめたい志望校を押してください。{prev?.kind === 'ken' && `右の列は前回（${prev.name}）の判定です。`}</p>
        <table className="kd-table kd-jlist">
          <thead><tr><th>区分</th><th>学校コード</th><th>学校名</th><th>判定</th><th>仮想順位</th>{prev?.kind === 'ken' && <th>前回（{prev.label}）</th>}</tr></thead>
          <tbody>
            {opts.map((o, n) => {
              const jj = judgeOf(stats, row, o.c);
              const p = prevOf(o.c);
              return (
                <tr key={o.i} className={cur.i === o.i ? 'on' : ''}>
                  <td><button type="button" className={cur.i === o.i ? 'kd-pill on' : 'kd-pill'} onClick={() => setPick(n)}>第{o.i + 1}志望</button></td>
                  <td className="num">{/^\d{3}-\d{2}$/.test(o.c) ? o.c : ''}</td>
                  <td>{schoolName(o.c)}</td>
                  <td className="kd-grade">{jj.grade ?? '—'}</td>
                  <td className="num">{jj.rank ? `${jj.rank.rank}位 / ${jj.rank.capacity}人` : '—'}</td>
                  {prev?.kind === 'ken' && <td className="kd-center">{p ? <><b>{p.judge}</b> {p.prob}</> : '—'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="kd-h kd-h-blue">志望校情報</h3>
        <table className="kd-table kd-info">
          <tbody>
            <tr><th colSpan={2}>学校名</th><th>判定教科</th></tr>
            <tr><td colSpan={2} className="kd-center">{schoolName(cur.c)}</td><td className="kd-center">{j.line?.rule || '—'}</td></tr>
            <tr><th>判定得点</th><th>判定偏差値</th><th>基準偏差値（B判定）</th></tr>
            <tr>
              <td className="kd-center">{j.score != null ? <><b>{Math.round(j.score * 10) / 10}</b> 点 / {j.max} 点</> : '—'}</td>
              <td className="kd-center"><b>{j.dev != null ? f1(j.dev) : '—'}</b></td>
              <td className="kd-center"><b>{j.line?.bDev != null ? f1(j.line.bDev) : '—'}</b></td>
            </tr>
            <tr><th>仮想順位（入学後のおよその順位）</th><th>塾内の志望者の中の順位</th><th>前回（{prev?.label ?? '—'}）</th></tr>
            <tr>
              <td className="kd-center">{j.rank ? <><b>{j.rank.rank}</b> 位 / {j.rank.capacity} 人中</> : '—'}</td>
              <td className="kd-center">{cr?.any ? <><b>{cr.any.rank}</b> 位 / {cr.any.n} 人中</> : '—'}</td>
              <td className="kd-center">{pc ? <><b>{pc.judge}</b> 判定・{pc.prob}</> : '—'}</td>
            </tr>
          </tbody>
        </table>
        <p className="kd-big">あなたの今回の判定は <b>{j.grade ?? '—'}判定</b> です。</p>
        {pc && <p className="kd-big kd-big-sm">前回（{prev!.name}）は <b>{pc.judge}判定</b>・合格確率 <b>{pc.prob}</b> でした。</p>}
        {j.lines && (
          <table className="kd-table kd-next">
            <thead><tr><th>判定ライン（判定得点）</th><th>A</th><th>B</th><th>C</th><th>D</th></tr></thead>
            <tbody>
              <tr><th>この点以上</th>{(['A', 'B', 'C', 'D'] as const).map((g) => <td key={g} className={`kd-center${j.grade === g ? ' kd-cur' : ''}`}>{j.lines![g]}</td>)}</tr>
              <tr><th>次の判定まで</th><td colSpan={4} className="kd-center">{j.next ? <>あと <b>{j.next.gap}</b> 点で {j.next.grade} 判定</> : j.grade === 'A' ? 'いちばん上の判定です' : '—'}</td></tr>
            </tbody>
          </table>
        )}
        <p className="kd-note">
          判定は{stats.exam.outside?.source ? `${stats.exam.outside.source}の` : ''}志望校別判定基準（B判定基準）による目安（判定のあいだは偏差値 {stats.exam.judgeOptions?.step ?? 3} ずつ）。
          仮想順位は「模試の設定」で定員を入れた学校だけ。塾内の志望者は、この学校を4つの志望校のどれかに書いた智翔館の受験者。
          {pc && '前回の判定・合格確率は県一斉模試の集計（業者）の値。'}
        </p>
      </div>
    </div>
  );
}
