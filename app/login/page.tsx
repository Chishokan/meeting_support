'use client';

import { useState } from 'react';
import { STAFF } from '@/lib/staff';

export default function LoginPage() {
  const [campus, setCampus] = useState(STAFF[0].campus);
  const [name, setName] = useState(STAFF[0].names[0]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const names = STAFF.find((s) => s.campus === campus)?.names ?? [];

  function onCampus(c: string) {
    setCampus(c);
    setName(STAFF.find((s) => s.campus === c)?.names[0] ?? '');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, campus }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || '開始に失敗しました。');
        setBusy(false);
        return;
      }
      window.location.href = '/dashboard';
    } catch {
      setErr('通信エラーが発生しました。');
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <form className="card" onSubmit={submit}>
        <h1>智翔館 会議事前準備アシスタント</h1>
        <p className="sub">テスト運用中：お名前を選んで始めてください</p>

        <label>事業部</label>
        <select value={campus} onChange={(e) => onCampus(e.target.value)}>
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

        <button className="primary" disabled={busy || !name}>
          {busy ? '準備中…' : 'はじめる'}
        </button>
        {err && <div className="err">{err}</div>}
      </form>
    </div>
  );
}
