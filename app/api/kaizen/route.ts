// つきいち改善（/kaizen）の API。
//   GET    … 提出・投票・締め切りをまとめて返す（得票は見せてよい分だけ。lib/kaizen/model.ts の buildView）
//   POST   … 改善の提出
//   PUT    … 改善の修正（body.id で指定。本人はその月の投票が締まるまで、管理部門はいつでも）
//   DELETE … 改善の削除（?id=。直せる人と同じ）
// 投票は ./vote、管理部門の締め切りは ./close、旧スプレッドシートの取り込みは ./import。

import { randomUUID } from 'crypto';
import { getSession, type Session } from '@/lib/core/auth';
import { ADMIN_CAMPUS, STAFF } from '@/lib/core/staff';
import {
  buildView,
  canEdit,
  normalizeInput,
  nowJstText,
  submittableMonths,
  todayJst,
  validateInput,
  type Kaizen,
} from '@/lib/kaizen/model';
import { deleteKaizen, loadKaizen, saveKaizen, withPhotoUrls, type PhotoChange, type PhotoChanges } from '@/lib/kaizen/store';

export const runtime = 'nodejs';
// 写真の保存（Supabase Storage）があるぶん、ほかの画面より長めに待つ
export const maxDuration = 60;

// 1枚あたりの上限（base64 の文字数）。画面で長辺1600pxに縮めてから送るので、ふつうは数百KBに収まる。
// Vercel の受け取り上限（4.5MB）を2枚で超えないようにする。
const MAX_PHOTO_CHARS = 2_000_000;
const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

function gate(): { session: Session } | { error: Response } {
  const session = getSession();
  if (!session) return { error: Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 }) };
  return { session };
}

function failStatus(reason: string): number {
  if (reason === 'not_configured') return 200;
  if (reason === 'not_found') return 404;
  return 502;
}

function photoChange(v: unknown): PhotoChange | null {
  if (v == null || v === 'keep') return 'keep';
  if (v === 'remove') return 'remove';
  const p = v as { data?: unknown; mime?: unknown; name?: unknown };
  const data = typeof p.data === 'string' ? p.data : '';
  const mime = PHOTO_MIMES.includes(String(p.mime)) ? String(p.mime) : '';
  if (!data || !mime || data.length > MAX_PHOTO_CHARS || !/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  return { data, mime, name: String(p.name ?? 'photo.jpg').slice(0, 80) };
}

function photoChanges(body: Record<string, unknown>): PhotoChanges | null {
  const ph = (body.photos ?? {}) as Record<string, unknown>;
  const before = photoChange(ph.before);
  const after = photoChange(ph.after);
  return before && after ? { before, after } : null;
}

export async function GET() {
  const g = gate();
  if ('error' in g) return g.error;
  const r = await loadKaizen();
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: failStatus(r.reason) });
  const view = buildView({
    items: r.items,
    votes: r.votes,
    closes: r.closes,
    user: g.session.name,
    isAdmin: g.session.campus === ADMIN_CAMPUS,
    today: todayJst(),
    staffNames: STAFF.flatMap((s) => s.names),
  });
  // 写真はバケットの中のパスで持っているので、画面で開ける期限つきの URL に置き換えて渡す
  return Response.json({ ok: true, backend: r.backend, ...view, items: await withPhotoUrls(view.items) });
}

export async function POST(req: Request) {
  const g = gate();
  if ('error' in g) return g.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const photos = photoChanges(body);
  if (!photos) return Response.json({ ok: false, reason: 'bad_photo', message: '写真を読み込めませんでした。別の写真で試してください。' }, { status: 400 });

  const r = await loadKaizen();
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: failStatus(r.reason) });
  const input = normalizeInput(body);
  const err = validateInput(input, submittableMonths(todayJst(), r.closes));
  if (err) return Response.json({ ok: false, reason: 'invalid', message: err }, { status: 400 });

  const now = nowJstText();
  const item: Kaizen = {
    ...input,
    id: randomUUID(),
    submittedAt: now,
    beforePhotos: [],
    afterPhotos: [],
    enteredBy: g.session.name,
    enteredDept: g.session.campus,
    updatedAt: now,
    updatedBy: g.session.name,
    source: '',
  };
  const s = await saveKaizen(item, photos, null);
  if (!s.ok) return Response.json({ ok: false, reason: s.reason }, { status: failStatus(s.reason) });
  return Response.json({ ok: true, id: item.id });
}

export async function PUT(req: Request) {
  const g = gate();
  if ('error' in g) return g.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? '').trim();
  if (!id) return Response.json({ ok: false, reason: 'bad_id' }, { status: 400 });
  const photos = photoChanges(body);
  if (!photos) return Response.json({ ok: false, reason: 'bad_photo', message: '写真を読み込めませんでした。別の写真で試してください。' }, { status: 400 });

  const r = await loadKaizen();
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: failStatus(r.reason) });
  const cur = r.items.find((k) => k.id === id);
  if (!cur) return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  const today = todayJst();
  const isAdmin = g.session.campus === ADMIN_CAMPUS;
  if (!canEdit(cur, g.session.name, isAdmin, today, r.closes)) {
    return Response.json({ ok: false, reason: 'forbidden', message: 'この改善は直せません（投票が締め切られたか、ほかの人の改善です）。' }, { status: 403 });
  }

  const input = normalizeInput(body);
  // 月を変えないなら、締め切った月でも管理部門は直せる。月を変えるときは提出できる月だけ。
  const allowed = input.month === cur.month ? [cur.month] : submittableMonths(today, r.closes);
  const err = validateInput(input, allowed);
  if (err) return Response.json({ ok: false, reason: 'invalid', message: err }, { status: 400 });

  const item: Kaizen = { ...cur, ...input, updatedAt: nowJstText(), updatedBy: g.session.name };
  const s = await saveKaizen(item, photos, cur);
  if (!s.ok) return Response.json({ ok: false, reason: s.reason }, { status: failStatus(s.reason) });
  return Response.json({ ok: true, id: item.id });
}

export async function DELETE(req: Request) {
  const g = gate();
  if ('error' in g) return g.error;
  const id = new URL(req.url).searchParams.get('id')?.trim() ?? '';
  if (!id) return Response.json({ ok: false, reason: 'bad_id' }, { status: 400 });

  const r = await loadKaizen();
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: failStatus(r.reason) });
  const cur = r.items.find((k) => k.id === id);
  if (!cur) return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  if (!canEdit(cur, g.session.name, g.session.campus === ADMIN_CAMPUS, todayJst(), r.closes)) {
    return Response.json({ ok: false, reason: 'forbidden', message: 'この改善は消せません（投票が締め切られたか、ほかの人の改善です）。' }, { status: 403 });
  }
  const d = await deleteKaizen(cur, g.session.name);
  if (!d.ok) return Response.json({ ok: false, reason: d.reason }, { status: failStatus(d.reason) });
  return Response.json({ ok: true });
}
