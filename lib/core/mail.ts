// メール送信（アカウント発行・パスワード再発行の案内）。サーバ専用。
// 既存の Apps Script（APPS_SCRIPT_URL）の sendMail で送る（Gmail の MailApp。差出人は Apps Script の所有者）。
// 未設定・失敗のときは { ok:false } を返す。呼び出し側は管理者の画面に初期パスワードを出して手渡しに切り替える。

import { ROLE_LABELS, type Role } from './roles';
import { TOKEN_HOURS, issuePasswordToken } from './users';

export type MailResult = { ok: true } | { ok: false; reason: string };

export async function sendMail(to: string, subject: string, body: string): Promise<MailResult> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sendMail', token: process.env.APPS_SCRIPT_TOKEN || '', to, subject, body }),
      cache: 'no-store',
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true && j.sent === true) return { ok: true };
    return { ok: false, reason: (j && j.reason) || 'apps_script_outdated' };
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

/** アプリの URL（メールに載せる）。APP_BASE_URL があればそれ、無ければ今のリクエストの URL から作る。 */
export function appBaseUrl(req: Request): string {
  const env = (process.env.APP_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (env) return env;
  return new URL(req.url).origin;
}

export function accountMail(opts: {
  kind: 'new' | 'reset';
  name: string;
  email: string;
  role: Role;
  password: string;
  baseUrl: string;
  token: string;
}): { subject: string; body: string } {
  const loginUrl = `${opts.baseUrl}/login`;
  const changeUrl = `${opts.baseUrl}/password?token=${encodeURIComponent(opts.token)}`;
  const head = opts.kind === 'new'
    ? '智翔館アプリのアカウントを発行しました。'
    : '智翔館アプリのパスワードを再発行しました。';
  const subject = opts.kind === 'new' ? '【智翔館アプリ】アカウント発行のお知らせ' : '【智翔館アプリ】パスワード再発行のお知らせ';
  const body = [
    `${opts.name} さん`,
    '',
    head,
    '',
    `ログインID（メールアドレス）：${opts.email}`,
    `初期パスワード：${opts.password}`,
    `ロール：${ROLE_LABELS[opts.role]}`,
    '',
    '■ パスワードの変更（最初に行ってください）',
    changeUrl,
    `※ このURLは${TOKEN_HOURS}時間有効で、1回だけ使えます。`,
    '※ 期限が切れたら、上の初期パスワードでログインすると変更画面が開きます。',
    '',
    '■ ログイン画面',
    loginUrl,
    '',
    'このメールに心当たりがない場合は、管理者に連絡してください。',
  ].join('\n');
  return { subject, body };
}

export type Delivery =
  | { mailed: true }
  | { mailed: false; reason: string; password: string; changeUrl: string };

/**
 * 初期パスワードとパスワード変更用URLを本人にメールする。
 * 送れなかったときは、管理者の画面に出して手渡しできるよう、パスワードとURLを返す。
 */
export async function deliverCredentials(
  req: Request,
  kind: 'new' | 'reset',
  user: { id: string; name: string; email: string; role: Role },
  password: string,
): Promise<Delivery> {
  const baseUrl = appBaseUrl(req);
  const token = await issuePasswordToken(user.id);
  const { subject, body } = accountMail({ kind, name: user.name, email: user.email, role: user.role, password, baseUrl, token });
  const r = await sendMail(user.email, subject, body);
  if (r.ok) return { mailed: true };
  return { mailed: false, reason: r.reason, password, changeUrl: `${baseUrl}/password?token=${encodeURIComponent(token)}` };
}
