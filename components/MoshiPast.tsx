'use client';

// 本番レベル模試の「過去の実施データ」（同じ問題を前に県全体で実施したときの集計。lib/moshi/pastData.ts）を画面に出す部品。
//   ・県内順位（推定）：度数分布から、その得点より上の人数＋1（lib/moshi/pastData.ts の pastRank）
//   ・県全体の得点の分布：帳票の度数分布表と同じきざみ（五教科25点・三教科15点・教科5点）で、本人の階級に色を付ける
//   ・設問別の県平均：回の大問と実施データの設問が合う教科だけ（社会の「1・2」のように2つの大問で1行のときは2行ぶんにまたがる）
// 回の設定の outside.ref で結ぶ（「模試の設定」の［この実施データを使う］）。
// 大問が資料と合わない教科（問題が違う教科。2026年11月は数学）は資料を使わず、この回の結果（智翔館の受験者）だけで出す（pastUses）。

import {
  SUBJECT_KEYS, subjectOf,
  type Bin, type MoshiExam, type StatKey, type SubjectKey,
} from '@/lib/moshi/model';
import { matchPastQuestions, pastBinOf, pastBinRange, pastExamById, pastMax, pastN, pastRank, pastUsesKey, type PastExam } from '@/lib/moshi/pastData';
import { ScoreDist } from './MoshiReportSheet';

/** 回に結んである過去の実施データ。 */
export function pastOf(exam: MoshiExam): PastExam | undefined {
  return pastExamById(exam.outside?.ref);
}

/** その項目に資料を使うか（三教科・五教科はいつも。教科は大問が資料と合うときだけ）。 */
export function pastUses(exam: MoshiExam, p: PastExam | undefined, key: StatKey): boolean {
  return !!p && pastUsesKey(exam.subjects, p, key);
}

/** 実施年月の短い書き方（例「2023年10月」）。 */
export function pastWhen(p: PastExam): string {
  const m = /^(\d{4})-(\d{2})$/.exec(p.held);
  return m ? `${m[1]}年${Number(m[2])}月` : p.held;
}

/** 県全体の得点の分布（高い点から。ScoreDist にそのまま渡せる形）。 */
export function pastDistBins(p: PastExam, key: StatKey, score: number | null): Bin[] {
  const step = p.step[key];
  const bins = p.bins[key];
  const mine = score == null ? -1 : Math.min(bins.length - 1, pastBinOf(step, score));
  const out: Bin[] = [];
  for (let i = bins.length - 1; i >= 0; i--) {
    const [lo, hi] = pastBinRange(step, i);
    out.push({ label: `${lo}～${hi}`, count: bins[i], mine: i === mine });
  }
  return out;
}

/** 県内順位（推定）の文字（例「約 52位 / 793人」）。出せなければ ''。 */
export function pastRankText(p: PastExam | undefined, key: StatKey, score: number | null, max: number): string {
  if (!p) return '';
  const r = pastRank(p, key, score, max);
  return r ? `約 ${r.rank}位 / ${r.n}人` : '';
}

export type PastQCell = { rate: number; span: number } | 'skip';

/**
 * 設問別の県平均：教科ごと・回の大問ごとに、県平均の得点率（%）と、何行ぶんにまたがるか。
 * またがる行の2行目からは 'skip'（その行には県平均のセルを置かない）。大問が合わない教科は null。
 */
export function pastQuestionCells(exam: MoshiExam, p: PastExam | undefined): Record<SubjectKey, PastQCell[] | null> | null {
  if (!p) return null;
  const out = {} as Record<SubjectKey, PastQCell[] | null>;
  for (const k of SUBJECT_KEYS) {
    const qs = subjectOf(exam, k).questions;
    const groups = matchPastQuestions(qs.map((q) => q.max), p.questions[k]);
    if (!groups) { out[k] = null; continue; }
    const cells: PastQCell[] = qs.map(() => 'skip');
    groups.forEach((g, gi) => { cells[g[0]] = { rate: p.questions[k][gi].rate, span: g.length }; });
    out[k] = cells;
  }
  return SUBJECT_KEYS.some((k) => out[k]) ? out : null;
}

const DIST_KEYS: StatKey[] = ['k5', 'k3', 'ja', 'en', 'ma', 'so', 'sc'];
const DIST_NAME: Record<StatKey, string> = { k5: '五教科', k3: '三教科', ja: '国語', en: '英語', ma: '数学', so: '社会', sc: '理科' };

/** この回の結果（智翔館の受験者）での分布。資料を使わない教科に出す。 */
export type OwnDist = { bins: Bin[]; n: number; mean: number | null; rank: number | null };

/**
 * 面談の画面の「県全体の得点の分布」：7つのグラフ（本人の階級に色）と県内順位（推定）。
 * 資料を使わない教科（大問が合わない教科）は、この回の結果の分布と塾内順位を出す（own）。
 */
export function PastDistView({ exam, past, scores, maxes, own }: {
  exam: MoshiExam;
  past: PastExam;
  scores: Partial<Record<StatKey, number | null>>;
  maxes: Partial<Record<StatKey, number>>;
  own: Partial<Record<StatKey, OwnDist>>;
}) {
  const selfKeys = DIST_KEYS.filter((k) => !pastUses(exam, past, k));
  return (
    <>
      <h3 className="kd-h">県全体の得点の分布</h3>
      <p className="kd-note">
        この問題を{pastWhen(past)}に県全体で受けた人（{past.label}・全県 {pastN(past, 'k5')}人）の得点の分布です。色の付いた棒が、この生徒の得点の階級。
      </p>
      <div className="kd-dist">
        {DIST_KEYS.map((k) => {
          const score = scores[k] ?? null;
          const o = own[k];
          if (!pastUses(exam, past, k)) {
            return (
              <figure key={k} className="kd-dist-one kd-dist-self">
                <figcaption>
                  <b>{DIST_NAME[k]}</b>
                  <span>今回の平均 {o?.mean != null ? `${o.mean.toFixed(1)}点` : '—'}</span>
                  {score != null && o?.rank != null && <span className="kd-dist-rank">{score}点：塾内 {o.rank}位 / {o.n}人</span>}
                </figcaption>
                {o ? <ScoreDist bins={o.bins} label={`${DIST_NAME[k]}の今回の得点の分布`} /> : <p className="kd-note">まだ得点がありません。</p>}
                <p className="kd-dist-src">この回の結果（智翔館 {o?.n ?? 0}人）</p>
              </figure>
            );
          }
          const ok = maxes[k] == null || maxes[k] === pastMax(past, k);
          return (
            <figure key={k} className="kd-dist-one">
              <figcaption>
                <b>{DIST_NAME[k]}</b>
                <span>県平均 {past.mean[k].toFixed(1)}点</span>
                {ok && score != null && <span className="kd-dist-rank">{score}点：県内 {pastRankText(past, k, score, maxes[k] ?? pastMax(past, k))}</span>}
              </figcaption>
              {ok ? <ScoreDist bins={pastDistBins(past, k, score)} label={`${DIST_NAME[k]}の県全体の得点の分布`} /> : <p className="kd-note">この回の満点が違うので出しません。</p>}
            </figure>
          );
        })}
      </div>
      <p className="kd-note">
        県内順位（推定）は、度数分布から出した目安です（同じ階級の中の人数は、となりの階級に合わせてなだらかに分けて数えます。{pastWhen(past)}の受験者の中での位置）。
        {selfKeys.length > 0 && `${selfKeys.map((k) => DIST_NAME[k]).join('・')}は問題が資料と違うので、この回を受けた智翔館の受験者の分布と塾内順位です。`}
      </p>
    </>
  );
}
