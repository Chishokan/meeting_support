// 智翔館AI：会議の記録を読む・議題の追加の案を作る（Apps Script の一覧を呼ぶ）。サーバ専用。
// 文の組み立て・絞り込みは meetingRecords.ts。

import { STAFF } from '../core/staff';
import { callGas } from './gas';
import {
  checkAgendaInput,
  checkRecordsInput,
  deptMatch,
  formatMeetingRecords,
  pickAgendaTarget,
  type DecisionRec,
  type MinutesRec,
  type PreshareRec,
  type ShareRec,
} from './meetingRecords';

const s = (v: unknown) => String(v ?? '');

/** 部門の書き方をそろえる（「中等部」→「小中等部」、「RED」→「RED個別」、「総務」→「総務・人事・支援・管理」）。知らない名前はそのまま。 */
export function normalizeDept(dept: string): string {
  const d = String(dept ?? '').trim();
  return STAFF.map((g) => g.campus).find((c) => c === d) ?? STAFF.map((g) => g.campus).find((c) => deptMatch(c, d)) ?? d;
}
const items = (j: Record<string, unknown>) => (Array.isArray(j.items) ? (j.items as Record<string, unknown>[]) : []);

/** 日本時間の今日（'YYYY-MM-DD'）。 */
export function todayJst(now = new Date()): string {
  const t = new Date(now.getTime() + 9 * 3_600_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export async function listPreshares(signal?: AbortSignal): Promise<{ ok: true; rows: PreshareRec[] } | { ok: false; why: string }> {
  const j = await callGas({ action: 'listDeptPreshare' }, signal);
  if (!j.ok) return { ok: false, why: '部門会議の事前共有を読めませんでした' };
  return {
    ok: true,
    rows: items(j).map((r) => ({ id: s(r.id), ts: s(r.ts), campus: s(r.campus), user: s(r.user), title: s(r.title), date: s(r.date), place: s(r.place), agenda: s(r.agenda), minutesId: s(r.minutesId) })),
  };
}

/** get_meeting_records：4つのシートを読み、絞り込んだ文を返す。 */
export async function runMeetingRecords(input: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; note: string }> {
  const o = checkRecordsInput(input);
  const need = (w: string) => o.what === 'all' || o.what === w;
  const [jm, jd, jp, js] = await Promise.all([
    need('todos') || need('minutes') ? callGas({ action: 'listDeptMinutes' }, signal) : Promise.resolve({ ok: true, items: [] }),
    need('decisions') ? callGas({ action: 'listDeptDecisions' }, signal) : Promise.resolve({ ok: true, items: [] }),
    need('agenda') ? callGas({ action: 'listDeptPreshare' }, signal) : Promise.resolve({ ok: true, items: [] }),
    need('share') ? callGas({ action: 'listShareItems' }, signal) : Promise.resolve({ ok: true, items: [] }),
  ]);
  const failed = [
    !jm.ok ? '部門会議議事録' : '',
    !jd.ok ? '部門決定事項' : '',
    !jp.ok ? '部門会議事前共有' : '',
    !js.ok ? '事前共有事項' : '',
  ].filter(Boolean);
  if (failed.length === 4) return { text: '会議の記録を読めませんでした（Apps Script との通信に失敗しました）。職員にそのことを伝える。', note: '読めず' };
  const data = {
    minutes: items(jm).map((r): MinutesRec => ({ id: s(r.id), ts: s(r.ts), campus: s(r.campus), user: s(r.user), title: s(r.title), date: s(r.date), attendees: s(r.attendees), agenda: s(r.agenda), minutes: s(r.minutes) })),
    decisions: items(jd).map((r): DecisionRec => ({ ts: s(r.ts), campus: s(r.campus), meeting: s(r.meeting), date: s(r.date), title: s(r.title), detail: s(r.detail), owner: s(r.owner), due: s(r.due), related: s(r.related) })),
    preshare: items(jp).map((r): PreshareRec => ({ id: s(r.id), ts: s(r.ts), campus: s(r.campus), user: s(r.user), title: s(r.title), date: s(r.date), place: s(r.place), agenda: s(r.agenda), minutesId: s(r.minutesId) })),
    share: items(js).map((r): ShareRec => ({ ts: s(r.ts), campus: s(r.campus), user: s(r.user), kind: s(r.kind), title: s(r.title), background: s(r.background), point: s(r.point), opinion: s(r.opinion) })),
  };
  const text = formatMeetingRecords(data, o, todayJst());
  return {
    text: failed.length ? `${text}\n\n（読めなかったシート：${failed.join('・')}。そのことを回答に書く）` : text,
    note: `${o.dept || '全部門'}・${o.what}${failed.length ? `・読めず:${failed.join('・')}` : ''}`,
  };
}

export type AgendaProposal = { dept: string; item: string; detail: string; meetingId: string; meetingTitle: string; meetingDate: string };

/** propose_agenda_item：足す会議を決めて、画面に出す案と AI に返す文を作る（ここでは書かない）。 */
export async function runProposeAgenda(input: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; proposal?: AgendaProposal }> {
  const c = checkAgendaInput(input);
  if (!c.ok) return { text: c.message };
  const v = { ...c.value, dept: normalizeDept(c.value.dept) };
  const l = await listPreshares(signal);
  const target = l.ok ? pickAgendaTarget(l.rows, v.dept, v.meetingId, todayJst()) : null;
  const proposal: AgendaProposal = {
    dept: target?.campus || v.dept,
    item: v.item,
    detail: v.detail,
    meetingId: target?.id ?? '',
    meetingTitle: target?.title ?? '',
    meetingDate: target?.date ?? '',
  };
  const where = target
    ? `${proposal.dept}の「${proposal.meetingTitle}」（${proposal.meetingDate}）の事前共有の議題`
    : `${proposal.dept}の「議題の候補」（${l.ok ? 'これからの会議の事前共有がまだ無いため。会議の担当者が事前共有を作るときに取り込む' : '事前共有を読めなかったため'}）`;
  return {
    text: `議題の追加の案を画面に出した（まだ追加していない）。追加先：${where}。議題：${v.item}${v.detail ? `（${v.detail}）` : ''}。\n回答には「下の［議題に追加する］を押すと追加されます」と書く。「追加しました」とは書かない。`,
    proposal,
  };
}
