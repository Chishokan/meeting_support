import { getSession } from '@/lib/auth';
import { callGas, gasErrorStatus } from '@/lib/gas';
import { ADMIN_CAMPUS } from '@/lib/staff';

export const runtime = 'nodejs';
export const maxDuration = 30;

// 一覧取得
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });

  const r = await callGas('listInquiries');
  if (!r.ok) return Response.json({ ...r, items: [] }, { status: gasErrorStatus(r.reason) });
  return Response.json({ ok: true, items: r.data.items ?? [] });
}

// 問い合わせ送信
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const category = String(body?.category ?? '').trim();
  const content = String(body?.content ?? '').trim();
  if (!category && !content) return Response.json({ ok: false, reason: 'empty' }, { status: 400 });

  const image = body?.image ?? null;
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    campus: session.campus,
    user: session.name,
    category,
    content,
  };
  if (image && typeof image.data === 'string') {
    payload.imageData = image.data;
    payload.imageMime = String(image.mime ?? 'image/jpeg');
    payload.imageName = String(image.name ?? 'inquiry.jpg');
  }

  const r = await callGas('saveInquiry', payload);
  if (!r.ok) return Response.json(r, { status: gasErrorStatus(r.reason) });
  return Response.json({ ok: true, imageUrl: r.data.imageUrl ?? '' });
}

// 問い合わせ本人による編集（内容・種別）。所有者チェックは GAS 側で実施。
export async function PATCH(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const row = Number(body?.row);
  const content = String(body?.content ?? '').trim();
  const category = String(body?.category ?? '');
  if (!(row >= 2)) return Response.json({ ok: false, reason: 'bad_row' }, { status: 400 });
  if (!content) return Response.json({ ok: false, reason: 'empty' }, { status: 400 });

  const r = await callGas('updateInquiry', {
    row,
    content,
    category,
    reqCampus: session.campus,
    reqUser: session.name,
  });
  if (!r.ok) return Response.json(r, { status: gasErrorStatus(r.reason) });
  return Response.json({ ok: true });
}

// 管理者による回答の書き込み（ADMIN_CAMPUS でログインした人のみ）
export async function PUT(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (session.campus !== ADMIN_CAMPUS) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const row = Number(body?.row);
  const reply = String(body?.reply ?? '');
  if (!(row >= 2)) return Response.json({ ok: false, reason: 'bad_row' }, { status: 400 });

  const r = await callGas('updateInquiryReply', { row, reply, repliedBy: session.name });
  if (!r.ok) return Response.json(r, { status: gasErrorStatus(r.reason) });
  return Response.json({ ok: true });
}
