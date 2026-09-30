// 門配管理：これまでの実績を学校ごとにまとめる（AI の計画案の根拠にする）。
//
// 数字はすべてコードで数える。AI に渡すのは、この集計の結果（受け取り率・曜日・時間・担当・0部の理由）だけ。

import { weekOf, type MonpaiRecord, type School } from './model';

export type SchoolHistory = {
  school: string;
  visits: number;       // 実施を報告した回数（中止・0部も含む）
  planned: number;      // その回の計画の合計
  done: number;         // 実施の合計
  rate: number | null;  // 受け取り率（実施÷計画）。計画が0なら null
  median: number;       // 1回あたりの計画部数（中央値）
  perMonth: number;     // 1か月あたりの回数（実施のあった月で平均）
  weekdays: { week: string; visits: number; avg: number }[];
  times: { time: string; visits: number; avg: number }[];
  staff: { name: string; visits: number; avg: number }[];
  zero: { count: number; reasons: string[] };
};

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** 「17:30-18:15」「15:15-」→「17:30」。読めなければ ''。 */
export function startTime(t: string): string {
  const m = /(\d{1,2})[:：](\d{2})/.exec(t || '');
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

function groupAvg<T extends string>(rows: { key: T; done: number }[], min: number) {
  const g = new Map<T, number[]>();
  rows.forEach((r) => { if (r.key) g.set(r.key, [...(g.get(r.key) ?? []), r.done]); });
  return Array.from(g, ([key, xs]) => ({ key, visits: xs.length, avg: avg(xs) }))
    .filter((x) => x.visits >= min)
    .sort((a, b) => b.avg - a.avg || b.visits - a.visits);
}

const names = (r: MonpaiRecord) =>
  Array.from(new Set([r.staff1, r.staff2].flatMap((s) => (s || '').split(/[、,，・\s]+/)).filter(Boolean)));

/** 報告済みの記録（実施の数がある・中止）だけを使って、学校ごとに集計する。 */
export function summarizeHistory(records: MonpaiRecord[], schools: School[]): SchoolHistory[] {
  return schools.map((s) => {
    const rs = records.filter((r) => r.school === s.name && (r.done != null || r.status === '中止'));
    const done = (r: MonpaiRecord) => (r.status === '中止' ? 0 : r.done ?? 0);
    const planned = rs.reduce((a, r) => a + r.planned, 0);
    const total = rs.reduce((a, r) => a + done(r), 0);
    const months = new Set(rs.map((r) => r.date.slice(0, 7)));
    const zeros = rs.filter((r) => done(r) === 0);
    const reasons = new Map<string, number>();
    zeros.forEach((r) => { const k = (r.reason || '理由なし').slice(0, 30); reasons.set(k, (reasons.get(k) ?? 0) + 1); });
    const ok = rs.filter((r) => r.status !== '中止');
    return {
      school: s.name,
      visits: rs.length,
      planned,
      done: total,
      rate: planned > 0 ? total / planned : null,
      median: median(rs.map((r) => r.planned).filter((n) => n > 0)),
      perMonth: months.size ? Math.round((rs.length / months.size) * 10) / 10 : 0,
      weekdays: groupAvg(ok.map((r) => ({ key: weekOf(r.date), done: done(r) })), 2).map((x) => ({ week: x.key, visits: x.visits, avg: x.avg })),
      times: groupAvg(ok.map((r) => ({ key: startTime(r.time), done: done(r) })), 2).map((x) => ({ time: x.key, visits: x.visits, avg: x.avg })),
      // 担当は「中山、松田」のような2人書きも1人ずつ数え、経験の多い順（回数→平均部数）に並べる
      staff: groupAvg(ok.flatMap((r) => names(r).map((n) => ({ key: n, done: done(r) }))), 1)
        .sort((a, b) => b.visits - a.visits || b.avg - a.avg)
        .map((x) => ({ name: x.key, visits: x.visits, avg: x.avg })),
      zero: {
        count: zeros.length,
        reasons: Array.from(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => (n > 1 ? `${k}×${n}` : k)),
      },
    };
  });
}

/** AI に渡す1校1行の文。 */
export function historyLine(h: SchoolHistory): string {
  if (!h.visits) return `- ${h.school}：実績なし（前例が無いので、同じ地区のほかの学校を参考に控えめに）`;
  const rate = h.rate == null ? '' : `（受け取り率${Math.round(h.rate * 100)}%）`;
  const top = <T,>(xs: T[], f: (x: T) => string, n = 3) => xs.slice(0, n).map(f).join('、') || '偏りなし';
  return [
    `- ${h.school}：${h.visits}回 計画${h.planned}部→実施${h.done}部${rate}`,
    `1回の計画は中央値${h.median}部・月${h.perMonth}回`,
    `受け取りの良い曜日 ${top(h.weekdays, (w) => `${w.week}平均${w.avg}部(${w.visits}回)`)}`,
    `時間 ${top(h.times, (t) => `${t.time}〜平均${t.avg}部(${t.visits}回)`)}`,
    `担当 ${top(h.staff, (s) => `${s.name}${s.visits}回・平均${s.avg}部`)}`,
    h.zero.count ? `0部だった回 ${h.zero.count}回（${h.zero.reasons.join('、')}）` : '0部だった回 なし',
  ].join('／');
}
