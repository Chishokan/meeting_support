// 問合せ管理（/inquiry-board）の API。
//   GET    … 台帳の全件（校舎の絞り込みは画面側で行う。全件でも数百行なので一度に返す）
//   POST   … 新規登録
//   PUT    … 更新（body.id で指定）
//   DELETE … 削除（?id=）
//
// 生徒・保護者の個人情報を扱うため、閲覧・編集できる部門を小中等部と管理部門に限定する
// （画面 app/(board)/inquiry-board/layout.tsx と同じ判定）。

import { getSession } from '@/lib/auth';
import { fiscalPeriod } from '@/lib/companyKnowledge';
import { validateInput } from '@/lib/inquiryRecords';
import { createRecord, deleteRecord, listRecords, updateRecord } from '@/lib/inquiryStore';
import { canUseInquiryBoard } from '@/lib/inquiryBoardAccess';

export const runtime = 'nodejs';
export const maxDuration = 30;

function gate() {
  const session = getSession();
  if (!session) return { error: Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 }) };
  if (!canUseInquiryBoard(session.campus)) {
    return { error: Response.json({ ok: false, reason: 'forbidden' }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const g = gate();
  if (g.error) return g.error;
  const r = await listRecords();
  if (!r.ok) return Response.json({ ok: false, reason: r.reason, items: [] });
  return Response.json({ ok: true, items: r.items, fetchedAt: r.fetchedAt, backend: r.backend });
}

export async function POST(req: Request) {
  const g = gate();
  if (g.error) return g.error;
  const body = await req.json().catch(() => ({}));
  const v = validateInput(body, fiscalPeriod().startYear);
  if (!v.ok) return Response.json({ ok: false, reason: 'invalid', errors: v.errors }, { status: 400 });
  const r = await createRecord(v.value, g.session!.name);
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: r.reason === 'not_configured' ? 200 : 502 });
  return Response.json({ ok: true, item: r.item });
}

export async function PUT(req: Request) {
  const g = gate();
  if (g.error) return g.error;
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? '').trim();
  if (!id) return Response.json({ ok: false, reason: 'bad_id' }, { status: 400 });
  const v = validateInput(body, fiscalPeriod().startYear);
  if (!v.ok) return Response.json({ ok: false, reason: 'invalid', errors: v.errors }, { status: 400 });
  const r = await updateRecord(id, v.value, g.session!.name);
  if (!r.ok) {
    const status = r.reason === 'not_found' ? 404 : r.reason === 'not_configured' ? 200 : 502;
    return Response.json({ ok: false, reason: r.reason }, { status });
  }
  return Response.json({ ok: true, item: r.item });
}

export async function DELETE(req: Request) {
  const g = gate();
  if (g.error) return g.error;
  const id = new URL(req.url).searchParams.get('id')?.trim() ?? '';
  if (!id) return Response.json({ ok: false, reason: 'bad_id' }, { status: 400 });
  const r = await deleteRecord(id, g.session!.name);
  if (!r.ok) {
    const status = r.reason === 'not_found' ? 404 : r.reason === 'not_configured' ? 200 : 502;
    return Response.json({ ok: false, reason: r.reason }, { status });
  }
  return Response.json({ ok: true });
}
