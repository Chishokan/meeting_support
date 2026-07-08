'use client';

import { useState } from 'react';

const CAMPUSES = [
  '駅前校', '日野校', '大野校', '日宇校', '県立中受検',
  'RED広田', 'RED大野', 'RED大島', 'RED京町', 'RED日野', 'RED佐々',
  'ネクスタ駅前', '高等部', 'その他',
];

export default function LoginPage() {
  const [name, setName] = useState('');
  const [campus, setCampus] = useState(CAMPUSES[0]);
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
        body: JSON.stringify({ name, campus, code }),
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
        <h1>智翔館 週間計画アシスタント</h1>
        <p className="sub">テスト版・社内利用専用</p>

        <label>お名前</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：太田" />

        <label>校舎</label>
        <select value={campus} onChange={(e) => setCampus(e.target.value)}>
          {CAMPUSES.map((c) => (
            <option key={c} value={c}>{c}</option>
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
