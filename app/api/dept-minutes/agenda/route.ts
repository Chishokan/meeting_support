// 部門会議議事録の画面：智翔館AI から足された「議題の候補」（その部門で、事前共有がまだ無かったときに足されたもの）。
//   GET  ?campus=部門 … まだ取り込んでいない候補の一覧
//   POST { ids }     … 議題に入れた候補に「取り込み済み」の印を付ける
// 保存先は Apps Script の「議題の候補」シート（listAgendaCandidates_ / useAgendaCandidates_）。

import { getSession } from '@/lib/core/auth';
import { callGas } from '@/lib/chishokanAi/gas';

export const runtime = 'nodejs';
export const maxDuration = 30;

export type AgendaCandidate = { id: string; ts: string; campus: string; user: string; item: string; detail: string };

export async function GET(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, items: [] }, { status: 401 });
  const campus = (new URL(req.url).searchParams.get('campus') || session.campus).slice(0, 30);
  const j = await callGas({ action: 'listAgendaCandidates', campus });
  // Apps Script が古い（この action を知らない）ときは、候補が無いのと同じに扱う
  if (!j.ok || j.saved !== 'agenda') return Response.json({ ok: true, items: [] });
  const items: AgendaCandidate[] = (Array.isArray(j.items) ? j.items : []).map((r: Record<string, unknown>) => ({
    id: String(r.id ?? ''), ts: String(r.ts ?? ''), campus: String(r.campus ?? ''), user: String(r.user ?? ''), item: String(r.item ?? ''), detail: String(r.detail ?? ''),
  })).filter((x: AgendaCandidate) => x.id && x.item);
  return Response.json({ ok: true, items });
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids = (Array.isArray(body?.ids) ? body.ids : []).map(String).filter((x: string) => /^[\w-]{8,60}$/.test(x)).slice(0, 30);
  if (!ids.length) return Response.json({ ok: true, count: 0 });
  const j = await callGas({ action: 'useAgendaCandidates', ids, user: session.name });
  return Response.json({ ok: !!j.ok, count: Number(j.count) || 0 });
}
