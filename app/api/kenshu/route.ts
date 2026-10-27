import { getSession } from '@/lib/core/auth';
import { getAnswer, saveAnswer } from '@/lib/kenshu/store';
import { cleanItems, SURVEY } from '@/lib/kenshu/survey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// 全体研修会アンケート（/kenshu）。ログインしている本人の回答だけを読み書きする。
//   GET  … 自分の回答（未提出なら answer: null）
//   POST … { work: string[], life: string[] } を保存（2回目以降は上書き）
export async function GET() {
  const s = getSession();
  if (!s) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const r = await getAnswer({ survey: SURVEY.id, campus: s.campus, user: s.name });
  return Response.json(r, { status: r.ok ? 200 : 502 });
}

export async function POST(req: Request) {
  const s = getSession();
  if (!s) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const work = cleanItems(body?.work);
  const life = cleanItems(body?.life);
  if (!work.length || !life.length) return Response.json({ ok: false, reason: 'empty' }, { status: 400 });
  const r = await saveAnswer({ survey: SURVEY.id, campus: s.campus, user: s.name }, work, life);
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
