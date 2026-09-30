'use client';

// アカウント管理（/admin/users）。管理者がアカウントを発行・編集・利用停止・パスワード再発行する。
// 発行・再発行すると、本人のメールアドレスに初期パスワードとパスワード変更用URLが届く。
// メールを送れなかったときだけ、画面に初期パスワードとURLを出す（本人に手渡しする）。

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ROLES, ROLE_LABELS, type Role } from '@/lib/core/roles';

type User = {
  id: string; email: string; name: string; role: Role; dept: string; classrooms: string[];
  mustChangePassword: boolean; isActive: boolean; lastLoginAt: string | null;
};
type Delivery = { mailed: true } | { mailed: false; reason: string; password: string; changeUrl: string };
type Form = { email: string; name: string; role: Role; dept: string; classrooms: string[] };

const EMPTY: Form = { email: '', name: '', role: 'staff', dept: '', classrooms: [] };

function fmt(v: string | null): string {
  if (!v) return '—';
  return new Date(v).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' });
}

export default function AdminUsersUI({ selfId }: { selfId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const [classrooms, setClassrooms] = useState<string[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [editing, setEditing] = useState<string | null>(null); // null=閉じる, ''=新規, id=編集
  const [form, setForm] = useState<Form>(EMPTY);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ name: string; email: string; delivery: Delivery } | null>(null);
  const [q, setQ] = useState('');

  async function load() {
    const res = await fetch('/api/admin/users', { cache: 'no-store' }).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    if (!d || !d.ok) {
      setLoadErr('アカウントを読み込めませんでした（Supabase の設定と 0002_app_users.sql の実行を確認してください）。');
      return;
    }
    setLoadErr('');
    setUsers(d.users);
    setDepts(d.depts);
    setClassrooms(d.classrooms);
  }
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return users;
    return users.filter((u) => `${u.name} ${u.email} ${u.dept} ${u.classrooms.join(' ')}`.toLowerCase().includes(k));
  }, [users, q]);

  function openNew() {
    setForm({ ...EMPTY, dept: depts[0] ?? '' });
    setEditing('');
    setErr('');
  }
  function openEdit(u: User) {
    setForm({ email: u.email, name: u.name, role: u.role, dept: u.dept, classrooms: u.classrooms });
    setEditing(u.id);
    setErr('');
  }
  function toggleRoom(c: string) {
    setForm((f) => ({
      ...f,
      classrooms: f.classrooms.includes(c) ? f.classrooms.filter((x) => x !== c) : [...f.classrooms, c],
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const isNew = editing === '';
    const res = await fetch(isNew ? '/api/admin/users' : `/api/admin/users/${editing}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok || !d.ok) {
      setErr(d.error || '保存に失敗しました。');
      return;
    }
    if (isNew) setNotice({ name: d.user.name, email: d.user.email, delivery: d.delivery });
    setEditing(null);
    load();
  }

  async function setActive(u: User, isActive: boolean) {
    if (!isActive && !confirm(`${u.name} さんを利用停止にします。ログインできなくなります。よろしいですか？`)) return;
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) alert(d.error || '変更に失敗しました。');
    load();
  }

  async function reset(u: User) {
    if (!confirm(`${u.name} さんのパスワードを再発行します。今のパスワードは使えなくなります。よろしいですか？`)) return;
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok || !d.ok) {
      alert(d.error || '再発行に失敗しました。');
      return;
    }
    setNotice({ name: u.name, email: u.email, delivery: d.delivery });
    load();
  }

  return (
    <div className="portal admin-users">
      <div className="au-head">
        <h1 className="portal-title">アカウント管理</h1>
        <Link href="/" className="au-back">← メニュー</Link>
      </div>

      {loadErr && <p className="err">{loadErr}</p>}

      {notice && (
        <div className={`au-notice ${notice.delivery.mailed ? '' : 'warn'}`}>
          {notice.delivery.mailed ? (
            <p>{notice.name} さん（{notice.email}）に、初期パスワードとパスワード変更用のURLをメールで送りました。</p>
          ) : (
            <>
              <p>
                メールを送れませんでした（{notice.delivery.reason}）。下の内容を {notice.name} さんに直接伝えてください。
                この画面を閉じると二度と表示されません。
              </p>
              <dl>
                <dt>ログインID</dt><dd>{notice.email}</dd>
                <dt>初期パスワード</dt><dd><code>{notice.delivery.password}</code></dd>
                <dt>変更用URL</dt><dd><code className="au-url">{notice.delivery.changeUrl}</code></dd>
              </dl>
            </>
          )}
          <button type="button" className="au-btn" onClick={() => setNotice(null)}>閉じる</button>
        </div>
      )}

      <div className="au-tools">
        <input className="au-search" placeholder="氏名・メール・部門・教室で絞り込み" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="au-btn primary" onClick={openNew}>＋ アカウントを発行</button>
      </div>

      {editing !== null && (
        <form className="au-form" onSubmit={save}>
          <h2>{editing === '' ? 'アカウントを発行' : 'アカウントを編集'}</h2>
          <div className="au-grid">
            <label>メールアドレス（ログインID）
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label>氏名
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>ロール
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </label>
            <label>部門（会議DXの報告先）
              <select value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value })}>
                <option value="">（なし）</option>
                {depts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>
          <fieldset className="au-rooms">
            <legend>担当教室</legend>
            {classrooms.map((c) => (
              <label key={c} className="au-room">
                <input type="checkbox" checked={form.classrooms.includes(c)} onChange={() => toggleRoom(c)} />
                {c}
              </label>
            ))}
          </fieldset>
          {editing === '' && (
            <p className="auth-note">発行すると、このメールアドレスに初期パスワードとパスワード変更用のURLが届きます。</p>
          )}
          {editing !== '' && (
            <p className="auth-note">変更は、本人が次にログインしたときから効きます。</p>
          )}
          {err && <p className="err">{err}</p>}
          <div className="au-actions">
            <button type="submit" className="au-btn primary" disabled={busy}>
              {busy ? '保存中…' : editing === '' ? '発行してメールを送る' : '保存'}
            </button>
            <button type="button" className="au-btn" onClick={() => setEditing(null)}>やめる</button>
          </div>
        </form>
      )}

      <div className="au-table-wrap">
        <table className="au-table">
          <thead>
            <tr><th>氏名</th><th>メールアドレス</th><th>ロール</th><th>部門</th><th>担当教室</th><th>状態</th><th>最終ログイン</th><th></th></tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className={u.isActive ? '' : 'inactive'}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{ROLE_LABELS[u.role]}</td>
                <td>{u.dept || '—'}</td>
                <td>{u.classrooms.join('、') || '—'}</td>
                <td>{!u.isActive ? '利用停止' : u.mustChangePassword ? '初期パスワード' : '利用中'}</td>
                <td>{fmt(u.lastLoginAt)}</td>
                <td className="au-row-actions">
                  <button type="button" className="au-btn" onClick={() => openEdit(u)}>編集</button>
                  <button type="button" className="au-btn" onClick={() => reset(u)}>再発行</button>
                  {u.id !== selfId && (
                    u.isActive
                      ? <button type="button" className="au-btn danger" onClick={() => setActive(u, false)}>停止</button>
                      : <button type="button" className="au-btn" onClick={() => setActive(u, true)}>再開</button>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && !loadErr && (
              <tr><td colSpan={8} className="au-empty">アカウントがありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
