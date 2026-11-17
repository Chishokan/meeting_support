'use client';

// 県一斉模試の個人成績表（A4 横1枚）。取り込んだ県一斉模試の成績だけで出す（本番レベル模試の成績表と同じ枠・同じグラフ）。
//   左：表題・受験番号・氏名・所属 ／ 得点表（得点・偏差値・県内順位・塾内順位・塾内平均）／ 志望校判定（業者の判定・合格確率・塾内の志望者の順位）
//   中：得点の分布（塾内）／ 教科のバランス（塾内平均と）／ 前回の県一斉模試との比較
//   右：教科別偏差値推移（本番レベル模試の回も並ぶ）／ 偏差値の分布（塾内）（「先生から」の欄は置かない）
// 偏差値・県内順位・判定・合格確率は業者の値（県全体）。塾内の数字は、取り込んだ智翔館 中等部の行から計算する（lib/moshi/model.ts の kenStatsOf）。
// 氏名は本番レベル模試の名簿から「校舎＋受験番号」で引いたもの（県一斉模試の行は氏名を持たない）。

import { useMemo } from 'react';
import {
  KEN_MAX, KEN_SLOTS, STAT_KEYS, STAT_NAMES, SUBJECT_KEYS, campusInfo, devBinsOf, kenChoiceRank, kenExamRef, scoreBinsOf, trendRows,
  type ExamStats, type KenRow, type KenStats, type KenitsuResult, type StatKey,
} from '@/lib/moshi/model';
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
        {KEN_SLOTS.map((slot, i) => {
          const c = k.choices[i] ?? { code: '', name: '', judge: '', prob: '' };
          const name = c.name || (c.code ? schoolName(c.code) : '');
          const cr = kenChoiceRank(ks, row, c.code);
          return (
            <div key={slot} className="rs-judge rs-ken-judge">
              <div className="rs-j-head">
                <span>{slot.replace('・', '')}</span>
                <b>{c.code}</b>
                <span>{name}</span>
              </div>
              <div className="rs-j-grade">
                <span>判定</span><span className="rs-j-box">{c.judge}</span>
                <span>合格確率</span><span className="rs-ken-prob">{c.prob}</span>
                {cr && <span className="rs-j-inside">塾内の志望者 {cr.n}人中 {cr.rank}位</span>}
              </div>
            </div>
          );
        })}
      </section>

      {/* ---- 中 ---- */}
      <section className="rs-col">
        <div className="rs-pill rs-pill-orange">得点の分布<small className="rs-pill-note">5教科・塾内</small></div>
        <ScoreDist bins={scoreBinsOf(totals, k.stats.k5?.score ?? null, KEN_MAX.k5)} />
        <div className="rs-pill rs-pill-blue">教科のバランス</div>
        <Radar
          mine={SUBJECT_KEYS.map((key) => k.stats[key]?.score ?? null)}
          avg={SUBJECT_KEYS.map((key) => ks.mean[key])}
          max={SUBJECT_KEYS.map((key) => KEN_MAX[key])}
          avgLabel="塾内平均"
        />
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
      </section>

      <footer className="rs-foot">
        {`得点・偏差値・県内順位・判定・合格確率は${exam.name}の集計（県全体）の値。塾内順位・塾内平均・分布は、この回を受けた智翔館 中等部の生徒（5教科 ${ks.n.k5}人）の中でのもの。`}
      </footer>
    </article>
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
