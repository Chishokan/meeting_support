'use client';

// 適性検査：受検履歴（受検1回＝1行）。受検日・拠点・状態・方法で絞り込む。
// 削除した受検者の分も、完全に消えるまで「削除済み」として出す（開けない）。

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASES, METHODS, ROLES, ROLE_LABEL, type SessionState } from '@/lib/aptitude/model';
import type { HistoryRow } from '@/lib/aptitude/store';
import { api, failText, jpDateTime } from '@/lib/aptitude/client';
import { GradeBadge, StateBadge } from './AptitudeBadges';

const STATES: SessionState[] = ['未受検', '受検中', '完了', '期限切れ', '取消'];

/** ISO → 日本時間の YYYY-MM-DD（日付の絞り込み用）。 */
const jstDay = (v: string) => (v ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(v)) : '');

export default function AptitudeHistoryUI() {
  const router = useRouter();
  const [items, setItems] = useState<HistoryRow[] | null>(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState({ from: '', to: '', base: '', role: '', state: '', method: '', deleted: false });

  useEffect(() => {
    (async () => {
      const r = await api<{ items: HistoryRow[] }>('/api/aptitude/history');
      if (!r.ok) { setItems([]); return setMsg(failText(r)); }
      setItems(r.items);
    })();
  }, []);

  const filtered = useMemo(() => (items ?? []).filter((x) => {
    const day = jstDay(x.completedAt || x.createdAt);
    if (q.from && day < q.from) return false;
    if (q.to && day > q.to) return false;
    if (q.base && x.base !== q.base) return false;
    if (q.role && x.role !== q.role) return false;
    if (q.state && x.state !== q.state) return false;
    if (q.method && x.method !== q.method) return false;
    if (!q.deleted && x.deleted) return false;
    return true;
  }), [items, q]);

  const set = (k: keyof typeof q, v: string | boolean) => setQ((p) => ({ ...p, [k]: v }));

  return (
    <div className="ib apt">
      <div className="apt-titlebar"><h1 className="apt-h1">受検履歴</h1></div>
      {msg && <p className="ib-note ib-note-err" role="alert">{msg}</p>}
      <div className="ib-toolbar">
        <label className="apt-inline">受検日<input type="date" value={q.from} onChange={(e) => set('from', e.target.value)} />〜<input type="date" value={q.to} onChange={(e) => set('to', e.target.value)} /></label>
        <select value={q.base} onChange={(e) => set('base', e.target.value)} aria-label="拠点">
          <option value="">拠点：すべて</option>
          {BASES.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select value={q.role} onChange={(e) => set('role', e.target.value)} aria-label="職種">
          <option value="">職種：すべて</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <select value={q.state} onChange={(e) => set('state', e.target.value)} aria-label="状態">
          <option value="">状態：すべて</option>
          {STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={q.method} onChange={(e) => set('method', e.target.value)} aria-label="受検方法">
          <option value="">方法：すべて</option>
          {METHODS.map((m) => <option key={m}>{m}</option>)}
        </select>
        <label className="apt-check"><input type="checkbox" checked={q.deleted} onChange={(e) => set('deleted', e.target.checked)} />削除済みも出す</label>
      </div>
      <div className="ib-list-head"><span>{items == null ? '読み込み中…' : `${filtered.length}件`}</span></div>
      <div className="ib-table-wrap">
        <table className="ib-table apt-table">
          <thead><tr><th>受検日時</th><th>拠点</th><th>氏名</th><th>性別</th><th>職種</th><th>方法</th><th>状態</th><th>判定</th><th>版</th></tr></thead>
          <tbody>
            {filtered.map((x) => (
              <tr key={x.sessionId} className={x.deleted ? 'apt-deleted' : 'ib-row'} tabIndex={x.deleted ? -1 : 0}
                onClick={() => !x.deleted && router.push(`/aptitude/c/${x.candidateId}`)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !x.deleted) router.push(`/aptitude/c/${x.candidateId}`); }}>
                <td className="ib-date">{jpDateTime(x.completedAt) || <span className="apt-muted">発行 {jpDateTime(x.createdAt)}</span>}</td>
                <td>{x.base}</td>
                <td className="ib-name"><b>{x.name}</b>{x.kana && <small>{x.kana}</small>}</td>
                <td>{x.gender || <span className="apt-muted">—</span>}</td>
                <td>{ROLE_LABEL[x.role]}</td>
                <td>{x.method}</td>
                <td>{x.deleted ? <span className="apt-state off">削除済み</span> : <StateBadge state={x.state} />}</td>
                <td><GradeBadge grade={x.grade} /></td>
                <td>{x.versionId}</td>
              </tr>
            ))}
            {items != null && filtered.length === 0 && <tr><td colSpan={9} className="ib-empty">該当する受検はありません。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
