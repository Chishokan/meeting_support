'use client';

import { useEffect, useState } from 'react';
import { STAFF } from '@/lib/core/staff';

// ログイン後の行き先。既定は総合画面（/）。外部 URL へ飛ばされないよう、"/" で始まる相対パスだけを受け付ける。
function nextPath(): string {
  try {
    const n = new URLSearchParams(window.location.search).get('next') || '';
    if (n.startsWith('/') && !n.startsWith('//')) return n;
  } catch {}
  return '/';
}

const NOTICES: Record<string, string> = {
  relogin: '給与アプリへ移るには、メールアドレスとパスワードでログインし直してください。',
  handoff: 'ログインを引き継げませんでした（リンクの有効期限は1分です）。ここからログインしてください。',
  nodept: '所属部門が登録されていません。管理者にお問い合わせください。',
};

export default function LoginForm({ hubReady, legacy }: { hubReady: boolean; legacy: boolean }) {
  const [mode, setMode] = useState<'hub' | 'legacy'>(hubReady ? 'hub' : 'legacy');
  const [notice, setNotice] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // 共通ログイン
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [depts, setDepts] = useState<string[]>([]);
  const [dept, setDept] = useState('');

  // 従来の入り方
  const [campus, setCampus] = useState(STAFF[0].campus);
  const [name, setName] = useState(STAFF[0].names[0]);
  const names = STAFF.find((s) => s.campus === campus)?.names ?? [];

  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get('notice') || '';
    setNotice(NOTICES[n] || '');
  }, []);

  async function post(url: string, body: unknown) {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error || 'ログインに失敗しました。');
        setBusy(false);
        return;
      }
      if (d.needCampus) {
        setDepts(d.departments || []);
        setDept((d.departments || [])[0] || '');
        setBusy(false);
        return;
      }
      window.location.href = nextPath();
    } catch {
      setErr('通信エラーが発生しました。');
      setBusy(false);
    }
  }

  function submitHub(e: React.FormEvent) {
    e.preventDefault();
    post('/api/auth/login', { email, password, campus: depts.length ? dept : undefined });
  }

  function submitLegacy(e: React.FormEvent) {
    e.preventDefault();
    post('/api/login', { name, campus });
  }

  if (mode === 'hub') {
    return (
      <div className="wrap">
        <form className="card" onSubmit={submitHub}>
          <h1>智翔館アプリ</h1>
          <p className="sub">給与アプリと同じメールアドレス・パスワードでログインします</p>
          {notice && <div className="err">{notice}</div>}

          {depts.length === 0 ? (
            <>
              <label>メールアドレス</label>
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <label>パスワード</label>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </>
          ) : (
            <>
              <label>どの部門で使いますか（兼務の方）</label>
              <select value={dept} onChange={(e) => setDept(e.target.value)}>
                {depts.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </>
          )}

          <button className="primary" disabled={busy}>
            {busy ? '確認中…' : depts.length ? 'この部門ではじめる' : 'ログイン'}
          </button>
          {err && <div className="err">{err}</div>}
          <p className="sub" style={{ marginTop: 12 }}>パスワードがわからないときは、管理者にお問い合わせください。</p>
          {legacy && (
            <p className="sub">
              <a href="#" onClick={(e) => { e.preventDefault(); setErr(''); setMode('legacy'); }}>
                メールアドレスでのログインがまだの方（従来の入り方）
              </a>
            </p>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="wrap">
      <form className="card" onSubmit={submitLegacy}>
        <h1>智翔館アプリ</h1>
        <p className="sub">{hubReady ? '従来の入り方：お名前を選んで始めてください' : 'テスト運用中：お名前を選んで始めてください'}</p>
        {notice && <div className="err">{notice}</div>}

        <label>事業部</label>
        <select value={campus} onChange={(e) => { setCampus(e.target.value); setName(STAFF.find((s) => s.campus === e.target.value)?.names[0] ?? ''); }}>
          {STAFF.map((s) => (
            <option key={s.campus} value={s.campus}>{s.campus}</option>
          ))}
        </select>

        <label>お名前</label>
        <select value={name} onChange={(e) => setName(e.target.value)}>
          {names.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>

        <button className="primary" disabled={busy || !name || !legacy}>
          {busy ? '準備中…' : 'はじめる'}
        </button>
        {err && <div className="err">{err}</div>}
        {hubReady && (
          <p className="sub" style={{ marginTop: 12 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); setErr(''); setMode('hub'); }}>メールアドレスでログインする</a>
          </p>
        )}
      </form>
    </div>
  );
}
