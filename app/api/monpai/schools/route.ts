// 門配管理：学校マスタと月別設定の編集（閲覧は /api/monpai/master）。
// 学校の追加・変更・削除は部門を絞る（lib/monpai/model.ts の MASTER_EDIT_DEPTS）。
// 月別設定（その月のボトムの率・募集期）は、月間一覧の画面から誰でも変えられる（ログインは必須）。
//   POST   { type:'school', name, district, kind, students, order, note } … 追加・更新（学校名が同じなら上書き）
//   POST   { type:'setting', month, school, rate, recruit }             … 月別設定の追加・更新
//   DELETE ?type=school&name=  /  ?type=setting&month=&school=         … 削除
import { getSession } from '@/lib/core/auth';
import { canEditMaster, validateSchool, validateSetting } from '@/lib/monpai/model';
import { deleteSchool, deleteSetting, saveSchool, saveSetting } from '@/lib/monpai/store';

export const runtime = 'nodejs';
export const maxDuration = 30;

function gate(type: unknown) {
  const s = getSession();
  if (!s) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (type !== 'setting' && !canEditMaster(s.campus)) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  return null;
}

const done = (r: { ok: boolean; reason?: string }) =>
  Response.json(r, { status: r.ok ? 200 : r.reason === 'not_supported' ? 400 : 502 });

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const g = gate(b.type);
  if (g) return g;
  if (b.type === 'school') {
    const v = validateSchool(b);
    if (!v.ok) return Response.json({ ok: false, reason: 'invalid', errors: v.errors }, { status: 400 });
    return done(await saveSchool(v.value));
  }
  if (b.type === 'setting') {
    const v = validateSetting(b);
    if (!v.ok) return Response.json({ ok: false, reason: 'invalid', errors: v.errors }, { status: 400 });
    return done(await saveSetting(v.value));
  }
  return Response.json({ ok: false, reason: 'bad_type' }, { status: 400 });
}

export async function DELETE(req: Request) {
  const q = new URL(req.url).searchParams;
  const g = gate(q.get('type'));
  if (g) return g;
  if (q.get('type') === 'school' && q.get('name')) return done(await deleteSchool(q.get('name')!));
  if (q.get('type') === 'setting' && q.get('month')) return done(await deleteSetting(q.get('month')!, q.get('school') ?? ''));
  return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 });
}
