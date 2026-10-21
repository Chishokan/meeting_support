'use client';

// 門配スタッフのログイン画面（/monpai-staff/login）。所属 → 名前の順に選ぶ。
// 見た目は社員のログイン画面（app/login）と同じ。

import { useState } from 'react';

export default function MonpaiStaffLogin({ groups, unavailable }: {
  groups: { affiliation: string; names: string[] }[];
  unavailable: boolean;
}) {
  const [affiliation, setAffiliation] = useState(groups[0]?.affiliation ?? '');
  const [name, setName] = useState(groups[0]?.names[0] ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const names = groups.find((g) => g.affiliation === affiliation)?.names ?? [];

  function onAffiliation(a: string) {
    setAffiliation(a);
    setName(groups.find((g) => g.affiliation === a)?.names[0] ?? '');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/monpai-staff/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affiliation, name }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || 'ログインに失敗しました。');
        setBusy(false);
        return;
      }
      window.location.href = '/monpai-staff';
    } catch {
      setErr('通信エラーが発生しました。');
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <form className="card" onSubmit={submit}>
        <h1>門配報告</h1>
        <p className="sub">門配スタッフ用：所属とお名前を選んでください</p>

        {unavailable && <div className="err">名簿を読み込めませんでした。時間をおいて開き直してください。</div>}
        {!unavailable && groups.length === 0 && <div className="err">名簿にまだ誰も登録されていません。担当の社員に連絡してください。</div>}

        <label>所属</label>
        <select value={affiliation} onChange={(e) => onAffiliation(e.target.value)}>
          {groups.map((g) => (
            <option key={g.affiliation} value={g.affiliation}>{g.affiliation}</option>
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
