import { NextResponse } from 'next/server';
import { getSession } from '@/lib/core/auth';
import { CLASSROOMS } from '@/lib/core/roles';
import { STAFF } from '@/lib/core/staff';
import { createUser, listUsers, parseUserInput } from '@/lib/core/users';
import { deliverCredentials } from '@/lib/core/mail';

// アカウント管理（管理者のみ）：一覧・発行。
// 発行すると、本人のメールアドレスに初期パスワードとパスワード変更用URLが届く。

export const dynamic = 'force-dynamic';

const DEPTS = STAFF.map((g) => g.campus);

function admin() {
  const s = getSession();
  return s && s.role === 'admin' && !s.mustChange ? s : null;
}

export async function GET() {
  if (!admin()) return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, users: await listUsers(), depts: DEPTS, classrooms: CLASSROOMS });
  } catch {
    return NextResponse.json({ ok: false, reason: 'db_error' }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const s = admin();
  if (!s) return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  const parsed = parseUserInput(await req.json().catch(() => ({})), DEPTS, CLASSROOMS);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  try {
    const r = await createUser(parsed.input, s.email);
    if (!r.ok) return NextResponse.json({ ok: false, error: 'このメールアドレスはすでに登録されています。' }, { status: 409 });
    const delivery = await deliverCredentials(req, 'new', r.user, r.password);
    return NextResponse.json({ ok: true, user: r.user, delivery });
  } catch {
    return NextResponse.json({ ok: false, error: 'データベースに保存できませんでした。' }, { status: 502 });
  }
}
