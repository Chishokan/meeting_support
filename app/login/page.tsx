'use client';

import { useState } from 'react';

// ログイン後の行き先。既定は総合画面（/）。各アプリから来た人はそこへ戻す。
// 外部 URL へ飛ばされないよう、"/" で始まる相対パスだけを受け付ける。
function nextPath(): string {
  try {
    const n = new URLSearchParams(window.location.search).get('next') || '';
    if (n.startsWith('/') && !n.startsWith('//')) return n;
  } catch {}
  return '/';
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error || 'ログインに失敗しました。');
        setBusy(false);
        return;
      }
      // 初期パスワードのままなら、まずパスワードを変えてもらう
      window.location.href = d.mustChange ? '/password' : nextPath();
    } catch {
      setErr('通信エラーが発生しました。');
      setBusy(false);
    }
  }

  return (
    <div className="wrap auth-wrap">
      <form className="card" onSubmit={submit}>
        <h1>智翔館アプリ</h1>
        <p className="sub">メールアドレスとパスワードでログインしてください</p>

        <label htmlFor="email">メールアドレス</label>
        <input
          id="email" type="email" autoComplete="username" required
          value={email} onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="password">パスワード</label>
        <input
          id="password" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)}
        />

        <button className="primary" disabled={busy || !email || !password}>
          {busy ? '確認中…' : 'ログイン'}
        </button>
        {err && <div className="err">{err}</div>}
        <p className="auth-note">
          パスワードを忘れたときは、管理者に再発行を依頼してください（登録のメールアドレスに届きます）。
        </p>
      </form>
    </div>
  );
}
