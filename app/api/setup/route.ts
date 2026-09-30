import { NextResponse } from 'next/server';
import { sessionConfigured } from '@/lib/core/auth';
import { STAFF, ADMIN_CAMPUS } from '@/lib/core/staff';
import { countUsers, createUser, deleteUser, isEmail, normalizeEmail, usersConfigured } from '@/lib/core/users';
import { deliverCredentials } from '@/lib/core/mail';

// 最初の管理者アカウントを作る（アカウントが1件も無いときだけ使える）。
// なりすましを防ぐため、作れるのは環境変数 SETUP_ADMIN_EMAIL のメールアドレスだけで、
// 初期パスワードは画面には出さず、そのメールアドレスにだけ送る。

export const dynamic = 'force-dynamic';

async function available(): Promise<boolean> {
  if (!sessionConfigured() || !usersConfigured()) return false;
  if (!normalizeEmail(process.env.SETUP_ADMIN_EMAIL)) return false;
  return (await countUsers()) === 0;
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, available: await available() });
  } catch {
    return NextResponse.json({ ok: false, available: false });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const name = String(body.name ?? '').trim();
  try {
    if (!(await available())) return NextResponse.json({ ok: false, error: '初回セットアップは使えません。' }, { status: 403 });
    if (!isEmail(email) || !name) return NextResponse.json({ ok: false, error: 'メールアドレスと氏名を入力してください。' }, { status: 400 });
    if (email !== normalizeEmail(process.env.SETUP_ADMIN_EMAIL)) {
      return NextResponse.json({ ok: false, error: 'このメールアドレスでは初回セットアップできません。' }, { status: 403 });
    }
    const dept = STAFF.some((g) => g.campus === ADMIN_CAMPUS) ? ADMIN_CAMPUS : STAFF[0].campus;
    const r = await createUser({ email, name, role: 'admin', dept, classrooms: [] }, 'setup');
    if (!r.ok) return NextResponse.json({ ok: false, error: 'すでに登録されています。' }, { status: 409 });
    const d = await deliverCredentials(req, 'new', r.user, r.password);
    if (!d.mailed) {
      // メールが届かないと誰もログインできないので、作ったアカウントを取り消して、やり直せるようにする
      await deleteUser(r.user.id);
      return NextResponse.json({
        ok: false,
        error: `メールを送れなかったため、作成を取り消しました（${d.reason}）。Apps Script の sendMail と APPS_SCRIPT_URL を確認してください。`,
      }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'データベースに接続できませんでした。' }, { status: 502 });
  }
}
