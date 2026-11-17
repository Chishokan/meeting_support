'use client';

// 面談の画面（詳細）の部品。県一斉模試（components/MoshiKenDetail.tsx）と本番レベル模試（components/MoshiHonbanDetail.tsx）で同じものを使う。
//   TabBar・SubTabBar：業者の成績の画面と同じタブ
//   NowTable：今回の成績（得点・平均・偏差値・偏差値グラフ・順位、前回の得点と偏差値）
//   RadarMulti：得点率のレーダー（あなた・平均・前回・第1志望者。凡例で切り替え）
//   TrendView：教科別偏差値推移（表と2つのグラフ）
//   PastTable：過去テスト一覧（県一斉模試と本番レベル模試。押すとその回に切り替わる）

import { useState, type ReactNode } from 'react';
import { type HistoryEntry, type StatKey, type SubjectKey, type TrendRow } from '@/lib/moshi/model';
import { f1, trendLabel } from './MoshiReportSheet';

// 業者の画面と同じ並び（5科・3科・英数国理社）。色は成績表の推移のグラフと同じ
export const ORDER: StatKey[] = ['k5', 'k3', 'en', 'ma', 'ja', 'sc', 'so'];
export const NAME: Record<StatKey, string> = { k5: '5科合計', k3: '3科合計', en: '英語', ma: '数学', ja: '国語', sc: '理科', so: '社会' };
export const SHORT: Record<StatKey, string> = { k5: '5科', k3: '3科', en: '英語', ma: '数学', ja: '国語', sc: '理科', so: '社会' };
export const COLOR: Record<StatKey, string> = { k5: '#d9604a', k3: '#4f63a8', en: '#e07bab', ma: '#2a9fd0', ja: '#ea7d3c', sc: '#9254a8', so: '#22a86b' };
export const RADAR_ORDER: SubjectKey[] = ['ja', 'ma', 'en', 'so', 'sc'];

export function n0(v: number | null | undefined): string {
  return v == null ? '—' : Math.round(v).toLocaleString('ja-JP');
}

export function TabBar<T extends string>({ tabs, value, onChange, sub }: { tabs: [T, string][]; value: T; onChange: (t: T) => void; sub?: boolean }) {
  return (
    <div className={sub ? 'kd-subtabs' : 'kd-tabs'} role="tablist">
      {tabs.map(([t, label]) => (
        <button key={t} type="button" role="tab" aria-selected={value === t} className={value === t ? 'on' : ''} onClick={() => onChange(t)}>{label}</button>
      ))}
    </div>
  );
}

// ---- 今回の成績 -----------------------------------------------------------------

export type NowRow = {
  key: StatKey;
  score: number | null;
  max: number;
  mean: number | null;
  dev: number | null;
  rank: ReactNode;       // 順位の欄（「800 位」「12 位 / 36人中」）
  inside?: ReactNode;    // 塾内順位の欄（県一斉模試だけ）
  prevScore?: number | null;
  prevDev?: number | null;
};

const LO = 25, HI = 75;
const pos = (v: number) => Math.max(0, Math.min(100, ((v - LO) / (HI - LO)) * 100));

export function NowTable({ rows, meanHead, rankHead, insideHead, prevHead }: {
  rows: NowRow[]; meanHead: string; rankHead: string; insideHead?: string; prevHead?: string;
}) {
  const ticks = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75];
  return (
    <div className="kd-scroll">
      <table className="kd-table kd-now">
        <thead>
          <tr>
            <th>教科</th><th>得点</th><th>{meanHead}</th><th>偏差値</th>
            <th className="kd-graph-h">
              <div>偏差値グラフ{prevHead && <small className="kd-graph-note">｜は{prevHead}</small>}</div>
              <div className="kd-scale">{ticks.map((t) => <span key={t} style={{ left: `${pos(t)}%` }}>{t}</span>)}</div>
            </th>
            <th>{rankHead}</th>
            {insideHead && <th>{insideHead}</th>}
            {prevHead && <th>{prevHead}<br /><small>得点・偏差値</small></th>}
            {prevHead && <th>偏差値の差</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const diff = x.prevDev == null || x.dev == null ? null : Math.round((x.dev - x.prevDev) * 10) / 10;
            return (
              <tr key={x.key} className={x.key === 'k5' || x.key === 'k3' ? 'kd-total' : ''}>
                <th>{NAME[x.key]}</th>
                <td className="num"><b>{x.score ?? '—'}</b><small> 点 / {x.max}点</small></td>
                <td className="num">{x.mean != null ? f1(x.mean) : '—'}<small> 点</small></td>
                <td className="num kd-dev">{f1(x.dev) || '—'}</td>
                <td className="kd-graph">
                  <div className="kd-track">
                    {ticks.map((t) => <i key={t} style={{ left: `${pos(t)}%` }} className={t === 50 ? 'kd-50' : ''} />)}
                    {x.dev != null && <div className="kd-bar" style={{ width: `${pos(x.dev)}%`, background: COLOR[x.key] }} />}
                    {x.prevDev != null && <b className="kd-prev" style={{ left: `${pos(x.prevDev)}%` }} title={`${prevHead} ${f1(x.prevDev)}`} />}
                  </div>
                </td>
                <td className="num">{x.rank}</td>
                {insideHead && <td className="num">{x.inside}</td>}
                {prevHead && <td className="num">{x.prevScore ?? '—'}<small> 点・</small>{f1(x.prevDev) || '—'}</td>}
                {prevHead && <td className={`num kd-diff ${diff == null ? '' : diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`}>{diff == null ? '—' : diff === 0 ? '±0.0' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)}`}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- レーダーチャート --------------------------------------------------------------

export type RadarSeries = { id: string; label: string; color: string; fill: string; vals: (number | null)[] }; // vals は得点率（0〜100）、RADAR_ORDER の順

export function RadarMulti({ series }: { series: RadarSeries[] }) {
  const [hide, setHide] = useState<Record<string, boolean>>({});
  const W = 460, H = 400, cx = 230, cy = 205, R = 150;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / RADAR_ORDER.length;
    return [cx + R * v * Math.cos(a), cy + R * v * Math.sin(a)];
  };
  const poly = (vals: (number | null)[]) => vals.map((v, i) => pt(i, v == null ? 0 : Math.max(0, Math.min(1, v / 100))).join(',')).join(' ');
  return (
    <>
      <svg className="kd-radar" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="得点率レーダーチャート">
        {[0.2, 0.4, 0.6, 0.8, 1].map((t) => <polygon key={t} points={RADAR_ORDER.map((_, i) => pt(i, t).join(',')).join(' ')} className="kd-ring" />)}
        {RADAR_ORDER.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="kd-ring" />; })}
        {[20, 40, 60, 80, 100].map((t) => <text key={t} x={cx + 3} y={cy - (R * t) / 100 + 4} className="kd-ax">{t}</text>)}
        {series.filter((s) => !hide[s.id]).map((s) => (
          <g key={s.id}>
            <polygon points={poly(s.vals)} fill={s.fill} stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeDasharray={s.id === 'prev' ? '5 3' : undefined} />
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
    </>
  );
}

// ---- 教科別偏差値推移 -----------------------------------------------------------

export function TrendView({ trend }: { trend: TrendRow[] }) {
  const cols = trend.filter((t) => t.current || ORDER.some((key) => t.dev[key] != null));
  return (
    <>
      <h3 className="kd-h">教科別偏差値推移表</h3>
      <div className="kd-scroll">
        <table className="kd-table kd-trend">
          <thead><tr><th>教科名</th>{cols.map((t) => <th key={t.key}>{t.current ? `【${trendLabel(t)}】` : trendLabel(t)}</th>)}</tr></thead>
          <tbody>
            {ORDER.map((key) => (
              <tr key={key}>
                <th><i className="kd-dot" style={{ background: COLOR[key] }} />{NAME[key]}</th>
                {cols.map((t) => <td key={t.key} className={`num${t.current ? ' kd-cur' : ''}`}>{f1(t.dev[key]) || '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="kd-note">「県」は長崎県一斉模試（業者の偏差値）。月だけの列は本番レベル模試（県一斉模試の平均点・標準偏差で換算した偏差値）。同じ年度の回を古い順に並べています。</p>
      <h3 className="kd-h">偏差値推移グラフ</h3>
      <div className="kd-charts">
        <KdLines trend={cols} keys={['k5', 'k3']} />
        <KdLines trend={cols} keys={['en', 'ma', 'ja', 'sc', 'so']} />
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

// ---- 過去テスト一覧 ----------------------------------------------------------------

export function PastTable({ entries, current, onPick }: {
  entries: HistoryEntry[]; current: { kind: 'honban' | 'ken'; id: string }; onPick?: (kind: 'honban' | 'ken', id: string) => void;
}) {
  return (
    <>
      <h3 className="kd-h">過去テスト一覧</h3>
      <div className="kd-scroll">
        <table className="kd-table kd-past">
          <thead><tr><th>回</th><th>種類</th><th>実施日</th><th>5教科</th><th>偏差値</th><th>順位</th><th>第1志望の判定</th><th></th></tr></thead>
          <tbody>
            {entries.map((x) => {
              const on = x.kind === current.kind && x.id === current.id;
              return (
                <tr key={`${x.kind}:${x.id}`} className={on ? 'on' : ''}>
                  <td>{x.name}</td>
                  <td>{x.kind === 'ken' ? '県一斉模試' : '本番レベル模試'}</td>
                  <td className="num">{x.date.replace(/-/g, '/')}</td>
                  <td className="num"><b>{x.score5 ?? '—'}</b> 点</td>
                  <td className="num">{f1(x.dev5) || '—'}</td>
                  <td className="num">{x.rank || '—'}</td>
                  <td>{x.firstChoice || '—'}</td>
                  <td>{on ? <span className="kd-muted">表示中</span> : onPick ? <button type="button" className="ms-btn ms-btn-sub" onClick={() => onPick(x.kind, x.id)}>この回を見る</button> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="kd-note">この生徒が受けた回（県一斉模試は同じ校舎・受験番号、本番レベル模試は同じ氏名）。［この回を見る］で、その回の成績に切り替わります。順位は、県一斉模試は県内、本番レベル模試は塾内。</p>
    </>
  );
}
