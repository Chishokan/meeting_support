// 門配管理：AIによる月間計画の案（保存はしない。画面で選んだものだけ /api/monpai/records で登録する）。
//   POST { district, month }
import { getSession } from '@/lib/core/auth';
import { STAFF } from '@/lib/core/staff';
import { DISTRICTS, shiftMonth } from '@/lib/monpai/model';
import { draftPlan } from '@/lib/monpai/plan';
import { getMaster, getMaterials, listRecords } from '@/lib/monpai/store';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!getSession()) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const district = String(b.district ?? '');
  const month = String(b.month ?? '');
  if (!(DISTRICTS as readonly string[]).includes(district) || !/^\d{4}-\d{2}$/.test(month)) {
    return Response.json({ ok: false, reason: 'invalid' }, { status: 400 });
  }

  const [master, recs, mats] = await Promise.all([
    getMaster(),
    listRecords([shiftMonth(month, -2), shiftMonth(month, -1), month]),
    getMaterials(),
  ]);
  if (!master.ok) return Response.json({ ok: false, reason: master.reason });
  if (!recs.ok) return Response.json({ ok: false, reason: recs.reason });
  const schools = master.schools.filter((s) => s.district === district).sort((a, b) => a.order - b.order);
  if (!schools.length) return Response.json({ ok: false, reason: 'no_schools' });

  // 担当者の候補：この地区で最近門配をした人を先に、職員マスタの全員を後ろに（重複なし）
  const recent = recs.items
    .filter((r) => r.district === district)
    .flatMap((r) => [r.staff1, r.staff2])
    .filter(Boolean);
  const staff = Array.from(new Set([...recent, ...STAFF.flatMap((g) => g.names)]));

  const r = await draftPlan({
    district, month, schools,
    settings: master.settings,
    records: recs.items,
    materials: mats.ok ? mats.items.map((m) => m.name) : [],
    staff,
  });
  return Response.json(r);
}
