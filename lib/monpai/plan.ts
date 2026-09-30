// 門配管理：AIによる月間計画の案づくり。サーバ専用。
//
// 数字（ボトム・計画済み・残り必要数）はコードで計算し、AI には数えさせない。
// AI に任せるのは「どの日に・どの学校へ・誰が・何部」の割り振りと、その理由だけ。
// 返ってきた案はコードで検査し（地区外の学校・土日・過去の日付・既存の予定との重複などを落とす）、
// 画面で担当者が選んでから登録する。AI の案がそのまま保存されることはない。

import Anthropic from '@anthropic-ai/sdk';
import { withCompanyKnowledge } from '../core/companyKnowledge';
import { MODEL, THINKING } from '../systemPrompt';
import { historyLine, summarizeHistory } from './history';
import {
  bottomOf, daysOf, shiftMonth, todayJst, weekOf,
  type MonpaiRecord, type MonthSetting, type School,
} from './model';

/** 計画案の根拠にする実績の期間（対象月の前の何か月分） */
export const HISTORY_MONTHS = 6;

const client = new Anthropic();

export type PlanItem = {
  date: string;
  time: string;
  school: string;
  staff1: string;
  staff2: string;
  material: string;
  planned: number;
  why: string;
};

export type PlanResult =
  | { ok: true; summary: string; items: PlanItem[]; dropped: number; basis: { months: number; visits: number; staff: number } }
  | { ok: false; reason: string };

const SYSTEM = `
あなたは株式会社智翔館の門配（校門前でのチラシ配布）の月間計画を立てる担当です。
地区の担当者が、あなたの案を見て直してから確定します。現実的に実行できる案を出してください。

【考え方】
- 目的は、各学校のボトム（月の最低配布数）を月末までに確実に満たすこと。残り必要数が大きい学校から優先する。
- いちばんの根拠は【これまでの実績（学校ごと）】。その学校で受け取りの良かった曜日・時間・担当者を優先して選ぶ。
- 1回の部数は、その学校の「1回の計画の中央値」前後にする。実績が無い学校は30〜50部。
- 受け取り率が低い学校（おおむね70%未満）は、計画どおり配っても実績がボトムに届かない。
  【学校ごとのボトムと残り必要数】の「実績見込みでの不足」を満たすよう、回数を増やす（1回の部数を増やすより回数）。
- 「0部だった回」の理由（雨天・下校時刻の読み違い・入塾面談など）を見て、同じ失敗を避ける（時間を変える・予備日を置く）。
- 平日（月〜金）の下校時刻に行う。実績に時間があればそれに合わせる。無ければ中学校16:00〜17:30、小学校14:30〜15:30。
- 同じ担当者に同じ日に2校以上を割り当てない。1人に予定が偏らないよう分散させる。
- 月末に詰め込まず、月の前半から計画的に配置する。定期テスト前・行事の日が分かっていれば避ける。
- 担当者は【担当者の候補】（この地区で門配をしたことがある人）からだけ選ぶ。その学校の実績の「担当」に名前がある人を優先する。
  候補がいない・ふさわしい人がいないときは staff1・staff2 を空欄にする（担当未定。配ったことのない人や、名前を作ることはしない）。
- 配布物は【配布物】の品名から選ぶ。無ければ空欄。

【出力】次の JSON だけを出力する（前後に説明文やコードブロックの記号を付けない）。
{"summary":"計画の要点を2〜3文で（どの実績を根拠にしたか）","items":[{"date":"YYYY-MM-DD","time":"16:00-17:00","school":"学校名","staff1":"担当","staff2":"","material":"品名","planned":50,"why":"この日・時間・担当にした理由を、実績の数字を挙げて1文で（例：火曜17:30は平均48部で最も受け取りが良い）"}]}
`.trim();

function recordLine(r: MonpaiRecord): string {
  const res = r.status === '中止' ? `中止（${r.reason}）` : r.done != null ? `実施${r.done}部` : '未報告';
  const extra = [r.reason && r.status !== '中止' ? `理由:${r.reason}` : '', r.memo ? `反応:${r.memo}` : ''].filter(Boolean).join(' ');
  return `- ${r.date}(${weekOf(r.date)}) ${r.time || '時間不明'} ${r.school} 担当:${[r.staff1, r.staff2].filter(Boolean).join('・') || '不明'} 計画${r.planned}部 ${res} ${extra}`.trim();
}

export function buildFacts(args: {
  district: string;
  month: string;
  schools: School[];
  settings: MonthSetting[];
  records: MonpaiRecord[]; // 今月と、その前の HISTORY_MONTHS か月
  materials: string[];
  staff: string[];
  from: string; // この日以降に計画する
}): { text: string; need: Record<string, number>; basis: { months: number; visits: number; staff: number } } {
  const { district, month, schools, settings, records, materials, staff, from } = args;
  const start = `${shiftMonth(month, -HISTORY_MONTHS)}-01`;
  const cur = records.filter((r) => r.district === district && r.date.startsWith(month));
  const past = records.filter((r) => r.district === district && r.date >= start && r.date < `${month}-01`);
  const history = summarizeHistory(past, schools);
  const need: Record<string, number> = {};

  const schoolLines = schools.map((s) => {
    const b = bottomOf(s, settings, month);
    const planned = cur.filter((r) => r.school === s.name && r.status !== '中止').reduce((a, r) => a + r.planned, 0);
    need[s.name] = Math.max(0, b.bottom - planned);
    const rate = history.find((h) => h.school === s.name)?.rate;
    // 受け取り率から見た実績の見込み（計画済み×受け取り率）と、ボトムまでの不足
    const expect = rate == null ? null : Math.round(planned * rate);
    const gap = expect == null ? '' : ` 実績見込み${expect}部 → 実績見込みでの不足${Math.max(0, b.bottom - expect)}部`;
    return `- ${s.name}（${s.kind}学校・生徒数${s.students}）ボトム${b.bottom}部（${Math.round(b.rate * 100)}%${b.recruit ? '・募集期' : ''}） 計画済み${planned}部 → 残り必要${need[s.name]}部${gap}`;
  });
  // 生の記録は直近の報告済み40件だけ（曜日・時間の書き方の参考）
  const recent = past.filter((r) => r.done != null || r.status === '中止').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40).reverse();
  const months = new Set(past.map((r) => r.date.slice(0, 7))).size;
  const days = daysOf(month).filter((d) => d.date >= from && !d.holiday).map((d) => `${d.day}(${d.week})`);

  const text = [
    `【対象】${district}地区 ${month.replace('-', '年')}月`,
    `【計画してよい日】${days.join(' ') || 'なし'}`,
    `【学校ごとのボトムと残り必要数】\n${schoolLines.join('\n')}`,
    `【これまでの実績（学校ごと・${start.slice(0, 7)}〜${shiftMonth(month, -1)}、コードで集計）】\n${history.map(historyLine).join('\n')}`,
    `【今月すでに入っている予定（重ねない）】\n${cur.map(recordLine).join('\n') || 'なし'}`,
    `【直近の記録（参考）】\n${recent.map(recordLine).join('\n') || 'なし'}`,
    `【担当者の候補（この地区で門配をしたことがある人）】${staff.join('、') || 'なし（担当はすべて空欄＝未定にする）'}`,
    `【配布物】${materials.join('、') || 'なし（空欄にする）'}`,
  ].join('\n\n');
  return { text, need, basis: { months, visits: history.reduce((a, h) => a + h.visits, 0), staff: staff.length } };
}

function parseJson(text: string): { summary?: unknown; items?: unknown } | null {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** AI の案を検査して、実行できるものだけ残す。 */
export function sanitizePlan(
  raw: unknown,
  ctx: { month: string; from: string; schools: School[]; existing: MonpaiRecord[]; staff: string[]; materials: string[] },
): { items: PlanItem[]; dropped: number } {
  const list = Array.isArray(raw) ? raw.slice(0, 80) : [];
  const names = new Set(ctx.schools.map((s) => s.name));
  const taken = new Set(ctx.existing.filter((r) => r.status !== '中止').map((r) => `${r.date}|${r.school}`));
  const staffBusy = new Set<string>();
  const valid = new Set(daysOf(ctx.month).filter((d) => d.date >= ctx.from && !d.holiday).map((d) => d.date));
  const known = (list: string[], v: string) => (list.includes(v) ? v : '');
  const items: PlanItem[] = [];

  for (const x of list as Record<string, unknown>[]) {
    const date = String(x?.date ?? '');
    const school = String(x?.school ?? '');
    const planned = Math.round(Number(x?.planned));
    if (!valid.has(date) || !names.has(school) || !(planned > 0 && planned <= 1000)) continue;
    if (taken.has(`${date}|${school}`)) continue;
    const staff1 = known(ctx.staff, String(x?.staff1 ?? '').trim());
    const staff2 = known(ctx.staff, String(x?.staff2 ?? '').trim());
    // 同じ人が同じ日に2校にならないようにする（2校目は担当を空欄にして残す）
    const busy = [staff1, staff2].some((s) => s && staffBusy.has(`${date}|${s}`));
    taken.add(`${date}|${school}`);
    [staff1, staff2].forEach((s) => s && staffBusy.add(`${date}|${s}`));
    items.push({
      date, school, planned,
      time: String(x?.time ?? '').slice(0, 40),
      staff1: busy ? '' : staff1,
      staff2: busy ? '' : staff2,
      material: known(ctx.materials, String(x?.material ?? '').trim()),
      why: String(x?.why ?? '').slice(0, 200),
    });
  }
  items.sort((a, b) => (a.date + a.school).localeCompare(b.date + b.school));
  return { items, dropped: list.length - items.length };
}

export async function draftPlan(args: {
  district: string;
  month: string;
  schools: School[];
  settings: MonthSetting[];
  records: MonpaiRecord[];
  materials: string[];
  staff: string[];
}): Promise<PlanResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'ai_not_configured' };
  const today = todayJst();
  const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const from = `${args.month}-01` > tomorrow ? `${args.month}-01` : tomorrow;
  const { text, basis } = buildFacts({ ...args, from });

  let out = '';
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: THINKING,
      system: [{ type: 'text', text: withCompanyKnowledge(SYSTEM), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: text }],
    });
    if (res.stop_reason === 'refusal') return { ok: false, reason: 'ai_refused' };
    out = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (res.stop_reason === 'max_tokens') console.log('[monpai-plan] max_tokens に達した', args.district, args.month);
  } catch (err) {
    console.log('[monpai-plan] ai failed', err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : String(err));
    return { ok: false, reason: 'ai_error' };
  }

  const j = parseJson(out);
  if (!j) return { ok: false, reason: 'ai_bad_output' };
  const existing = args.records.filter((r) => r.district === args.district && r.date.startsWith(args.month));
  const { items, dropped } = sanitizePlan(j.items, {
    month: args.month, from, schools: args.schools, existing, staff: args.staff, materials: args.materials,
  });
  return { ok: true, summary: String(j.summary ?? '').slice(0, 500), items, dropped, basis };
}
