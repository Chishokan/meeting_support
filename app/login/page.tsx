'use client';

import { useState } from 'react';

const DEPARTMENTS = ['小中等部', 'RED個別', '高等部', 'その他'];

export default function LoginPage() {
  const [name, setName] = useState('');
  const [dept, setDept] = useState(DEPARTMENTS[0]);
  const [code, setCode] = useState('');
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
        body: JSON.stringify({ name, campus: dept, code }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || 'ログインに失敗しました。');
        setBusy(false);
        return;
      }
      window.location.href = '/chat';
    } catch {
      setErr('通信エラーが発生しました。');
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <form className="card" onSubmit={submit}>
        <h1>智翔館 会議事前準備アシスタント</h1>
        <p className="sub">テスト版・社内利用専用</p>

        <label>お名前</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：安藤" />

        <label>事業部</label>
        <select value={dept} onChange={(e) => setDept(e.target.value)}>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <label>合言葉</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          type="password"
          placeholder="社内で共有された合言葉"
        />

        <button className="primary" disabled={busy || !name}>
          {busy ? '確認中…' : 'はじめる'}
        </button>
        {err && <div className="err">{err}</div>}
      </form>
    </div>
  );
}
