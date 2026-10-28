// 適性検査：受検者（応募者）。管理部門のみ（lib/aptitude/access.ts）。
//   GET  … 一覧（いちばん新しい受検の状態と結果つき）
//   POST … 登録
import { createCandidate, listCandidates, backendKind } from '@/lib/aptitude/store';
import { validateCandidate } from '@/lib/aptitude/model';
import { invalid, reply, staffGate } from '@/lib/aptitude/api';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function GET() {
  const g = staffGate();
  if (g.res) return g.res;
  const r = await listCandidates();
  if (!r.ok) return reply(r);
  return Response.json({ ...r, backend: backendKind() });
}

export async function POST(req: Request) {
  const g = staffGate();
  if (g.res) return g.res;
  const v = validateCandidate(await req.json().catch(() => ({})));
  if (!v.ok) return invalid(v.errors);
  return reply(await createCandidate(v.value, g.actor));
}
