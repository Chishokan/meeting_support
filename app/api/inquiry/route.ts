import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 30;

// 回答を書き込める管理者部門（この部門でログインした人だけ回答可能）。
const ADMIN_CAMPUS = '総務・人事・支援・管理';

type GasResult = { ok?: boolean; reason?: string; items?: unknown[]; imageUrl?: string };

async function callGas(payload: Record<string, unknown>): Promise<GasResult | null> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return null;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: process.env.APPS_SCRIPT_TOKEN || '', ...payload }),
  });
  if (!res.ok) return { ok: false, reason: 'upstream_error' };
  return (await res.json().catch(() => null)) as GasResult | null;
}

// 一覧取得
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });
  if (!process.env.APPS_SCRIPT_URL) return Response.json({ ok: false, reason: 'not_configured', items: [] });
  try {
    const j = await callGas({ action: 'listInquiries' });
    if (j && j.ok) return Response.json({ ok: true, items: j.items ?? [] });
    return Response.json({ ok: false, reason: j?.reason ?? 'upstream_error', items: [] }, { status: 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error', items: [] }, { status: 502 });
  }
}

// 問い合わせ送信
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const category = String(body?.category ?? '').trim();
  const content = String(body?.content ?? '').trim();
  if (!category && !content) return Response.json({ ok: false, reason: 'empty' }, { status: 400 });

  if (!process.env.APPS_SCRIPT_URL) return Response.json({ ok: false, reason: 'not_configured' });

  const image = body?.image ?? null;
  const payload: Record<string, unknown> = {
    action: 'saveInquiry',
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

  try {
    const j = await callGas(payload);
    if (j && j.ok) return Response.json({ ok: true, imageUrl: j.imageUrl ?? '' });
    return Response.json({ ok: false, reason: j?.reason ?? 'upstream_error' }, { status: 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }
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

  if (!process.env.APPS_SCRIPT_URL) return Response.json({ ok: false, reason: 'not_configured' });

  try {
    const j = await callGas({
      action: 'updateInquiry',
      row,
      content,
      category,
      reqCampus: session.campus,
      reqUser: session.name,
    });
    if (j && j.ok) return Response.json({ ok: true });
    return Response.json({ ok: false, reason: j?.reason ?? 'upstream_error' }, { status: 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }
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

  if (!process.env.APPS_SCRIPT_URL) return Response.json({ ok: false, reason: 'not_configured' });

  try {
    const j = await callGas({ action: 'updateInquiryReply', row, reply, repliedBy: session.name });
    if (j && j.ok) return Response.json({ ok: true });
    return Response.json({ ok: false, reason: j?.reason ?? 'upstream_error' }, { status: 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }
}
