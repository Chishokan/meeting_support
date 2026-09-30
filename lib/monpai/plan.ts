// 門配管理：AIによる月間計画の案づくり。サーバ専用。
//
// 数字（ボトム・計画済み・残り必要数）はコードで計算し、AI には数えさせない。
// AI に任せるのは「どの日に・どの学校へ・誰が・何部」の割り振りと、その理由だけ。
// 返ってきた案はコードで検査し（地区外の学校・土日・過去の日付・既存の予定との重複などを落とす）、
// 画面で担当者が選んでから登録する。AI の案がそのまま保存されることはない。

import Anthropic from '@anthropic-ai/sdk';
import { withCompanyKnowledge } from '../core/companyKnowledge';
import { MODEL, THINKING } from '../systemPrompt';
import {
  bottomOf, daysOf, shiftMonth, todayJst, weekOf,
  type MonpaiRecord, type MonthSetting, type School,
} from './model';

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

export type PlanResult = { ok: true; summary: string; items: PlanItem[]; dropped: number } | { ok: false; reason: string };

const SYSTEM = `
あなたは株式会社智翔館の門配（校門前でのチラシ配布）の月間計画を立てる担当です。
地区の担当者が、あなたの案を見て直してから確定します。現実的に実行できる案を出してください。

【考え方】
- 目的は、各学校のボトム（月の最低配布数）を月末までに確実に満たすこと。残り必要数が大きい学校から優先する。
- 1回の門配は1校・30〜60部が目安。前月までの実績で受け取りが良かった曜日・時間帯・担当者を参考にする。
- 平日（月〜金）の下校時刻に行う。中学校はおおむね16:00〜17:30、小学校は14:30〜15:30。前月の記録に時間があればそれに合わせる。
- 同じ担当者に同じ日に2校以上を割り当てない。1人に予定が偏らないよう分散させる。
- 月末に詰め込まず、月の前半から計画的に配置する。定期テスト前・行事の日が分かっていれば避ける。
- 担当者は【担当者の候補】から選ぶ。分からなければ空欄にする（人を作らない）。
- 配布物は【配布物】の品名から選ぶ。無ければ空欄。

【出力】次の JSON だけを出力する（前後に説明文やコードブロックの記号を付けない）。
{"summary":"計画の要点を2〜3文で","items":[{"date":"YYYY-MM-DD","time":"16:00-17:00","school":"学校名","staff1":"担当","staff2":"","material":"品名","planned":50,"why":"この日・この学校にした理由を1文で"}]}
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
  records: MonpaiRecord[]; // 今月と前月
  materials: string[];
  staff: string[];
  from: string; // この日以降に計画する
}): { text: string; need: Record<string, number> } {
  const { district, month, schools, settings, records, materials, staff, from } = args;
  const prev = shiftMonth(month, -1);
  const cur = records.filter((r) => r.district === district && r.date.startsWith(month));
  const past = records.filter((r) => r.district === district && r.date.startsWith(prev));
  const need: Record<string, number> = {};

  const schoolLines = schools.map((s) => {
    const b = bottomOf(s, settings, month);
    const planned = cur.filter((r) => r.school === s.name && r.status !== '中止').reduce((a, r) => a + r.planned, 0);
    need[s.name] = Math.max(0, b.bottom - planned);
    return `- ${s.name}（${s.kind}学校・生徒数${s.students}）ボトム${b.bottom}部（${Math.round(b.rate * 100)}%${b.recruit ? '・募集期' : ''}） 計画済み${planned}部 → 残り必要${need[s.name]}部`;
  });
  const days = daysOf(month).filter((d) => d.date >= from && !d.holiday).map((d) => `${d.day}(${d.week})`);

  const text = [
    `【対象】${district}地区 ${month.replace('-', '年')}月`,
    `【計画してよい日】${days.join(' ') || 'なし'}`,
    `【学校ごとのボトムと残り必要数】\n${schoolLines.join('\n')}`,
    `【今月すでに入っている予定（重ねない）】\n${cur.map(recordLine).join('\n') || 'なし'}`,
    `【前月の記録（参考）】\n${past.map(recordLine).join('\n') || 'なし'}`,
    `【担当者の候補】${staff.join('、') || 'なし（空欄にする）'}`,
    `【配布物】${materials.join('、') || 'なし（空欄にする）'}`,
  ].join('\n\n');
  return { text, need };
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
  const { text } = buildFacts({ ...args, from });

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
  return { ok: true, summary: String(j.summary ?? '').slice(0, 500), items, dropped };
}
