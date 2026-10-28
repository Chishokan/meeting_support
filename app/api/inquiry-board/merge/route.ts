// 問合せ管理：2 行の統合。
//   POST /api/inquiry-board/merge  body: { keepId, dropId }
//   → keepId の行に dropId の行をまとめて保存し、dropId の行を削除する。{ ok, item, dropped }
// 中身の決め方は lib/inquiryMerge.ts。

import { getSession } from '@/lib/core/auth';
import { fiscalPeriod, jstDate } from '@/lib/core/companyKnowledge';
import { canUseInquiryBoard } from '@/lib/inquiryBoardAccess';
import { validateInput } from '@/lib/inquiryRecords';
import { deleteRecord, listRecords, updateRecord } from '@/lib/inquiryStore';
import { mergeRecords } from '@/lib/inquiryMerge';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (!canUseInquiryBoard(session.campus)) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const keepId = String(body?.keepId ?? '').trim();
  const dropId = String(body?.dropId ?? '').trim();
  if (!keepId || !dropId || keepId === dropId) return Response.json({ ok: false, reason: 'bad_id' }, { status: 400 });

  const list = await listRecords();
  if (!list.ok) return Response.json({ ok: false, reason: list.reason }, { status: list.reason === 'not_configured' ? 200 : 502 });
  const keep = list.items.find((r) => r.id === keepId);
  const drop = list.items.find((r) => r.id === dropId);
  if (!keep || !drop) return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });

  const { y, m, d } = jstDate(new Date());
  const today = `${y}/${m}/${d}`;
  const merged = mergeRecords(keep, drop, today);
  const v = validateInput({ ...merged, no: keep.no }, fiscalPeriod().startYear);
  if (!v.ok) return Response.json({ ok: false, reason: 'invalid', errors: v.errors }, { status: 400 });

  const saved = await updateRecord(keepId, v.value, session.name);
  if (!saved.ok) return Response.json({ ok: false, reason: saved.reason }, { status: 502 });
  // 残す行の保存が済んでから、まとめた行を消す（消すのが失敗しても、まとめた内容は残す行に入っている）
  const del = await deleteRecord(dropId, session.name);
  try { console.log('[INQUIRY_MERGE]', JSON.stringify({ keep: `${keep.campus}#${keep.no}`, drop: `${drop.campus}#${drop.no}`, by: session.name, dropDeleted: del.ok })); } catch {}
  return Response.json({ ok: true, item: saved.item, dropped: dropId, dropDeleted: del.ok });
}
