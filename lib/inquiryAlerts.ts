// 問合せ管理（/inquiry-board）の画面上部に出すアラート。
//
// 2段構え：
//   1. ルール（このファイル）… 台帳から機械的に数えた「事実」と、そこから決まる注意喚起。
//      AI が無くても必ず出る。件数は AI に数えさせず、ここで数えた数字を正とする（問い合わせQAと同じ考え方）。
//   2. AI（app/api/inquiry-board/alerts/route.ts）… 事実を渡して「今日まず何をすべきか」を短い文にする。
//      ANTHROPIC_API_KEY が無い・失敗した場合はルールだけで表示する。
//
// ★閾値（何日で「滞留」とみなすか等）はこのファイル冒頭の THRESHOLDS で調整する。

import {
  isOverdue, isUntouched, normalizeMark, parseIso, statusOf, ymOf,
  type InquiryRecord,
} from './inquiryRecords';
import { goalsFor, sameCampus, type GoalRow, type GoalView } from './goals';

export const THRESHOLDS = {
  untouchedDays: 2,      // 問い合わせから何日たっても連絡が無ければ「未着手」として警告するか
  trialNoResultDays: 7,  // 体験実施から何日たっても結果が無ければ「体験後フォロー漏れ」とするか
  meetingNoResultDays: 7,// 面談から何日たっても結果が無ければ「面談後フォロー漏れ」とするか
  staleOpenDays: 30,     // 問い合わせから何日以上「追客中」のままなら「長期滞留」とするか
  maxNames: 5,           // アラート1件に並べる人数の上限
};

export type AlertLevel = 'danger' | 'warn' | 'info' | 'good';

/** 画面のチップ1つ。filter を持つものは押すと一覧をその区分で絞り込む。 */
export type Alert = {
  level: AlertLevel;
  text: string;
  filter?: 'untouched' | 'overdue' | 'open' | 'joined';
};

export type KpiLine = {
  metric: string;
  actual: number;
  target: number | null;
  source: string; // 実績の出所（台帳の入塾日／体験日 など）
};

type Ref = { campus: string; no: number; name: string; days: number };

/** ルールで数えた事実。AI にはこれをそのまま文章化して渡す。 */
export type AlertFacts = {
  scope: string;            // 校舎名 or 'すべて'
  today: string;            // YYYY-MM-DD
  monthLabel: string;       // 2026年9月
  kpis: KpiLine[];          // 今月入会・体験授業（目標があれば対比）
  inquiriesThisMonth: number;
  inquiriesPrevMonth: number;
  open: number;
  untouched: Ref[];
  overdue: Ref[];
  trialNoResult: Ref[];
  meetingNoResult: Ref[];
  staleOpen: Ref[];
  enrollMissingDate: number; // 結果=入塾なのに入塾日が空
};

function daysBetween(a: string, b: string): number {
  const pa = parseIso(a);
  const pb = parseIso(b);
  if (!pa || !pb) return 0;
  const da = Date.UTC(pa.y, pa.m - 1, pa.d);
  const db = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((db - da) / 86400000);
}

function maskName(s: string): string {
  const t = (s || '').replace(/[\s　]/g, '');
  return t ? t.charAt(0) + '○' : '';
}

function ref(r: InquiryRecord, sinceDate: string, today: string): Ref {
  return { campus: r.campus, no: r.no, name: maskName(r.studentName), days: daysBetween(sinceDate, today) };
}

function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function ymLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
}

/**
 * 台帳の行から事実を数える。rows は表示中の校舎に絞った行（「すべて」なら全行）。
 * goals は秋～冬行動計画の目標（無ければ空配列）。
 */
export function buildFacts(rows: InquiryRecord[], scope: string, today: string, goals: GoalRow[]): AlertFacts {
  const ym = today.slice(0, 7);
  const pym = prevYm(ym);
  const month = Number(ym.split('-')[1]);

  let inquiriesThisMonth = 0;
  let inquiriesPrevMonth = 0;
  let enrollThisMonth = 0;
  let trialsThisMonth = 0;
  let open = 0;
  let enrollMissingDate = 0;
  const untouched: Ref[] = [];
  const overdue: Ref[] = [];
  const trialNoResult: Ref[] = [];
  const meetingNoResult: Ref[] = [];
  const staleOpen: Ref[] = [];

  for (const r of rows) {
    const dym = ymOf(r.date);
    if (dym === ym) inquiriesThisMonth++;
    else if (dym === pym) inquiriesPrevMonth++;

    const st = statusOf(r.result);
    if (st === 'joined') {
      if (!r.enrollDate) enrollMissingDate++;
      else if (ymOf(r.enrollDate) === ym) enrollThisMonth++;
    }
    if (r.trialDate && ymOf(r.trialDate) === ym && normalizeMark(r.trial) !== '✕') trialsThisMonth++;

    if (st !== 'open') continue;
    open++;
    if (isOverdue(r, today)) overdue.push(ref(r, r.closeDate, today));
    if (isUntouched(r) && parseIso(r.date) && daysBetween(r.date, today) >= THRESHOLDS.untouchedDays) {
      untouched.push(ref(r, r.date, today));
    }
    if (normalizeMark(r.trial) === '〇' && parseIso(r.trialDate) && daysBetween(r.trialDate, today) >= THRESHOLDS.trialNoResultDays) {
      trialNoResult.push(ref(r, r.trialDate, today));
    }
    if (parseIso(r.meetingDate) && daysBetween(r.meetingDate, today) >= THRESHOLDS.meetingNoResultDays) {
      meetingNoResult.push(ref(r, r.meetingDate, today));
    }
    if (parseIso(r.date) && daysBetween(r.date, today) >= THRESHOLDS.staleOpenDays) {
      staleOpen.push(ref(r, r.date, today));
    }
  }
  const byDays = (a: Ref, b: Ref) => b.days - a.days;
  untouched.sort(byDays); overdue.sort(byDays); trialNoResult.sort(byDays); meetingNoResult.sort(byDays); staleOpen.sort(byDays);

  // 目標：校舎が1つならその校舎、「すべて」なら「中等部」（4校舎合計）の行。無ければ目標無しで出す。
  const goalCampus = scope === 'すべて' ? '中等部' : scope;
  const views: GoalView[] = goals.length ? goalsFor(goals, month, goalCampus, trialsThisMonth) : [];
  const target = (m: string) => views.find((v) => v.metric.includes(m))?.target ?? null;
  const kpis: KpiLine[] = [
    { metric: '今月入会', actual: enrollThisMonth, target: target('入会'), source: '台帳の入塾日' },
    { metric: '体験授業', actual: trialsThisMonth, target: target('体験'), source: '台帳の体験日' },
  ];
  // 行動計画にある他の指標（模試など）は手入力値をそのまま添える
  for (const v of views) {
    if (v.metric.includes('入会') || v.metric.includes('体験')) continue;
    if (v.target == null && v.actual == null) continue;
    kpis.push({ metric: v.metric, actual: v.actual ?? 0, target: v.target, source: '行動計画の手入力' });
  }

  return {
    scope, today, monthLabel: ymLabel(ym), kpis,
    inquiriesThisMonth, inquiriesPrevMonth, open,
    untouched, overdue, trialNoResult, meetingNoResult, staleOpen, enrollMissingDate,
  };
}

function names(list: Ref[], scopeAll: boolean, withDays = true): string {
  const head = list.slice(0, THRESHOLDS.maxNames).map((x) => {
    const who = `${scopeAll ? x.campus + ' ' : ''}#${x.no}${x.name ? ' ' + x.name : ''}`;
    return withDays ? `${who}（${x.days}日）` : who;
  });
  const rest = list.length > THRESHOLDS.maxNames ? ` ほか${list.length - THRESHOLDS.maxNames}件` : '';
  return head.join('、') + rest;
}

/** 事実 → 画面のチップ。重いものから順に並べる。 */
export function ruleAlerts(f: AlertFacts): Alert[] {
  const all = f.scope === 'すべて';
  const out: Alert[] = [];

  if (f.overdue.length) {
    out.push({ level: 'danger', filter: 'overdue', text: `クローズ予定日を過ぎて結果が未記入：${f.overdue.length}件。${names(f.overdue, all)}` });
  }
  if (f.untouched.length) {
    out.push({ level: 'danger', filter: 'untouched', text: `問い合わせから${THRESHOLDS.untouchedDays}日以上、連絡が未記入：${f.untouched.length}件。${names(f.untouched, all)}` });
  }
  if (f.trialNoResult.length) {
    out.push({ level: 'warn', filter: 'open', text: `体験から${THRESHOLDS.trialNoResultDays}日以上たって結果が未記入：${f.trialNoResult.length}件。${names(f.trialNoResult, all)}` });
  }
  if (f.meetingNoResult.length) {
    out.push({ level: 'warn', filter: 'open', text: `面談から${THRESHOLDS.meetingNoResultDays}日以上たって結果が未記入：${f.meetingNoResult.length}件。${names(f.meetingNoResult, all)}` });
  }
  for (const k of f.kpis) {
    if (k.target == null || k.target <= 0) continue;
    if (k.actual >= k.target) out.push({ level: 'good', text: `${f.monthLabel}の${k.metric}は目標達成（${k.actual}/${k.target}）` });
    else out.push({ level: 'warn', filter: k.metric === '今月入会' ? 'joined' : undefined, text: `${f.monthLabel}の${k.metric}：${k.actual}/${k.target}（あと${k.target - k.actual}）` });
  }
  if (f.staleOpen.length) {
    out.push({ level: 'info', filter: 'open', text: `問い合わせから${THRESHOLDS.staleOpenDays}日以上「追客中」のまま：${f.staleOpen.length}件。結果を決めるか、クローズ予定日を入れる` });
  }
  if (f.enrollMissingDate) {
    out.push({ level: 'info', filter: 'joined', text: `結果が入塾なのに入塾日が空：${f.enrollMissingDate}件。入れると「今月入会」に数えられる` });
  }
  if (!out.length) {
    out.push({ level: 'good', text: `滞留・未着手はありません。${f.monthLabel}の問い合わせ ${f.inquiriesThisMonth}件（前月 ${f.inquiriesPrevMonth}件）` });
  }
  return out;
}

/** AI に渡す事実の文章。個人名はマスク済み（1文字＋○）。 */
export function formatFactsForAi(f: AlertFacts): string {
  const all = f.scope === 'すべて';
  const kpi = f.kpis.map((k) => `${k.metric}: 実績${k.actual}${k.target != null ? `／目標${k.target}` : '（目標なし）'}（出所:${k.source}）`).join('\n');
  const list = (label: string, l: Ref[]) => `${label}: ${l.length}件${l.length ? ' ' + names(l, all) : ''}`;
  return [
    `対象: ${f.scope}　本日: ${f.today}　対象月: ${f.monthLabel}`,
    '【KPI】',
    kpi,
    `問い合わせ件数: 今月${f.inquiriesThisMonth}件 ／ 前月${f.inquiriesPrevMonth}件`,
    `追客中（結果未記入）: ${f.open}件`,
    '【滞留】',
    list(`クローズ予定日超過`, f.overdue),
    list(`未着手（${THRESHOLDS.untouchedDays}日以上連絡なし）`, f.untouched),
    list(`体験後${THRESHOLDS.trialNoResultDays}日以上結果なし`, f.trialNoResult),
    list(`面談後${THRESHOLDS.meetingNoResultDays}日以上結果なし`, f.meetingNoResult),
    list(`${THRESHOLDS.staleOpenDays}日以上追客中`, f.staleOpen),
    `入塾なのに入塾日が空: ${f.enrollMissingDate}件`,
  ].join('\n');
}

/** キャッシュのキー。行の更新があれば変わる。 */
export function factsFingerprint(rows: InquiryRecord[], scope: string, today: string): string {
  let latest = '';
  for (const r of rows) if (r.updatedAt > latest) latest = r.updatedAt;
  return `${scope}|${today}|${rows.length}|${latest}`;
}

export { sameCampus };
