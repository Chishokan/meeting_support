'use client';

import { useEffect, useState } from 'react';

// パスワードの設定・変更。
//   ・/password?token=… … メールの「パスワード変更用URL」から（ログイン不要）
//   ・/password          … ログイン中の人（初期パスワードのままの人はログイン後ここへ送られる）

export default function PasswordPage() {
  const [token, setToken] = useState('');
  const [who, setWho] = useState<{ email: string; name: string } | null>(null);
  const [tokenBad, setTokenBad] = useState(false);
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') || '';
    if (!t) return;
    setToken(t);
    fetch(`/api/password?token=${encodeURIComponent(t)}`)
      .then((r) => r.json())
      .then((d) => (d.ok ? setWho({ email: d.email, name: d.name }) : setTokenBad(true)))
      .catch(() => setTokenBad(true));
    // トークンを URL（履歴）に残さない
    window.history.replaceState(null, '', '/password');
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) {
      setErr('確認用のパスワードが一致しません。');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(token ? { token, password: pw } : { current, password: pw }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        setErr(d.error || '変更に失敗しました。');
        setBusy(false);
        return;
      }
      window.location.href = '/';
    } catch {
      setErr('通信エラーが発生しました。');
      setBusy(false);
    }
  }

  if (token && tokenBad) {
    return (
      <div className="wrap auth-wrap">
        <div className="card">
          <h1>パスワードの変更</h1>
          <p className="sub">このURLは期限切れか、すでに使われています。</p>
          <p className="auth-note">
            メールに書かれた初期パスワードでログインすると、変更画面が開きます。
            初期パスワードが分からないときは、管理者に再発行を依頼してください。
          </p>
          <a className="auth-link" href="/login">ログイン画面へ</a>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap auth-wrap">
      <form className="card" onSubmit={submit}>
        <h1>パスワードの変更</h1>
        <p className="sub">
          {who ? `${who.name} さん（${who.email}）の新しいパスワードを決めてください` : '新しいパスワードを決めてください'}
        </p>

        {!token && (
          <>
            <label htmlFor="current">今のパスワード（初期パスワード）</label>
            <input
              id="current" type="password" autoComplete="current-password" required
              value={current} onChange={(e) => setCurrent(e.target.value)}
            />
          </>
        )}

        <label htmlFor="pw">新しいパスワード</label>
        <input
          id="pw" type="password" autoComplete="new-password" required minLength={8}
          value={pw} onChange={(e) => setPw(e.target.value)}
        />
        <label htmlFor="pw2">新しいパスワード（確認）</label>
        <input
          id="pw2" type="password" autoComplete="new-password" required minLength={8}
          value={pw2} onChange={(e) => setPw2(e.target.value)}
        />
        <p className="auth-note">8文字以上で、英字と数字を両方含めてください。</p>

        <button className="primary" disabled={busy || !pw || !pw2 || (!token && !current)}>
          {busy ? '変更中…' : '変更する'}
        </button>
        {err && <div className="err">{err}</div>}
      </form>
    </div>
  );
}
