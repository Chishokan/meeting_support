// 門配管理：門配スタッフ（大学生・アルバイト）の名簿。スタッフ専用画面（/monpai-staff）のログインに使う。
// 閲覧は社員なら誰でも、追加・変更・削除は学校マスタと同じ部門だけ（lib/monpai/model.ts の MASTER_EDIT_DEPTS）。
//   GET                               … 名簿
//   POST   { affiliation, name, order, active, note } … 追加・更新（所属と名前が同じなら上書き）
//   DELETE ?affiliation=&name=        … 名簿から外す
import { getSession } from '@/lib/core/auth';
import { canEditMaster, validateStaff } from '@/lib/monpai/model';
import { deleteStaff, listStaff, saveStaff } from '@/lib/monpai/store';

export const runtime = 'nodejs';
export const maxDuration = 30;

function gate(edit: boolean) {
  const s = getSession();
  if (!s) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (edit && !canEditMaster(s.campus)) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  return null;
}

const done = (r: { ok: boolean; reason?: string }) =>
  Response.json(r, { status: r.ok ? 200 : r.reason === 'not_supported' ? 400 : 502 });

export async function GET() {
  const g = gate(false);
  if (g) return g;
  const r = await listStaff();
  return r.ok ? Response.json(r) : Response.json({ ok: false, reason: r.reason, items: [] });
}

export async function POST(req: Request) {
  const g = gate(true);
  if (g) return g;
  const v = validateStaff((await req.json().catch(() => ({}))) as Record<string, unknown>);
  if (!v.ok) return Response.json({ ok: false, reason: 'invalid', errors: v.errors }, { status: 400 });
  return done(await saveStaff(v.value));
}

export async function DELETE(req: Request) {
  const g = gate(true);
  if (g) return g;
  const q = new URL(req.url).searchParams;
  const affiliation = q.get('affiliation') ?? '';
  const name = q.get('name') ?? '';
  if (!affiliation || !name) return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  return done(await deleteStaff(affiliation, name));
}
