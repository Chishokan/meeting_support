'use client';

import { useEffect, useState } from 'react';

// 最初の管理者アカウントを作る画面（アカウントが1件も無いときだけ使える）。
// 作れるのは環境変数 SETUP_ADMIN_EMAIL のメールアドレスだけ。初期パスワードはそのメールに届く。

export default function SetupPage() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/setup').then((r) => r.json()).then((d) => setAvailable(!!d.available)).catch(() => setAvailable(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) {
      setErr(d.error || '作成に失敗しました。');
      return;
    }
    setDone(true);
  }

  return (
    <div className="wrap auth-wrap">
      <form className="card" onSubmit={submit}>
        <h1>初回セットアップ</h1>
        {available === null && <p className="sub">確認中…</p>}
        {available === false && !done && (
          <>
            <p className="sub">初回セットアップは使えません（すでにアカウントがあるか、設定が済んでいません）。</p>
            <a className="auth-link" href="/login">ログイン画面へ</a>
          </>
        )}
        {done && (
          <>
            <p className="sub">管理者アカウントを作りました。メールに届いた初期パスワードでログインしてください。</p>
            <a className="auth-link" href="/login">ログイン画面へ</a>
          </>
        )}
        {available && !done && (
          <>
            <p className="sub">最初の管理者アカウントを作ります。初期パスワードはメールで届きます。</p>
            <label htmlFor="email">メールアドレス</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="name">氏名</label>
            <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
            <button className="primary" disabled={busy || !email || !name}>{busy ? '作成中…' : '作成してメールを送る'}</button>
            {err && <div className="err">{err}</div>}
          </>
        )}
      </form>
    </div>
  );
}
