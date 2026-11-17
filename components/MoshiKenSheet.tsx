'use client';

// 県一斉模試の個人成績表（A4 横1枚）。取り込んだ県一斉模試の成績だけで出す（本番レベル模試の成績表と同じ枠・同じグラフ）。
//   左：表題・受験番号・氏名・所属 ／ 得点表（得点・偏差値・県内順位・塾内順位・塾内平均）／
//       志望校判定（業者の判定・合格確率、判定得点・判定偏差値・基準偏差値・基準まであと何点、塾内の志望者の順位）／ 前回の県一斉模試との比較
//   中：得点の分布（塾内）／ 教科別偏差値（グラフ。前回の位置も）／ 教科のバランス（塾内平均と）
//   右：教科別偏差値推移（本番レベル模試の回も並ぶ）／ 偏差値の分布（塾内）／ 成績のポイント（得意・のばしたい教科、上がった・下がった教科、第1志望まで）
//   （「先生から」の欄は置かない）
// 判定得点・判定偏差値・基準は参考データ（lib/moshi/reference.ts）の志望校別判定基準から計算する（面談の画面と同じ。lib/moshi/model.ts の kenJudgeDetail）。
// 偏差値・県内順位・判定・合格確率は業者の値（県全体）。塾内の数字は、取り込んだ智翔館 中等部の行から計算する（lib/moshi/model.ts の kenStatsOf）。
// 氏名は本番レベル模試の名簿から「校舎＋受験番号」で引いたもの（県一斉模試の行は氏名を持たない）。

import { useMemo } from 'react';
import {
  KEN_MAX, KEN_SLOTS, STAT_KEYS, STAT_NAMES, SUBJECT_KEYS, SUBJECT_NAMES, campusInfo, devBinsOf, kenExamRef, kenFits, kenJudgeDetail, kenPoints,
  kenSchoolGroup, scoreBinsOf, trendRows,
  type ExamStats, type KenRow, type KenStats, type KenitsuResult, type StatKey,
} from '@/lib/moshi/model';
import { REFERENCES, refSchoolByCode, referenceForDate } from '@/lib/moshi/reference';
import { schoolName } from '@/lib/moshi/schools';
import { DevDist, Radar, ScoreDist, TrendLines, f1, padRows, trendLabel } from './MoshiReportSheet';

export const KEN_TITLE = '長崎県一斉模試';

const HEAD: Record<StatKey, string> = { ja: '国語', en: '英語', ma: '数学', so: '社会', sc: '理科', k3: '3教科', k5: '5教科' };

function ym(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date || '');
  return m ? `${m[1]}.${m[2]}` : '';
}

/** 同じ年度の、この回より前の県一斉模試で、同じ生徒（校舎＋受験番号）の行。いちばん近い回。 */
export function kenBefore(kenitsu: KenitsuResult[], ks: KenStats, row: KenRow): KenitsuResult | null {
  const prev = kenitsu
    .filter((x) => x.examId !== ks.exam.id && x.date < ks.exam.date && x.campus === row.k.campus && x.examNo === row.k.examNo)
    .sort((a, b) => b.date.localeCompare(a.date));
  return prev[0] ?? null;
}

export function KenReportSheet({ ks, row, kenitsu, statsList }: { ks: KenStats; row: KenRow; kenitsu: KenitsuResult[]; statsList: ExamStats[] }) {
  const { exam } = ks;
  const k = row.k;
  const trend = useMemo(
    () => trendRows(statsList, kenExamRef(exam), { name: row.name, examNo: k.examNo, campus: k.campus }, kenitsu),
    [statsList, exam, row.name, k.examNo, k.campus, kenitsu],
  );
  const hasHonban = trend.some((t) => t.kind === 'honban');
  const before = useMemo(() => kenBefore(kenitsu, ks, row), [kenitsu, ks, row]);
  const totals = ks.rows.map((x) => x.k.stats.k5?.score).filter((v): v is number => v != null);
  const devs = ks.rows.map((x) => x.k.stats.k5?.dev).filter((v): v is number => v != null);
  const fits = useMemo(() => kenFits(kenitsu, exam.id), [kenitsu, exam.id]);
  const sameRef = referenceForDate(exam.date);
  const ref = sameRef ?? REFERENCES[0];
  // 志望校ごとの判定の中身（判定基準の資料に無い学校は null）
  const judges = KEN_SLOTS.map((slot, i) => {
    const c = k.choices[i] ?? { code: '', name: '', judge: '', prob: '' };
    const school = c.code && ref ? refSchoolByCode(ref, c.code) : undefined;
    return {
      slot, c,
      name: c.name || (c.code ? schoolName(c.code) : ''),
      detail: school ? kenJudgeDetail(k, school, fits, !!sameRef) : null,
      group: c.code ? kenSchoolGroup(ks, row, c.code, school ?? null, fits, !!sameRef) : null,
    };
  });
  const points = kenPoints(k, before, fits);
  const first = judges.find((j) => j.c.code) ?? null;

  return (
    <article className="rs-sheet rs-ken-sheet">
      {/* ---- 左 ---- */}
      <section className="rs-col">
        <header className="rs-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="rs-logo" src="/moshi/logo.png" alt="智翔館" />
          <div className="rs-title">{KEN_TITLE}</div>
        </header>
        <div className="rs-ym">{ym(exam.date) || exam.name}</div>
        <dl className="rs-info">
          <dt>受験番号</dt><dd>{k.examNo}</dd>
          <dt>氏名</dt><dd className="rs-name">{row.name}</dd>
          <dt>所属</dt><dd>智翔館 {campusInfo(k.campus)?.label ?? k.campus}{k.naishin ? `　内申点 ${k.naishin}` : ''}</dd>
        </dl>

        <table className="rs-score">
          <thead>
            <tr><th>県一斉模試</th>{STAT_KEYS.map((key) => <th key={key}>{HEAD[key]}</th>)}</tr>
          </thead>
          <tbody>
            <tr><th>得点</th>{STAT_KEYS.map((key) => <td key={key}>{k.stats[key]?.score ?? ''}</td>)}</tr>
            <tr><th>偏差値</th>{STAT_KEYS.map((key) => <td key={key}>{f1(k.stats[key]?.dev)}</td>)}</tr>
            <tr><th>県内順位</th>{STAT_KEYS.map((key) => <td key={key}>{k.stats[key]?.rank ?? ''}</td>)}</tr>
            <tr><th>塾内順位</th>{STAT_KEYS.map((key) => <td key={key}>{row.inside[key] == null ? '' : `${row.inside[key]}/${ks.n[key]}`}</td>)}</tr>
            <tr><th>塾内平均</th>{STAT_KEYS.map((key) => <td key={key}>{f1(ks.mean[key])}</td>)}</tr>
          </tbody>
        </table>

        <div className="rs-pill rs-pill-green">志望校判定</div>
        {judges.map(({ slot, c, name, detail, group }) => (
          <div key={slot} className="rs-judge rs-ken-judge">
            <div className="rs-j-head">
              <span>{slot.replace('・', '')}</span>
              <b>{c.code}</b>
              <span>{name}</span>
              {detail && <span className="rs-j-rule">判定教科：{detail.rule}</span>}
            </div>
            <table className="rs-j-table rs-kj-table">
              <tbody>
                <tr><th>判定</th><th>合格確率</th><th>判定得点</th><th>判定偏差値</th><th>基準偏差値</th></tr>
                <tr>
                  <td className="rs-kj-grade">{c.judge}</td>
                  <td className="rs-kj-prob">{c.prob}</td>
                  <td>{detail?.score != null ? `${detail.score}／${detail.max}` : ''}</td>
                  <td>{detail?.dev != null ? f1(detail.dev) : ''}</td>
                  <td>{detail ? f1(detail.bDev) : ''}</td>
                </tr>
              </tbody>
            </table>
            <div className="rs-j-next rs-kj-next">
              <span>
                {detail?.toB != null && detail.bScore != null
                  ? (detail.toB > 0 ? <>基準（B判定基準 {detail.bScore}点）まで あと <b>{detail.toB}</b> 点</> : <>基準（B判定基準 {detail.bScore}点）に届いています（<b>+{-detail.toB}</b> 点）</>)
                  : c.code ? '　' : ''}
              </span>
              {group?.rank != null && <span className="rs-j-inside">塾内の志望者 {group.n}人中 {group.rank}位</span>}
            </div>
          </div>
        ))}

        <div className="rs-h rs-h-sm">前回の県一斉模試との比較{before && <small className="rs-h-note">{before.examName}</small>}</div>
        {before ? (
          <table className="rs-cmp">
            <thead><tr><th></th>{STAT_KEYS.map((key) => <th key={key}>{HEAD[key]}</th>)}</tr></thead>
            <tbody>
              <tr><th>偏差値（前回）</th>{STAT_KEYS.map((key) => <td key={key}>{f1(before.stats[key]?.dev)}</td>)}</tr>
              <tr><th>偏差値（今回）</th>{STAT_KEYS.map((key) => <td key={key}>{f1(k.stats[key]?.dev)}</td>)}</tr>
              <tr className="rs-cmp-diff"><th>差</th>{STAT_KEYS.map((key) => <td key={key} className={diffClass(before.stats[key]?.dev, k.stats[key]?.dev)}>{diff1(before.stats[key]?.dev, k.stats[key]?.dev)}</td>)}</tr>
              <tr><th>県内順位（前回）</th>{STAT_KEYS.map((key) => <td key={key}>{before.stats[key]?.rank ?? ''}</td>)}</tr>
              <tr><th>県内順位（今回）</th>{STAT_KEYS.map((key) => <td key={key}>{k.stats[key]?.rank ?? ''}</td>)}</tr>
            </tbody>
          </table>
        ) : <p className="rs-cmp-none">この年度の、これより前の県一斉模試の成績はありません。</p>}
      </section>

      {/* ---- 中 ---- */}
      <section className="rs-col">
        <div className="rs-pill rs-pill-orange">得点の分布<small className="rs-pill-note">5教科・塾内</small></div>
        <ScoreDist bins={scoreBinsOf(totals, k.stats.k5?.score ?? null, KEN_MAX.k5)} />
        <div className="rs-pill rs-pill-yellow">教科別偏差値<small className="rs-pill-note">{before ? '｜は前回' : '県全体'}</small></div>
        <KenDevBars k={k} before={before} />
        <div className="rs-pill rs-pill-blue">教科のバランス</div>
        <Radar
          mine={SUBJECT_KEYS.map((key) => k.stats[key]?.score ?? null)}
          avg={SUBJECT_KEYS.map((key) => ks.mean[key])}
          max={SUBJECT_KEYS.map((key) => KEN_MAX[key])}
          avgLabel="塾内平均"
        />
      </section>

      {/* ---- 右 ---- */}
      <section className="rs-col">
        <div className="rs-h">教科別偏差値推移<small className="rs-h-note">県＝長崎県一斉模試{hasHonban ? '・月だけの行は本番レベル模試' : ''}</small></div>
        <table className="rs-trend">
          <thead><tr><th></th>{STAT_KEYS.map((key) => <th key={key}>{key === 'k3' ? '3教科' : key === 'k5' ? '5教科' : STAT_NAMES[key]}</th>)}</tr></thead>
          <tbody>
            {padRows(trend, 4).map((t, i) => (
              <tr key={t?.key ?? `pad${i}`} className={`${t?.current ? 'rs-cur' : ''}${t?.kind === 'ken' ? ' rs-ken' : ''}`}>
                <th>{t ? trendLabel(t) : ''}</th>
                {STAT_KEYS.map((key) => <td key={key}>{t ? f1(t.dev[key]) : ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <TrendLines trend={trend} />
        <div className="rs-pill rs-pill-pink">偏差値の分布<small className="rs-pill-note">5教科・塾内</small></div>
        <DevDist bins={devBinsOf(devs, k.stats.k5?.dev ?? null)} />
        <div className="rs-pill rs-pill-green">成績のポイント</div>
        <ul className="rs-points">
          {points.strong.length > 0 && <li><b>得意な教科</b>{points.strong.map((x) => `${SUBJECT_NAMES[x.key]} ${f1(x.dev)}`).join('・')}</li>}
          {points.weak.length > 0 && <li><b>のばしたい教科</b>{points.weak.map((x) => `${SUBJECT_NAMES[x.key]} ${f1(x.dev)}`).join('・')}</li>}
          {before && <li><b>前回から上がった</b>{points.up.length ? points.up.map((x) => `${SUBJECT_NAMES[x.key]} +${x.diff.toFixed(1)}`).join('・') : 'なし（＋1.0 以上）'}</li>}
          {before && <li><b>前回から下がった</b>{points.down.length ? points.down.map((x) => `${SUBJECT_NAMES[x.key]} ${x.diff.toFixed(1)}`).join('・') : 'なし（−1.0 以下）'}</li>}
          {points.vsMean != null && <li><b>5教科と県平均</b>{points.vsMean >= 0 ? `県平均より ${points.vsMean.toFixed(1)}点 上` : `県平均まで あと ${(-points.vsMean).toFixed(1)}点`}</li>}
          {first?.detail?.toB != null && <li><b>{first.slot.replace('・', '')}まで</b>{first.name}：{first.detail.toB > 0 ? `判定得点で基準まで あと ${first.detail.toB}点` : `基準に届いています（+${-first.detail.toB}点）`}</li>}
        </ul>
      </section>

      <footer className="rs-foot">
        {`得点・偏差値・県内順位・判定・合格確率は${exam.name}の集計（県全体）の値。塾内順位・塾内平均・分布は、この回を受けた智翔館 中等部の生徒（5教科 ${ks.n.k5}人）の中でのもの。`}
        {ref && `判定得点・基準偏差値は${ref.label}の志望校別判定基準から計算${sameRef ? '（判定偏差値・基準まであと何点も同じ資料から）' : '（この回の資料が無いため、判定偏差値・基準まであと何点は出していません）'}。`}
      </footer>
    </article>
  );
}

// ---- 教科別偏差値（横棒。25〜75。前回の位置を｜で） --------------------------------

const BAR_ORDER: StatKey[] = ['k5', 'k3', 'ja', 'en', 'ma', 'so', 'sc'];
const BAR_COLOR: Record<StatKey, string> = { k5: '#1f2329', k3: '#6b6f76', ja: '#2a78d6', en: '#eb6834', ma: '#1baf7a', so: '#eda100', sc: '#e87ba4' };

function KenDevBars({ k, before }: { k: KenitsuResult; before: KenitsuResult | null }) {
  const W = 330, left = 36, right = 30, top = 12, rowH = 13.5;
  const H = top + rowH * BAR_ORDER.length + 4;
  const lo = 25, hi = 75;
  const x = (v: number) => left + ((W - left - right) * (Math.max(lo, Math.min(hi, v)) - lo)) / (hi - lo);
  return (
    <svg className="rs-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="教科別偏差値">
      {[30, 40, 50, 60, 70].map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top - 2} y2={H - 4} className={t === 50 ? 'rs-gl rs-gl-50' : 'rs-gl'} />
          <text x={x(t)} y={top - 4} className="rs-ax" textAnchor="middle">{t}</text>
        </g>
      ))}
      {BAR_ORDER.map((key, i) => {
        const y = top + rowH * i;
        const d = k.stats[key]?.dev;
        const p = before?.stats[key]?.dev;
        return (
          <g key={key}>
            <text x={left - 4} y={y + rowH / 2 + 3} className="rs-ax" textAnchor="end">{HEAD[key]}</text>
            {d != null && (
              <>
                <rect x={left} y={y + 2.5} width={Math.max(0, x(d) - left)} height={rowH - 5} rx={1.5} fill={BAR_COLOR[key]} opacity={0.88}>
                  <title>{`${HEAD[key]}：${f1(d)}`}</title>
                </rect>
                <text x={Math.max(x(d), p != null ? x(p) : 0) + 3} y={y + rowH / 2 + 3} className="rs-bar-val">{f1(d)}</text>
              </>
            )}
            {p != null && <line x1={x(p)} x2={x(p)} y1={y + 1} y2={y + rowH - 1} className="rs-prev-mark"><title>{`前回 ${f1(p)}`}</title></line>}
          </g>
        );
      })}
    </svg>
  );
}

function diff1(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null) return '';
  const d = Math.round((b - a) * 10) / 10;
  return d === 0 ? '±0.0' : `${d > 0 ? '+' : ''}${d.toFixed(1)}`;
}

function diffClass(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null) return '';
  return b > a ? 'up' : b < a ? 'down' : '';
}
