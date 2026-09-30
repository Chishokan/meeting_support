import { NextResponse } from 'next/server';
import { getSession } from '@/lib/core/auth';
import { CLASSROOMS } from '@/lib/core/roles';
import { STAFF } from '@/lib/core/staff';
import { getUser, parseUserInput, resetPassword, updateUser } from '@/lib/core/users';
import { deliverCredentials } from '@/lib/core/mail';

// アカウント管理（管理者のみ）：1件の編集・利用停止／再開・パスワード再発行。
//   PATCH { email, name, role, dept, classrooms } … 内容の変更
//   PATCH { isActive: false|true }               … 利用停止／再開
//   POST  { action: 'reset' }                     … 初期パスワードを作り直して本人にメール
// ★変更は、本人が次にログインしたときから効く（ログイン中のセッションは最長12時間そのまま）。

export const dynamic = 'force-dynamic';

const DEPTS = STAFF.map((g) => g.campus);

function admin() {
  const s = getSession();
  return s && s.role === 'admin' && !s.mustChange ? s : null;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const s = admin();
  if (!s) return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  // 自分自身を止めたり管理者から外したりすると、管理者がいなくなることがあるので断る
  const self = params.id === s.uid;

  try {
    if (typeof body.isActive === 'boolean' && Object.keys(body).length === 1) {
      if (self && !body.isActive) return NextResponse.json({ ok: false, error: '自分のアカウントは停止できません。' }, { status: 400 });
      const r = await updateUser(params.id, { isActive: body.isActive });
      return r.ok ? NextResponse.json({ ok: true, user: r.user }) : NextResponse.json({ ok: false, error: '見つかりません。' }, { status: 404 });
    }
    const parsed = parseUserInput(body, DEPTS, CLASSROOMS);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    if (self && parsed.input.role !== 'admin') {
      return NextResponse.json({ ok: false, error: '自分のロールは管理者から外せません。' }, { status: 400 });
    }
    const r = await updateUser(params.id, parsed.input);
    if (!r.ok) {
      return r.reason === 'duplicate'
        ? NextResponse.json({ ok: false, error: 'このメールアドレスはほかのアカウントで使われています。' }, { status: 409 })
        : NextResponse.json({ ok: false, error: '見つかりません。' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, user: r.user });
  } catch {
    return NextResponse.json({ ok: false, error: 'データベースに保存できませんでした。' }, { status: 502 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!admin()) return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (body.action !== 'reset') return NextResponse.json({ ok: false, error: '不明な操作です。' }, { status: 400 });
  try {
    const u = await getUser(params.id);
    if (!u) return NextResponse.json({ ok: false, error: '見つかりません。' }, { status: 404 });
    const password = await resetPassword(u.id);
    const delivery = await deliverCredentials(req, 'reset', u, password);
    return NextResponse.json({ ok: true, delivery });
  } catch {
    return NextResponse.json({ ok: false, error: 'データベースに保存できませんでした。' }, { status: 502 });
  }
}
