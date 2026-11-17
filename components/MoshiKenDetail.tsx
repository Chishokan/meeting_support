'use client';

// 県一斉模試の面談画面（詳細）。業者の成績の画面と同じように、生徒1人の詳しい成績をタブで切り替えて見せる。
//   成績一覧：今回の成績（得点・県平均・偏差値・偏差値グラフ・県内順位・塾内順位）／教科別レーダーチャート／教科別偏差値推移（表とグラフ）
//   志望校判定：4つの志望校の判定・合格確率。選んだ学校の判定教科・判定得点・判定偏差値・基準偏差値・基準まであと何点・塾内の志望者
//   過去テスト一覧：取り込んだ県一斉模試の回ごとの5教科（押すとその回に切り替わる）
//   成績表：印刷するのと同じ個人成績表（A4 横）
// 県平均は取り込んだ得点と偏差値から計算する（lib/moshi/model.ts の kenFits。2026年10月は換算表の平均点と同じ）。
// 判定の中身は参考データ（lib/moshi/reference.ts）の判定基準から計算する。同じ年月の資料がある回だけ、判定偏差値と基準まであと何点を出す。

import { useMemo, useState } from 'react';
import {
  KEN_MAX, KEN_SLOTS, SUBJECT_KEYS, campusInfo, kenExamRef, kenFirstChoiceMean, kenFits, kenHistory, kenJudgeDetail, kenSchoolGroup,
  rankIn, trendRows,
  type ExamStats, type KenRow, type KenStats, type KenitsuResult, type StatKey, type SubjectKey, type TrendRow,
} from '@/lib/moshi/model';
import { REFERENCES, refSchoolByCode, referenceForDate } from '@/lib/moshi/reference';
import { schoolName } from '@/lib/moshi/schools';
import { FitSheet, f1, trendLabel } from './MoshiReportSheet';
import { KenReportSheet } from './MoshiKenSheet';

// 業者の画面と同じ並び（5科・3科・英数国理社）。色は成績表の推移のグラフと同じ
const ORDER: StatKey[] = ['k5', 'k3', 'en', 'ma', 'ja', 'sc', 'so'];
const NAME: Record<StatKey, string> = { k5: '5科合計', k3: '3科合計', en: '英語', ma: '数学', ja: '国語', sc: '理科', so: '社会' };
const SHORT: Record<StatKey, string> = { k5: '5科', k3: '3科', en: '英語', ma: '数学', ja: '国語', sc: '理科', so: '社会' };
const COLOR: Record<StatKey, string> = { k5: '#d9604a', k3: '#4f63a8', en: '#e07bab', ma: '#2a9fd0', ja: '#ea7d3c', sc: '#9254a8', so: '#22a86b' };
const RADAR_ORDER: SubjectKey[] = ['ja', 'ma', 'en', 'so', 'sc'];

type Tab = 'score' | 'judge' | 'past' | 'sheet';
type Sub = 'now' | 'radar' | 'trend';

function n0(v: number | null | undefined): string {
  return v == null ? '—' : Math.round(v).toLocaleString('ja-JP');
}

export function KenDetail({ ks, row, kenitsu, statsList, onPickExam }: {
  ks: KenStats; row: KenRow; kenitsu: KenitsuResult[]; statsList: ExamStats[]; onPickExam: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('score');
  const [sub, setSub] = useState<Sub>('now');
  const fits = useMemo(() => kenFits(kenitsu, ks.exam.id), [kenitsu, ks.exam.id]);
  const k = row.k;
  return (
    <section className="kd">
      <div className="kd-head">
        <span>氏名：<b>{row.name || '（名簿に無い）'}</b>（受験番号：{k.examNo}）</span>
        <span className="kd-sub">智翔館 {campusInfo(k.campus)?.label ?? k.campus}・{ks.exam.name}{k.naishin ? `・内申点 ${k.naishin}` : ''}</span>
      </div>
      <div className="kd-tabs" role="tablist">
        {([['score', '成績一覧'], ['judge', '志望校判定'], ['past', '過去テスト一覧'], ['sheet', '成績表']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>
      {tab === 'score' && (
        <div className="kd-panel">
          <div className="kd-subtabs" role="tablist">
            {([['now', '今回の成績'], ['radar', '教科別レーダーチャート'], ['trend', '教科別偏差値推移']] as [Sub, string][]).map(([t, label]) => (
              <button key={t} type="button" role="tab" aria-selected={sub === t} className={sub === t ? 'on' : ''} onClick={() => setSub(t)}>{label}</button>
            ))}
          </div>
          {sub === 'now' && <KdNow ks={ks} row={row} fits={fits} />}
          {sub === 'radar' && <KdRadar ks={ks} row={row} fits={fits} />}
          {sub === 'trend' && <KdTrend ks={ks} row={row} kenitsu={kenitsu} statsList={statsList} />}
        </div>
      )}
      {tab === 'judge' && <div className="kd-panel"><KdJudge ks={ks} row={row} fits={fits} /></div>}
      {tab === 'past' && <div className="kd-panel"><KdPast ks={ks} row={row} kenitsu={kenitsu} onPickExam={onPickExam} /></div>}
      {tab === 'sheet' && <div className="kd-panel ms-interview-card"><FitSheet max={1.6}><KenReportSheet ks={ks} row={row} kenitsu={kenitsu} statsList={statsList} /></FitSheet></div>}
    </section>
  );
}

// ---- 今回の成績 -----------------------------------------------------------------

const LO = 25, HI = 75;
const pos = (v: number) => Math.max(0, Math.min(100, ((v - LO) / (HI - LO)) * 100));

function KdNow({ ks, row, fits }: { ks: KenStats; row: KenRow; fits: ReturnType<typeof kenFits> }) {
  const k = row.k;
  const ticks = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75];
  return (
    <>
      <h3 className="kd-h">今回の成績</h3>
      <div className="kd-scroll">
        <table className="kd-table kd-now">
          <thead>
            <tr>
              <th>教科</th><th>得点</th><th>県平均</th><th>偏差値</th>
              <th className="kd-graph-h">
                <div>偏差値グラフ</div>
                <div className="kd-scale">{ticks.map((t) => <span key={t} style={{ left: `${pos(t)}%` }}>{t}</span>)}</div>
              </th>
              <th>県内順位</th><th>塾内順位</th>
            </tr>
          </thead>
          <tbody>
            {ORDER.map((key) => {
              const st = k.stats[key];
              const dev = st?.dev ?? null;
              return (
                <tr key={key} className={key === 'k5' || key === 'k3' ? 'kd-total' : ''}>
                  <th>{NAME[key]}</th>
                  <td className="num"><b>{st?.score ?? '—'}</b><small> 点 / {KEN_MAX[key]}点</small></td>
                  <td className="num">{fits[key] ? `${f1(fits[key]!.mean)}` : '—'}<small> 点</small></td>
                  <td className="num kd-dev">{f1(dev) || '—'}</td>
                  <td className="kd-graph">
                    <div className="kd-track">
                      {ticks.map((t) => <i key={t} style={{ left: `${pos(t)}%` }} className={t === 50 ? 'kd-50' : ''} />)}
                      {dev != null && <div className="kd-bar" style={{ width: `${pos(dev)}%`, background: COLOR[key] }} />}
                    </div>
                  </td>
                  <td className="num">{st?.rank != null ? <><b>{n0(st.rank)}</b><small> 位</small></> : '—'}</td>
                  <td className="num">{row.inside[key] != null ? <><b>{row.inside[key]}</b><small> 位 / {ks.n[key]}人中</small></> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="kd-note">
        得点・偏差値・県内順位は県一斉模試の集計（県全体）の値。県平均は、取り込んだ得点と偏差値から計算した県全体の平均点です
        （2026年10月の回は換算表の平均点と同じ）。塾内順位は、この回を受けた智翔館 中等部の生徒の中での順位です。
      </p>
    </>
  );
}

// ---- 教科別レーダーチャート ---------------------------------------------------------

function choiceOptions(row: KenRow) {
  return KEN_SLOTS.map((slot, i) => ({ slot, i, c: row.k.choices[i] })).filter((x) => x.c?.code);
}

function KdRadar({ ks, row, fits }: { ks: KenStats; row: KenRow; fits: ReturnType<typeof kenFits> }) {
  const opts = choiceOptions(row);
  const [pick, setPick] = useState(0);
  const cur = opts[Math.min(pick, Math.max(0, opts.length - 1))];
  const code = cur?.c.code ?? '';
  const fc = useMemo(() => kenFirstChoiceMean(ks, code), [ks, code]);
  const [hide, setHide] = useState<Record<string, boolean>>({});
  const series = [
    { id: 'me', label: 'あなたの得点率', color: '#3aa757', fill: 'rgba(58,167,87,.22)', vals: RADAR_ORDER.map((s) => row.k.stats[s]?.score ?? null) },
    { id: 'avg', label: '県平均の得点率', color: '#5bb6d9', fill: 'rgba(91,182,217,.16)', vals: RADAR_ORDER.map((s) => fits[s]?.mean ?? null) },
    ...(code && fc.n ? [{ id: 'fc', label: `塾内の第1志望者の得点率（${fc.n}人）`, color: '#e58ad0', fill: 'rgba(229,138,208,.14)', vals: RADAR_ORDER.map((s) => fc.mean[s]) }] : []),
  ];
  const W = 460, H = 400, cx = 230, cy = 205, R = 150;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / RADAR_ORDER.length;
    return [cx + R * v * Math.cos(a), cy + R * v * Math.sin(a)];
  };
  const poly = (vals: (number | null)[]) => vals.map((v, i) => pt(i, v == null ? 0 : Math.max(0, Math.min(1, v / 100))).join(',')).join(' ');
  return (
    <>
      <h3 className="kd-h">教科別レーダーチャート</h3>
      <div className="kd-row">
        <label className="kd-select">
          <span>くらべる志望校</span>
          <select value={pick} onChange={(e) => setPick(Number(e.target.value))} disabled={!opts.length}>
            {opts.map((o, j) => <option key={o.slot} value={j}>{o.slot.replace('・', '')} {o.c.name || schoolName(o.c.code)}</option>)}
            {!opts.length && <option>志望校の記入なし</option>}
          </select>
        </label>
        <span className="kd-muted">5教科の得点率（各100点満点）。凡例を押すと線の表示を切り替えられます。</span>
      </div>
      <svg className="kd-radar" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="得点率レーダーチャート">
        {[0.2, 0.4, 0.6, 0.8, 1].map((t) => <polygon key={t} points={RADAR_ORDER.map((_, i) => pt(i, t).join(',')).join(' ')} className="kd-ring" />)}
        {RADAR_ORDER.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="kd-ring" />; })}
        {[20, 40, 60, 80, 100].map((t) => <text key={t} x={cx + 3} y={cy - (R * t) / 100 + 4} className="kd-ax">{t}</text>)}
        {series.filter((s) => !hide[s.id]).map((s) => (
          <g key={s.id}>
            <polygon points={poly(s.vals)} fill={s.fill} stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" />
            {s.vals.map((v, i) => { if (v == null) return null; const [x, y] = pt(i, Math.min(1, v / 100)); return <circle key={i} cx={x} cy={y} r={3.2} fill={s.color}><title>{`${s.label}：${NAME[RADAR_ORDER[i]]} ${f1(v)}%`}</title></circle>; })}
          </g>
        ))}
        {RADAR_ORDER.map((s, i) => {
          const [x, y] = pt(i, 1.14);
          return <text key={s} x={x} y={y + 5} className="kd-ax-label" textAnchor={Math.abs(x - cx) < 4 ? 'middle' : x > cx ? 'start' : 'end'}>{NAME[s]}</text>;
        })}
      </svg>
      <div className="kd-legend">
        {series.map((s) => (
          <button key={s.id} type="button" className={hide[s.id] ? 'off' : ''} onClick={() => setHide((h) => ({ ...h, [s.id]: !h[s.id] }))}>
            <i style={{ background: s.fill, borderColor: s.color }} />{s.label}
          </button>
        ))}
      </div>
      <p className="kd-note">県平均は県全体の平均点。第1志望者は、この学校を公立第1か国・私立第1に書いた智翔館の生徒（この回）の平均です。</p>
    </>
  );
}

// ---- 教科別偏差値推移 -----------------------------------------------------------

function KdTrend({ ks, row, kenitsu, statsList }: { ks: KenStats; row: KenRow; kenitsu: KenitsuResult[]; statsList: ExamStats[] }) {
  const trend = useMemo(
    () => trendRows(statsList, kenExamRef(ks.exam), { name: row.name, examNo: row.k.examNo, campus: row.k.campus }, kenitsu)
      .filter((t) => t.current || ORDER.some((key) => t.dev[key] != null)),
    [statsList, ks.exam, row.name, row.k.examNo, row.k.campus, kenitsu],
  );
  return (
    <>
      <h3 className="kd-h">教科別偏差値推移表</h3>
      <div className="kd-scroll">
        <table className="kd-table kd-trend">
          <thead><tr><th>教科名</th>{trend.map((t) => <th key={t.key}>{t.current ? `【${trendLabel(t)}】` : trendLabel(t)}</th>)}</tr></thead>
          <tbody>
            {ORDER.map((key) => (
              <tr key={key}>
                <th><i className="kd-dot" style={{ background: COLOR[key] }} />{NAME[key]}</th>
                {trend.map((t) => <td key={t.key} className={`num${t.current ? ' kd-cur' : ''}`}>{f1(t.dev[key]) || '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="kd-note">「県」は長崎県一斉模試（業者の偏差値）。月だけの列は本番レベル模試（換算した偏差値）。同じ年度の回を古い順に並べています。</p>
      <h3 className="kd-h">偏差値推移グラフ</h3>
      <div className="kd-charts">
        <KdLines trend={trend} keys={['k5', 'k3']} />
        <KdLines trend={trend} keys={['en', 'ma', 'ja', 'sc', 'so']} />
      </div>
    </>
  );
}

function KdLines({ trend, keys }: { trend: TrendRow[]; keys: StatKey[] }) {
  const W = 520, H = 300, left = 34, right = 14, top = 14, bottom = 56;
  const vals = trend.flatMap((t) => keys.map((key) => t.dev[key])).filter((v): v is number => v != null);
  const lo = Math.min(35, Math.floor(Math.min(...vals, 50) / 5) * 5);
  const hi = Math.max(75, Math.ceil(Math.max(...vals, 50) / 5) * 5);
  const n = Math.max(1, trend.length);
  const x = (i: number) => left + ((W - left - right) * (i + 0.5)) / n;
  const y = (v: number) => top + ((H - top - bottom) * (hi - v)) / (hi - lo);
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += 5) ticks.push(t);
  return (
    <svg className="kd-lines" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${keys.map((k) => SHORT[k]).join('・')}の偏差値の推移`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className={t === 50 ? 'kd-grid kd-grid-50' : 'kd-grid'} />
          <text x={left - 6} y={y(t) + 4} className="kd-ax" textAnchor="end">{t}</text>
        </g>
      ))}
      {trend.map((t, i) => (
        <g key={t.key}>
          <line x1={x(i)} x2={x(i)} y1={top} y2={H - bottom} className="kd-grid" />
          <text x={x(i)} y={H - bottom + 16} className={`kd-ax${t.current ? ' kd-ax-cur' : ''}`} textAnchor="middle">{trendLabel(t)}</text>
        </g>
      ))}
      {keys.map((key) => {
        const pts = trend.map((t, i) => (t.dev[key] == null ? null : [x(i), y(t.dev[key] as number)])).filter((p): p is number[] => !!p);
        return (
          <g key={key}>
            {pts.length > 1 && <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={COLOR[key]} strokeWidth={2.4} strokeLinejoin="round" />}
            {trend.map((t, i) => t.dev[key] == null ? null : (
              <circle key={t.key} cx={x(i)} cy={y(t.dev[key] as number)} r={4.5} fill={COLOR[key]} stroke="#fff" strokeWidth={1.2}>
                <title>{`${trendLabel(t)} ${NAME[key]}：${f1(t.dev[key])}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
      {keys.map((key, i) => (
        <g key={key} transform={`translate(${left + i * 82},${H - 18})`}>
          <rect width={14} height={10} y={-9} rx={2} fill={COLOR[key]} />
          <text x={19} y={0} className="kd-legend-svg">{NAME[key]}</text>
        </g>
      ))}
    </svg>
  );
}

// ---- 志望校判定 -----------------------------------------------------------------

function KdJudge({ ks, row, fits }: { ks: KenStats; row: KenRow; fits: ReturnType<typeof kenFits> }) {
  const opts = choiceOptions(row);
  const [pick, setPick] = useState(0);
  const cur = opts[Math.min(pick, Math.max(0, opts.length - 1))];
  const sameRef = referenceForDate(ks.exam.date);
  const ref = sameRef ?? REFERENCES[0];
  const sameExam = !!sameRef;
  const school = cur && ref ? refSchoolByCode(ref, cur.c.code) : undefined;
  const detail = cur && school ? kenJudgeDetail(row.k, school, fits, sameExam) : null;
  const group = cur ? kenSchoolGroup(ks, row, cur.c.code, school ?? null, fits, sameExam) : null;
  if (!opts.length) return <p className="kd-muted">この回は志望校の記入がありません。</p>;
  return (
    <div className="kd-judge">
      <div>
        <h3 className="kd-h">志望校判定</h3>
        <p className="kd-muted">確かめたい志望校の区分を押してください。</p>
        <table className="kd-table kd-jlist">
          <thead><tr><th>区分</th><th>学校コード</th><th>学校名</th><th>判定</th><th>合格確率</th></tr></thead>
          <tbody>
            {opts.map((o, j) => (
              <tr key={o.slot} className={cur?.slot === o.slot ? 'on' : ''}>
                <td><button type="button" className={cur?.slot === o.slot ? 'kd-pill on' : 'kd-pill'} onClick={() => setPick(j)}>{o.slot}</button></td>
                <td className="num">{o.c.code}</td>
                <td>{o.c.name || schoolName(o.c.code)}</td>
                <td className="kd-grade">{o.c.judge || '—'}</td>
                <td className="num kd-prob">{o.c.prob || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cur && (
        <div>
          <h3 className="kd-h kd-h-blue">志望校情報</h3>
          <table className="kd-table kd-info">
            <tbody>
              <tr><th colSpan={2}>学校名</th><th>区分</th></tr>
              <tr><td colSpan={2} className="kd-center">{cur.c.name || schoolName(cur.c.code)}</td><td className="kd-center">{cur.slot.startsWith('公立') ? '公立' : '国・私立'}</td></tr>
              <tr><th>判定教科</th><th>判定得点</th><th>判定偏差値</th></tr>
              <tr>
                <td className="kd-center">{detail?.rule ?? '—'}</td>
                <td className="kd-center">{detail?.score != null ? <><b>{detail.score}</b> 点 / {detail.max} 点</> : '—'}</td>
                <td className="kd-center"><b>{detail?.dev != null ? f1(detail.dev) : '—'}</b></td>
              </tr>
              <tr>
                <th>塾内の志望者の中の順位{detail?.score == null && '（5科）'}</th>
                <th>基準偏差値</th>
                <th>塾内の志望者の平均偏差値{detail?.dev == null && '（5科）'}</th>
              </tr>
              <tr>
                <td className="kd-center">{group?.rank != null ? <><b>{group.rank}</b> 位 / {group.n} 人中</> : '—'}</td>
                <td className="kd-center"><b>{school ? f1(school.bDev) : '—'}</b></td>
                <td className="kd-center"><b>{group?.avgDev != null ? f1(group.avgDev) : '—'}</b></td>
              </tr>
            </tbody>
          </table>
          <p className="kd-big">あなたの今回の判定は <b>{cur.c.judge || '—'}判定</b> です。</p>
          <p className="kd-big">合格確率は <b>{cur.c.prob || '—'}</b> です。</p>
          {detail?.toB != null && detail.bScore != null && (
            <table className="kd-table kd-next">
              <thead><tr><th>基準（B判定基準 {detail.bScore}点）まで</th><th>基準偏差値まで</th></tr></thead>
              <tbody>
                <tr>
                  <td className="kd-center">{detail.toB > 0 ? <>あと <b>{detail.toB}</b> 点</> : <>基準に届いています（<b>+{-detail.toB}</b> 点）</>}</td>
                  <td className="kd-center">{detail.dev != null ? (detail.bDev - detail.dev > 0 ? <>あと <b>{f1(detail.bDev - detail.dev)}</b></> : '届いています') : '—'}</td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="kd-note">
            判定・合格確率は県一斉模試の集計の値。判定教科・判定得点・基準偏差値は{ref?.label ?? '参考データ'}の志望校別判定基準から計算しています。
            {!school && 'この学校は判定基準の資料に無いため、判定教科・判定得点は出せません。'}
            {school && !sameExam && 'この回の判定基準の資料が無いため、判定偏差値・基準まであと何点は出していません。'}
            塾内の志望者は、この学校を4つの志望校のどれかに書いた智翔館の生徒（この回）。
          </p>
        </div>
      )}
    </div>
  );
}

// ---- 過去テスト一覧 ----------------------------------------------------------------

function KdPast({ ks, row, kenitsu, onPickExam }: { ks: KenStats; row: KenRow; kenitsu: KenitsuResult[]; onPickExam: (id: string) => void }) {
  const hist = useMemo(() => kenHistory(kenitsu, row.k.campus, row.k.examNo).reverse(), [kenitsu, row.k.campus, row.k.examNo]);
  const insideRank = (x: KenitsuResult) => {
    const me = x.stats.k5?.score;
    if (me == null) return null;
    const all = kenitsu.filter((y) => y.examId === x.examId).map((y) => y.stats.k5?.score).filter((v): v is number => v != null);
    return { rank: rankIn(all, me), n: all.length };
  };
  return (
    <>
      <h3 className="kd-h">過去テスト一覧</h3>
      <div className="kd-scroll">
        <table className="kd-table kd-past">
          <thead><tr><th>回</th><th>実施日</th><th>5教科</th><th>偏差値</th><th>県内順位</th><th>塾内順位</th><th>公立第1の判定</th><th></th></tr></thead>
          <tbody>
            {hist.map((x) => {
              const ir = insideRank(x);
              const on = x.examId === ks.exam.id;
              return (
                <tr key={x.examId} className={on ? 'on' : ''}>
                  <td>{x.examName}</td>
                  <td className="num">{x.date.replace(/-/g, '/')}</td>
                  <td className="num"><b>{x.stats.k5?.score ?? '—'}</b> 点</td>
                  <td className="num">{f1(x.stats.k5?.dev) || '—'}</td>
                  <td className="num">{x.stats.k5?.rank != null ? `${n0(x.stats.k5.rank)} 位` : '—'}</td>
                  <td className="num">{ir ? `${ir.rank} 位 / ${ir.n}人中` : '—'}</td>
                  <td>{x.choices[0]?.code ? `${x.choices[0].name || schoolName(x.choices[0].code)}　${x.choices[0].judge}` : '—'}</td>
                  <td>{on ? <span className="kd-muted">表示中</span> : <button type="button" className="ms-btn ms-btn-sub" onClick={() => onPickExam(x.examId)}>この回を見る</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="kd-note">取り込んだ県一斉模試のうち、この生徒（同じ校舎・受験番号）が受けた回。［この回を見る］で、その回の成績に切り替わります。</p>
    </>
  );
}
