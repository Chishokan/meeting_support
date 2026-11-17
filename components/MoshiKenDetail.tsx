'use client';

// 県一斉模試の面談画面（詳細）。業者の成績の画面と同じように、生徒1人の詳しい成績をタブで切り替えて見せる。
//   成績一覧：今回の成績（得点・県平均・偏差値・偏差値グラフ・県内順位・塾内順位）／教科別レーダーチャート／教科別偏差値推移（表とグラフ）
//   志望校判定：4つの志望校の判定・合格確率。選んだ学校の判定教科・判定得点・判定偏差値・基準偏差値・基準まであと何点・塾内の志望者
//   過去テスト一覧：県一斉模試と本番レベル模試の回ごとの5教科（押すとその回に切り替わる）
//   成績表：印刷するのと同じ個人成績表（A4 横）
// 表・グラフの部品は components/MoshiDetailParts.tsx（本番レベル模試の面談と同じもの）。
// 県平均は取り込んだ得点と偏差値から計算する（lib/moshi/model.ts の kenFits。2026年10月は換算表の平均点と同じ）。
// 判定の中身は参考データ（lib/moshi/reference.ts）の判定基準から計算する。同じ年月の資料がある回だけ、判定偏差値と基準まであと何点を出す。

import { useMemo, useState } from 'react';
import {
  KEN_MAX, KEN_SLOTS, campusInfo, kenExamRef, kenFirstChoiceMean, kenFits, kenJudgeDetail, kenSchoolGroup, studentHistory, trendRows,
  type ExamStats, type KenRow, type KenStats, type KenitsuResult,
} from '@/lib/moshi/model';
import { REFERENCES, refSchoolByCode, referenceForDate } from '@/lib/moshi/reference';
import { schoolName } from '@/lib/moshi/schools';
import { FitSheet, f1 } from './MoshiReportSheet';
import { KenReportSheet } from './MoshiKenSheet';
import { NAME, NowTable, ORDER, PastTable, RADAR_ORDER, RadarMulti, TabBar, TrendView, n0 } from './MoshiDetailParts';

type Tab = 'score' | 'judge' | 'past' | 'sheet';
type Sub = 'now' | 'radar' | 'trend';
type Fits = ReturnType<typeof kenFits>;

export function KenDetail({ ks, row, kenitsu, statsList, onPick }: {
  ks: KenStats; row: KenRow; kenitsu: KenitsuResult[]; statsList: ExamStats[]; onPick: (kind: 'honban' | 'ken', id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('score');
  const [sub, setSub] = useState<Sub>('now');
  const fits = useMemo(() => kenFits(kenitsu, ks.exam.id), [kenitsu, ks.exam.id]);
  const k = row.k;
  const target = { name: row.name, examNo: k.examNo, campus: k.campus };
  const trend = useMemo(
    () => trendRows(statsList, kenExamRef(ks.exam), { name: row.name, examNo: k.examNo, campus: k.campus }, kenitsu),
    [statsList, ks.exam, row.name, k.examNo, k.campus, kenitsu],
  );
  return (
    <section className="kd">
      <div className="kd-head">
        <span>氏名：<b>{row.name || '（名簿に無い）'}</b>（受験番号：{k.examNo}）</span>
        <span className="kd-sub">智翔館 {campusInfo(k.campus)?.label ?? k.campus}・{ks.exam.name}{k.naishin ? `・内申点 ${k.naishin}` : ''}</span>
      </div>
      <TabBar<Tab> tabs={[['score', '成績一覧'], ['judge', '志望校判定'], ['past', '過去テスト一覧'], ['sheet', '成績表']]} value={tab} onChange={setTab} />
      {tab === 'score' && (
        <div className="kd-panel">
          <TabBar<Sub> sub tabs={[['now', '今回の成績'], ['radar', '教科別レーダーチャート'], ['trend', '教科別偏差値推移']]} value={sub} onChange={setSub} />
          {sub === 'now' && (
            <>
              <h3 className="kd-h">今回の成績</h3>
              <NowTable
                meanHead="県平均" rankHead="県内順位" insideHead="塾内順位"
                rows={ORDER.map((key) => ({
                  key, score: k.stats[key]?.score ?? null, max: KEN_MAX[key], mean: fits[key]?.mean ?? null, dev: k.stats[key]?.dev ?? null,
                  rank: k.stats[key]?.rank != null ? <><b>{n0(k.stats[key]?.rank)}</b><small> 位</small></> : '—',
                  inside: row.inside[key] != null ? <><b>{row.inside[key]}</b><small> 位 / {ks.n[key]}人中</small></> : '—',
                }))}
              />
              <p className="kd-note">
                得点・偏差値・県内順位は県一斉模試の集計（県全体）の値。県平均は、取り込んだ得点と偏差値から計算した県全体の平均点です
                （2026年10月の回は換算表の平均点と同じ）。塾内順位は、この回を受けた智翔館 中等部の生徒の中での順位です。
              </p>
            </>
          )}
          {sub === 'radar' && <KdRadar ks={ks} row={row} fits={fits} />}
          {sub === 'trend' && <TrendView trend={trend} />}
        </div>
      )}
      {tab === 'judge' && <div className="kd-panel"><KdJudge ks={ks} row={row} fits={fits} /></div>}
      {tab === 'past' && <div className="kd-panel"><PastTable entries={studentHistory(statsList, kenitsu, target, schoolName)} current={{ kind: 'ken', id: ks.exam.id }} onPick={onPick} /></div>}
      {tab === 'sheet' && <div className="kd-panel ms-interview-card"><FitSheet max={1.6}><KenReportSheet ks={ks} row={row} kenitsu={kenitsu} statsList={statsList} /></FitSheet></div>}
    </section>
  );
}

// ---- 教科別レーダーチャート ---------------------------------------------------------

function choiceOptions(row: KenRow) {
  return KEN_SLOTS.map((slot, i) => ({ slot, i, c: row.k.choices[i] })).filter((x) => x.c?.code);
}

function KdRadar({ ks, row, fits }: { ks: KenStats; row: KenRow; fits: Fits }) {
  const opts = choiceOptions(row);
  const [pick, setPick] = useState(0);
  const cur = opts[Math.min(pick, Math.max(0, opts.length - 1))];
  const code = cur?.c.code ?? '';
  const fc = useMemo(() => kenFirstChoiceMean(ks, code), [ks, code]);
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
      <RadarMulti series={[
        { id: 'me', label: 'あなたの得点率', color: '#3aa757', fill: 'rgba(58,167,87,.22)', vals: RADAR_ORDER.map((s) => row.k.stats[s]?.score ?? null) },
        { id: 'avg', label: '県平均の得点率', color: '#5bb6d9', fill: 'rgba(91,182,217,.16)', vals: RADAR_ORDER.map((s) => fits[s]?.mean ?? null) },
        ...(code && fc.n ? [{ id: 'fc', label: `塾内の第1志望者の得点率（${fc.n}人）`, color: '#e58ad0', fill: 'rgba(229,138,208,.14)', vals: RADAR_ORDER.map((s) => fc.mean[s]) }] : []),
      ]} />
      <p className="kd-note">県平均は県全体の平均点。第1志望者は、この学校を公立第1か国・私立第1に書いた智翔館の生徒（この回）の平均です。</p>
    </>
  );
}

// ---- 志望校判定 -----------------------------------------------------------------

function KdJudge({ ks, row, fits }: { ks: KenStats; row: KenRow; fits: Fits }) {
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
