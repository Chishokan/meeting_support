import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 30;

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
