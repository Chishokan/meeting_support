'use client';

// 本番レベル模試の個人成績表（A4 横1枚）。元の帳票「公立高校・高専本番レベル模試」と同じ並びにしている。
//   左：表題・受験番号・氏名・所属 ／ 得点表（国英数社理・三教科・五教科 × 得点・平均点・偏差値・順位・母数）／ 志望校判定（第1〜第4）
//   中：得点の分布 ／ 教科のバランス ／ 設問別得点
//   右：教科別偏差値推移（表とグラフ） ／ 偏差値の分布 ／ 前回との比較（前回＝この回より前のいちばん新しい回。11月なら10月の県一斉模試）／ 成績のポイント
//   （「先生から」の欄は置かない。県一斉模試の成績表と同じ）
// 回に過去の実施データ（同じ問題を県全体で受けたときの集計。lib/moshi/pastData.ts）を結んであれば、得点表に「県内順位(推定)」、
// 得点の分布は県全体の分布、設問別得点に「県平均」を出す（components/MoshiPast.tsx）。
// 印刷も画面（成績表の画面・面談の画面）もこの1つを使う。画面では FitSheet で幅に合わせて縮める。
// 数字の計算は lib/moshi/model.ts（reportFigures・judgeOf・scoreBins・devBins・trendRows）。

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  SUBJECT_KEYS, SUBJECT_NAMES, STAT_KEYS, STAT_NAMES, campusInfo, choiceKey, choiceRanks, devBins, judgeOf, pointsOf, prevRecordFor, reportFigures,
  scoreBins, subjectMax, subjectOf, trendRows,
  type Bin, type ExamStats, type KenitsuResult, type MoshiExam, type RowStat, type StatKey, type TrendRow,
} from '@/lib/moshi/model';
import { schoolName } from '@/lib/moshi/schools';
import { pastN, pastRank } from '@/lib/moshi/pastData';
import { pastDistBins, pastOf, pastQuestionCells, pastWhen } from './MoshiPast';

// 表題（元の帳票と同じ）。回の名前は右上の年月で示す。
export const REPORT_TITLE = '公立高校・高専本番レベル模試';

// 偏差値推移の線の色と印（国語から順に、カテゴリの色を決まった順で使う。印の形も変えて、色だけに頼らない）。
// 五教科はまとめの線なので、濃い色で太くする。
const SERIES: { key: StatKey; color: string; mark: 'circle' | 'diamond' | 'triangle' | 'square' | 'tri-down' | 'star' }[] = [
  { key: 'ja', color: '#2a78d6', mark: 'circle' },
  { key: 'en', color: '#eb6834', mark: 'diamond' },
  { key: 'ma', color: '#1baf7a', mark: 'triangle' },
  { key: 'so', color: '#eda100', mark: 'square' },
  { key: 'sc', color: '#e87ba4', mark: 'tri-down' },
  { key: 'k5', color: '#1f2329', mark: 'star' },
];

export function f1(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '' : (Math.round(n * 10) / 10).toFixed(1);
}

function ym(e: MoshiExam): string {
  const m = /^(\d{4})-(\d{2})/.exec(e.date || '');
  return m ? `${m[1]}.${m[2]}` : '';
}

// ---- 画面で幅に合わせる ------------------------------------------------------

/** 帳票（A4 横・mm で組んである）を、置き場所の幅に合わせて縮める（印刷では縮めない）。 */
export function FitSheet({ children, max = 1.35 }: { children: ReactNode; max?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // 帳票の幅は mm で決まっている（281mm＋画面での余白 6mm×2）。px にして置き場所の幅との比で縮める
    const natural = (293 * 96) / 25.4;
    const measure = () => { if (el.clientWidth) setZoom(Math.min(max, el.clientWidth / natural)); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [max]);
  return (
    <div className="rs-fit" ref={box}>
      <div className="rs-fit-inner" style={{ zoom }}>{children}</div>
    </div>
  );
}

// ---- 帳票 ------------------------------------------------------------------

export function ReportSheet({ stats, statsList, row, kenitsu = [] }: { stats: ExamStats; statsList: ExamStats[]; row: RowStat; kenitsu?: KenitsuResult[] }) {
  const { exam } = stats;
  const r = row.r;
  const figs = useMemo(() => reportFigures(stats, row), [stats, row]);
  const ranks = useMemo(() => choiceRanks(stats, row), [stats, row]);
  const trend = useMemo(() => trendRows(statsList, exam, r, kenitsu), [statsList, exam, r, kenitsu]);
  const hasKen = trend.some((t) => t.kind === 'ken');
  const anyOutside = figs.some((f) => f.outside);
  const k5 = figs.find((f) => f.key === 'k5')!;
  // 前回（この回より前のいちばん新しい回。11月なら10月の県一斉模試）
  const prev = useMemo(() => prevRecordFor(statsList, kenitsu, exam, r), [statsList, kenitsu, exam, r]);
  const now = Object.fromEntries(figs.map((f) => [f.key, { score: f.score, dev: f.dev }]));
  const points = pointsOf(now, prev?.stats ?? null, k5.mean);
  const first = r.choices.map((c, i) => ({ c, i })).find((x) => x.c) ?? null;
  const firstJudge = first ? judgeOf(stats, row, first.c) : null;
  const past = pastOf(exam);
  const pq = useMemo(() => pastQuestionCells(exam, past), [exam, past]);

  return (
    <article className="rs-sheet">
      {/* ---- 左 ---- */}
      <section className="rs-col">
        <header className="rs-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="rs-logo" src="/moshi/logo.png" alt="智翔館" />
          <div className="rs-title">{REPORT_TITLE}</div>
        </header>
        <div className="rs-ym">{ym(exam) || exam.name}</div>
        <dl className="rs-info">
          <dt>受験番号</dt><dd>{r.examNo}</dd>
          <dt>氏名</dt><dd className="rs-name">{r.name}</dd>
          <dt>所属</dt><dd>智翔館 {campusInfo(r.campus)?.label ?? r.campus}</dd>
        </dl>

        <table className="rs-score">
          <thead>
            <tr><th>本番レベル模試</th>{STAT_KEYS.map((k) => <th key={k}>{STAT_NAMES[k]}</th>)}</tr>
          </thead>
          <tbody>
            <tr><th>得点</th>{figs.map((f) => <td key={f.key}>{f.score ?? ''}</td>)}</tr>
            <tr><th>平均点</th>{figs.map((f) => <td key={f.key}>{f1(f.mean)}</td>)}</tr>
            <tr><th>偏差値</th>{figs.map((f) => <td key={f.key}>{f1(f.dev)}</td>)}</tr>
            <tr><th>{anyOutside ? '順位(塾内)' : '順位'}</th>{figs.map((f) => <td key={f.key}>{f.rank == null ? '' : anyOutside ? `${f.rank}/${f.rankN}` : f.rank}</td>)}</tr>
            {past && <tr><th>県内順位(推定)</th>{figs.map((f) => <td key={f.key}>{pastRank(past, f.key, f.score, f.max)?.rank ?? ''}</td>)}</tr>}
            <tr><th>母数</th>{figs.map((f) => <td key={f.key}>{(past ? pastN(past, f.key) : f.n) || ''}</td>)}</tr>
          </tbody>
        </table>

        <div className="rs-pill rs-pill-green">志望校判定</div>
        {[0, 1, 2, 3].map((i) => {
          const choice = r.choices[i] ?? '';
          const j = judgeOf(stats, row, choice);
          const cr = ranks[i];
          return (
            <div key={i} className="rs-judge">
              <div className="rs-j-head">
                <span>第{i + 1}志望</span>
                <b>{/^\d{3}-\d{2}$|^\d{5}$/.test(choice) ? choice : ''}</b>
                <span>{schoolName(choice)}</span>
                {j.line?.rule && <span className="rs-j-rule">判定教科：{j.line.rule}</span>}
              </div>
              <table className="rs-j-table">
                <tbody>
                  <tr>
                    <th>仮想順位</th>
                    <td>{j.rank ? `${j.rank.rank}位` : ''}</td>
                    <td>{j.rank ? `${j.rank.capacity}人中` : ''}</td>
                    <th className="rs-j-g">A</th><th className="rs-j-g">B</th><th className="rs-j-g">C</th><th className="rs-j-g">D</th>
                  </tr>
                  <tr>
                    <th>判定用得点</th>
                    <td>{j.score ?? ''}</td>
                    <td>{j.max ? `／${j.max}` : ''}</td>
                    {(['A', 'B', 'C', 'D'] as const).map((g) => <td key={g}>{j.lines?.[g] ?? ''}</td>)}
                  </tr>
                </tbody>
              </table>
              <div className="rs-j-grade">
                <span>判定</span><span className="rs-j-box">{j.grade ?? ''}</span>
                {(() => {
                  const pc = choice && prev?.choices?.find((x) => x.code && choiceKey(x.code) === choiceKey(choice));
                  return pc ? <span className="rs-j-prev">{prev!.label} {pc.judge}{pc.prob ? `（${pc.prob}）` : ''}</span> : null;
                })()}
                {cr?.any && <span className="rs-j-inside">塾内の志望者 {cr.any.n}人中 {cr.any.rank}位</span>}
              </div>
              <div className="rs-j-next">
                <span>次の判定まであと何点</span>
                <span>
                  {j.next
                    ? <>あと <b>{j.next.gap}</b> 点で次の判定（{j.next.grade}）にアップします</>
                    : j.grade === 'A' ? 'いちばん上の判定です' : <>あと<span className="rs-blank" />点で次の判定にアップします</>}
                </span>
              </div>
            </div>
          );
        })}
      </section>

      {/* ---- 中 ---- */}
      <section className="rs-col">
        <div className="rs-pill rs-pill-orange">得点の分布{past && <small className="rs-pill-note">県全体（{pastWhen(past)}実施・{pastN(past, 'k5')}人）</small>}</div>
        {past
          ? <ScoreDist bins={pastDistBins(past, 'k5', k5.score)} label="五教科の県全体の得点の分布" />
          : <ScoreDist bins={scoreBins(stats, row)} />}
        <div className="rs-pill rs-pill-blue">教科のバランス</div>
        <Balance stats={stats} row={row} />
        <table className="rs-q">
          <colgroup><col className="rs-q-c1" /><col /><col className="rs-q-c3" /><col className="rs-q-c3" /><col className="rs-q-c5" /><col className="rs-q-c6" />{pq && <col className="rs-q-c6" />}</colgroup>
          <thead><tr><th colSpan={2} className="rs-q-title">設問別得点</th><th>配点</th><th>得点</th><th>得点率</th><th>{anyOutside ? '塾平均' : '平均'}</th>{pq && <th>県平均</th>}</tr></thead>
          <tbody>
            {SUBJECT_KEYS.map((k) => subjectOf(exam, k).questions.map((q, i) => {
              const taken = row.sub[k] != null;
              const score = r.scores[k]?.[i];
              const rate = taken ? (score ?? 0) / q.max : null;
              const mean = (stats.overall.questionMean[k][i] ?? 0) / q.max;
              const n = subjectOf(exam, k).questions.length;
              return (
                <tr key={`${k}${i}`} className={i === 0 ? 'rs-q-first' : ''}>
                  {i === 0 && <th rowSpan={n}>{SUBJECT_NAMES[k]}</th>}
                  <td className="rs-q-topic">{i + 1}.{q.topic || `大問${i + 1}`}</td>
                  <td>{q.max}</td>
                  <td>{taken ? score ?? 0 : ''}</td>
                  <td className={`rs-q-rate${rate != null && rate < mean ? ' low' : ''}`}>{rate == null ? '' : `${Math.round(rate * 100)}%`}</td>
                  <td>{stats.overall.sub[k] ? `${Math.round(mean * 100)}%` : ''}</td>
                  {pq && (() => {
                    const c = pq[k]?.[i];
                    if (c === 'skip') return null;
                    return <td rowSpan={c ? c.span : 1}>{c ? `${c.rate}%` : ''}</td>;
                  })()}
                </tr>
              );
            }))}
          </tbody>
        </table>
      </section>

      {/* ---- 右 ---- */}
      <section className="rs-col">
        <div className="rs-h">教科別偏差値推移{hasKen && <small className="rs-h-note">県＝長崎県一斉模試</small>}</div>
        <table className="rs-trend">
          <thead><tr><th></th>{STAT_KEYS.map((k) => <th key={k}>{k === 'k3' ? '3教科' : k === 'k5' ? '5教科' : STAT_NAMES[k]}</th>)}</tr></thead>
          <tbody>
            {padRows(trend, 4).map((t, i) => (
              <tr key={t?.key ?? `pad${i}`} className={`${t?.current ? 'rs-cur' : ''}${t?.kind === 'ken' ? ' rs-ken' : ''}`}>
                <th>{t ? trendLabel(t) : ''}</th>
                {STAT_KEYS.map((k) => <td key={k}>{t ? f1(t.dev[k]) : ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <TrendLines trend={trend} />
        <div className="rs-pill rs-pill-pink">偏差値の分布</div>
        <DevDist bins={devBins(stats, row)} />
        <div className="rs-h rs-h-sm">前回との比較{prev && <small className="rs-h-note">{prev.name}</small>}</div>
        {prev ? (
          <table className="rs-cmp rs-cmp-sm">
            <thead><tr><th></th>{STAT_KEYS.map((k) => <th key={k}>{k === 'k3' ? '3教科' : k === 'k5' ? '5教科' : STAT_NAMES[k]}</th>)}</tr></thead>
            <tbody>
              <tr><th>得点（{prev.label}）</th>{STAT_KEYS.map((k) => <td key={k}>{prev.stats[k]?.score ?? ''}</td>)}</tr>
              <tr><th>得点（今回）</th>{figs.map((f) => <td key={f.key}>{f.score ?? ''}</td>)}</tr>
              <tr><th>偏差値（{prev.label}）</th>{STAT_KEYS.map((k) => <td key={k}>{f1(prev.stats[k]?.dev)}</td>)}</tr>
              <tr><th>偏差値（今回）</th>{figs.map((f) => <td key={f.key}>{f1(f.dev)}</td>)}</tr>
              <tr className="rs-cmp-diff"><th>偏差値の差</th>{figs.map((f) => {
                const a = prev.stats[f.key]?.dev;
                const d = a == null || f.dev == null ? null : Math.round((f.dev - a) * 10) / 10;
                return <td key={f.key} className={d == null ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}>{d == null ? '' : d === 0 ? '±0.0' : `${d > 0 ? '+' : ''}${d.toFixed(1)}`}</td>;
              })}</tr>
            </tbody>
          </table>
        ) : <p className="rs-cmp-none">これより前の回（県一斉模試・本番レベル模試）の成績はありません。</p>}
        <div className="rs-pill rs-pill-green">成績のポイント</div>
        <ul className="rs-points rs-points-sm">
          {points.strong.length > 0 && <li><b>得意な教科</b>{points.strong.map((x) => `${SUBJECT_NAMES[x.key]} ${f1(x.dev)}`).join('・')}</li>}
          {points.weak.length > 0 && <li><b>のばしたい教科</b>{points.weak.map((x) => `${SUBJECT_NAMES[x.key]} ${f1(x.dev)}`).join('・')}</li>}
          {prev && <li><b>{prev.label}から上がった</b>{points.up.length ? points.up.map((x) => `${SUBJECT_NAMES[x.key]} +${x.diff.toFixed(1)}`).join('・') : 'なし（＋1.0 以上）'}</li>}
          {prev && <li><b>{prev.label}から下がった</b>{points.down.length ? points.down.map((x) => `${SUBJECT_NAMES[x.key]} ${x.diff.toFixed(1)}`).join('・') : 'なし（−1.0 以下）'}</li>}
          {points.vsMean != null && <li><b>5教科と{anyOutside ? '県平均' : '平均'}</b>{points.vsMean >= 0 ? `${anyOutside ? '県平均' : '平均'}より ${points.vsMean.toFixed(1)}点 上` : `${anyOutside ? '県平均' : '平均'}まで あと ${(-points.vsMean).toFixed(1)}点`}</li>}
          {first && firstJudge?.grade && <li><b>第{first.i + 1}志望まで</b>{schoolName(first.c)}：{firstJudge.next ? `次の判定（${firstJudge.next.grade}）まで あと ${firstJudge.next.gap}点` : 'いちばん上の判定です'}</li>}
        </ul>
      </section>

      <footer className="rs-foot">
        {anyOutside
          ? `平均点・偏差値は${exam.outside?.source || '県全体の模試'}の平均点・標準偏差で換算した参考値（偏差値は25.0〜75.0）。${past ? '順位(塾内)・設問別の塾平均' : '順位・設問別の平均・得点の分布'}は智翔館の受験者（五教科 ${k5.rankN}人）。`
          : `平均点・偏差値・母数・分布は、この回を受けた智翔館の中3生の中でのもの（五教科 ${k5.n}人）。`}
        {(exam.judges ?? []).length > 0 && `判定は${exam.outside?.source ? `${exam.outside.source}の` : ''}志望校別判定基準（B判定基準）による目安。仮想順位は定員の中での入学後のおよその順位。`}
        得点率が平均より低い設問は赤字。{prev && `前回は${prev.name}（${prev.kind === 'ken' ? '県一斉模試の得点・偏差値' : '本番レベル模試'}）。`}
        {past && `県内順位(推定)・得点の分布・設問別の県平均は、同じ問題を${pastWhen(past)}に県全体で受けた${pastN(past, 'k5')}人（${past.label}）の集計による目安。`}
      </footer>
    </article>
  );
}

/** 推移の行の名前：本番レベル模試は「11月」、県一斉模試は「10月県」。 */
export function trendLabel(t: TrendRow): string {
  return t.kind === 'ken' ? `${t.label}県` : t.label;
}

export function padRows(rows: TrendRow[], min: number): (TrendRow | null)[] {
  const out: (TrendRow | null)[] = [...rows];
  while (out.length < min) out.push(null);
  return out;
}

// ---- グラフ ----------------------------------------------------------------

/** 得点の分布（縦棒・高い点から）。自分の入る棒だけ濃くして「あなた」と書く。 */
export function ScoreDist({ bins, label = '五教科の得点の分布' }: { bins: Bin[]; label?: string }) {
  const W = 330, H = 150, left = 22, right = 4, top = 10, bottom = 44;
  const maxC = Math.max(1, ...bins.map((b) => b.count));
  const step = niceStep(maxC);
  const yMax = Math.ceil(maxC / step) * step;
  const pw = (W - left - right) / bins.length;
  const bw = Math.min(11, pw - 2);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / yMax);
  const ticks: number[] = [];
  for (let t = 0; t <= yMax; t += step) ticks.push(t);
  return (
    <svg className="rs-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className="rs-gl" />
          <text x={left - 3} y={y(t) + 3} className="rs-ax" textAnchor="end">{t}</text>
        </g>
      ))}
      {bins.map((b, i) => {
        const x = left + pw * i + (pw - bw) / 2;
        const h = y(0) - y(b.count);
        return (
          <g key={b.label}>
            {b.count > 0 && (
              <path className={b.mine ? 'rs-bar-mine' : 'rs-bar'} d={colPath(x, y(b.count), bw, h)}>
                <title>{`${b.label}点：${b.count}人${b.mine ? '（あなた）' : ''}`}</title>
              </path>
            )}
            {b.mine && <text x={x + bw / 2} y={y(b.count) - 3} className="rs-mine-label" textAnchor="middle">あなた</text>}
            <text className="rs-ax" transform={`translate(${x + bw / 2 + 3},${y(0) + 4}) rotate(-90)`} textAnchor="end">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** 上だけ角を丸めた縦棒（0 の側は四角のまま）。 */
function colPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(2.5, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function niceStep(max: number): number {
  const raw = max / 5;
  const p = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return Math.max(1, m * p);
  return 10 * p;
}

/** 教科のバランス（レーダー）：本人の得点（青）と平均点（灰色の点線）を、各教科の満点に対する割合で。 */
function Balance({ stats, row }: { stats: ExamStats; row: RowStat }) {
  const figs = reportFigures(stats, row);
  return (
    <Radar
      mine={SUBJECT_KEYS.map((k) => row.sub[k])}
      avg={SUBJECT_KEYS.map((k) => figs.find((f) => f.key === k)?.mean ?? null)}
      max={SUBJECT_KEYS.map((k) => subjectMax(stats.exam, k) || 100)}
    />
  );
}

/** 5教科のレーダー（国英数社理の順）。mine・avg は得点、max は満点。avgLabel は凡例の「平均」の言い方。 */
export function Radar({ mine: mineScores, avg: avgScores, max, avgLabel = '平均' }: {
  mine: (number | null)[]; avg: (number | null)[]; max: number[]; avgLabel?: string;
}) {
  const W = 330, H = 170, cx = 165, cy = 92, R = 66;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / SUBJECT_KEYS.length;
    return [cx + R * v * Math.cos(a), cy + R * v * Math.sin(a)];
  };
  const ratio = (i: number, v: number | null) => (v == null ? 0 : Math.max(0, Math.min(1, v / (max[i] || 100))));
  const mine = SUBJECT_KEYS.map((_, i) => pt(i, ratio(i, mineScores[i])));
  const avg = SUBJECT_KEYS.map((_, i) => pt(i, ratio(i, avgScores[i])));
  const poly = (ps: number[][]) => ps.map((p) => p.join(',')).join(' ');
  return (
    <svg className="rs-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="教科のバランス">
      <g className="rs-legend-svg">
        <line x1={8} x2={22} y1={10} y2={10} className="rs-radar-avg" />
        <text x={26} y={13}>{avgLabel}</text>
        <line x1={68} x2={82} y1={10} y2={10} className="rs-radar-mine-line" />
        <circle cx={75} cy={10} r={2.6} className="rs-radar-dot" />
        <text x={86} y={13}>あなたの得点</text>
      </g>
      {[0.2, 0.4, 0.6, 0.8, 1].map((t) => (
        <polygon key={t} points={poly(SUBJECT_KEYS.map((_, i) => pt(i, t)))} className="rs-gl rs-radar-ring" />
      ))}
      {SUBJECT_KEYS.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="rs-gl" />; })}
      {[20, 40, 60, 80].map((t) => <text key={t} x={cx + 2} y={cy - (R * t) / 100 + 3} className="rs-ax">{t}</text>)}
      <polygon points={poly(avg)} className="rs-radar-avg" />
      <polygon points={poly(mine)} className="rs-radar-mine" />
      {SUBJECT_KEYS.map((k, i) => (
        <circle key={k} cx={mine[i][0]} cy={mine[i][1]} r={2.6} className="rs-radar-dot">
          <title>{`${SUBJECT_NAMES[k]}：${mineScores[i] ?? '未受験'}点（${avgLabel} ${f1(avgScores[i])}点）`}</title>
        </circle>
      ))}
      {SUBJECT_KEYS.map((k, i) => {
        const [x, y] = pt(i, 1.17);
        return <text key={k} x={x} y={y + 3} className="rs-ax-label" textAnchor={Math.abs(x - cx) < 4 ? 'middle' : x > cx ? 'start' : 'end'}>{SUBJECT_NAMES[k]}</text>;
      })}
    </svg>
  );
}

function Mark({ kind, x, y, color }: { kind: (typeof SERIES)[number]['mark']; x: number; y: number; color: string }) {
  const s = 3.4;
  const common = { fill: color, stroke: '#fff', strokeWidth: 1 };
  switch (kind) {
    case 'circle': return <circle cx={x} cy={y} r={s} {...common} />;
    case 'square': return <rect x={x - s + 0.4} y={y - s + 0.4} width={2 * s - 0.8} height={2 * s - 0.8} {...common} />;
    case 'diamond': return <polygon points={`${x},${y - s - 0.6} ${x + s + 0.6},${y} ${x},${y + s + 0.6} ${x - s - 0.6},${y}`} {...common} />;
    case 'triangle': return <polygon points={`${x},${y - s - 0.6} ${x + s + 0.4},${y + s - 0.4} ${x - s - 0.4},${y + s - 0.4}`} {...common} />;
    case 'tri-down': return <polygon points={`${x},${y + s + 0.6} ${x + s + 0.4},${y - s + 0.4} ${x - s - 0.4},${y - s + 0.4}`} {...common} />;
    default: {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? s * 0.5 : s + 1;
        const a = -Math.PI / 2 + (Math.PI * i) / 5;
        pts.push(`${x + rr * Math.cos(a)},${y + rr * Math.sin(a)}`);
      }
      return <polygon points={pts.join(' ')} {...common} />;
    }
  }
}

/** 偏差値の推移（その年度の回ごと）。教科ごとに色と印の形を変え、右に凡例を置く。 */
export function TrendLines({ trend }: { trend: TrendRow[] }) {
  const W = 300, H = 160, left = 26, right = 64, top = 10, bottom = 22;
  const vals = trend.flatMap((t) => SERIES.map((s) => t.dev[s.key])).filter((v): v is number => v != null);
  const lo = Math.min(30, Math.floor(Math.min(...vals, 50) / 10) * 10);
  const hi = Math.max(70, Math.ceil(Math.max(...vals, 50) / 10) * 10);
  const n = Math.max(1, trend.length);
  const x = (i: number) => left + ((W - left - right) * (i + 0.5)) / n;
  const y = (v: number) => top + ((H - top - bottom) * (hi - v)) / (hi - lo);
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += 10) ticks.push(t);
  return (
    <svg className="rs-chart rs-trend-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="教科別偏差値の推移">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className={t === 50 ? 'rs-gl rs-gl-50' : 'rs-gl'} />
          <text x={left - 4} y={y(t) + 3} className="rs-ax" textAnchor="end">{t.toFixed(1)}</text>
        </g>
      ))}
      {trend.map((t, i) => <text key={t.key} x={x(i)} y={H - 6} className="rs-ax" textAnchor="middle">{trendLabel(t)}</text>)}
      {SERIES.map((s) => {
        const pts = trend.map((t, i) => (t.dev[s.key] == null ? null : [x(i), y(t.dev[s.key] as number)])).filter((p): p is number[] => !!p);
        return (
          <g key={s.key}>
            {pts.length > 1 && <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={s.color} strokeWidth={s.key === 'k5' ? 2.2 : 1.6} strokeLinejoin="round" strokeLinecap="round" />}
            {trend.map((t, i) => t.dev[s.key] == null ? null : (
              <g key={t.key}>
                <Mark kind={s.mark} x={x(i)} y={y(t.dev[s.key] as number)} color={s.color} />
                <title>{`${trendLabel(t)} ${STAT_NAMES[s.key]}：${f1(t.dev[s.key])}`}</title>
              </g>
            ))}
          </g>
        );
      })}
      {SERIES.map((s, i) => (
        <g key={s.key} className="rs-legend-svg">
          <Mark kind={s.mark} x={W - right + 12} y={top + 6 + i * 14} color={s.color} />
          <text x={W - right + 20} y={top + 9 + i * 14}>{s.key === 'k5' ? '5教科' : STAT_NAMES[s.key]}</text>
        </g>
      ))}
    </svg>
  );
}

/** 偏差値の分布（横棒・上が高い偏差値）。自分の入る棒だけ濃くする。 */
export function DevDist({ bins }: { bins: Bin[] }) {
  const W = 300, rowH = 9, left = 44, right = 30, top = 4, bottom = 16;
  const H = top + rowH * bins.length + bottom;
  const maxC = Math.max(1, ...bins.map((b) => b.count));
  const step = niceStep(maxC);
  const xMax = Math.ceil(maxC / step) * step;
  const x = (v: number) => left + ((W - left - right) * v) / xMax;
  const ticks: number[] = [];
  for (let t = 0; t <= xMax; t += step) ticks.push(t);
  return (
    <svg className="rs-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="五教科の偏差値の分布">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top} y2={top + rowH * bins.length} className="rs-gl" />
          <text x={x(t)} y={H - 4} className="rs-ax" textAnchor="middle">{t}</text>
        </g>
      ))}
      {bins.map((b, i) => {
        const yy = top + rowH * i;
        const w = x(b.count) - left;
        return (
          <g key={b.label}>
            <text x={left - 4} y={yy + rowH / 2 + 3} className="rs-ax" textAnchor="end">{b.label}</text>
            {b.count > 0 && (
              <path className={b.mine ? 'rs-bar-mine' : 'rs-bar'} d={barPath(left, yy + 1.5, w, rowH - 3)}>
                <title>{`偏差値 ${b.label}：${b.count}人${b.mine ? '（あなた）' : ''}`}</title>
              </path>
            )}
            {b.mine && <text x={left + Math.max(w, 0) + 4} y={yy + rowH / 2 + 3} className="rs-mine-label">あなた</text>}
          </g>
        );
      })}
    </svg>
  );
}

function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(2.5, w / 2, h / 2);
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}
