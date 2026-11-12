import { legacyLoginEnabled } from '@/lib/core/auth';
import { hubConfigured } from '@/lib/core/hub';
import LoginForm from './LoginForm';

// ログイン画面。共通ログイン（メールアドレス＋パスワード）が基本。
// 並行運用のあいだは、従来の入り方（部門とお名前を選ぶ）も選べる（LEGACY_LOGIN=off で消える）。
export const dynamic = 'force-dynamic';

// パスワードを忘れた人の行き先（給与アプリの再設定の画面）。HUB_API_URL の hub-api/ を置き換えて作る。
function forgotUrl(): string {
  const u = process.env.HUB_API_URL || '';
  return u ? u.replace(/hub-api\/?$/, '') + 'password_forgot.php' : '';
}

export default function LoginPage() {
  return <LoginForm hubReady={hubConfigured()} legacy={legacyLoginEnabled()} forgotUrl={forgotUrl()} />;
}
