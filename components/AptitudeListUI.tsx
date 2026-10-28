'use client';

// 適性検査：受検者の一覧。拠点・職種・判定・受検の状態・採用結果で絞り込み、登録日の新しい順に出す。
// 行を押すと詳細（受検URLの発行・結果）へ。

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASES, GENDERS, HIRE_STATUSES, ROLES, ROLE_LABEL, todayJst, ageOf, type Candidate, type SessionState } from '@/lib/aptitude/model';
import type { CandidateSummary } from '@/lib/aptitude/store';
import { api, failText, jpDate } from '@/lib/aptitude/client';
import AptitudeCandidateForm from './AptitudeCandidateForm';
import { FlagMarks, GradeBadge, StateBadge } from './AptitudeBadges';

const STATES: (SessionState | '未発行')[] = ['未発行', '未受検', '受検中', '完了', '期限切れ', '取消'];
const PAGE_SIZES = [10, 20, 50, 100];

export default function AptitudeListUI() {
  const router = useRouter();
  const [items, setItems] = useState<CandidateSummary[] | null>(null);
  const [backend, setBackend] = useState('');
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState({ base: '', role: '', grade: '', state: '', hire: '', gender: '', text: '' });
  const [size, setSize] = useState(20);
  const [page, setPage] = useState(0);

  async function load() {
    const r = await api<{ items: CandidateSummary[]; backend: string }>('/api/aptitude/candidates');
    if (!r.ok) {
      setItems([]);
      return setMsg(failText(r));
    }
    setItems(r.items);
    setBackend(r.backend);
  }
  useEffect(() => { load(); }, []);

  const set = (k: keyof typeof q, v: string) => { setQ((p) => ({ ...p, [k]: v })); setPage(0); };

  const filtered = useMemo(() => {
    const t = q.text.trim().replace(/\s+/g, '');
    return (items ?? []).filter((c) => {
      if (q.base && c.base !== q.base) return false;
      if (q.role && c.role !== q.role) return false;
      if (q.gender && c.gender !== q.gender) return false;
      if (q.hire && c.hireStatus !== q.hire) return false;
      if (q.grade && (q.grade === '未判定' ? !!c.result : c.result?.grade !== q.grade)) return false;
      if (q.state && (c.latest?.state ?? '未発行') !== q.state) return false;
      if (t && !`${c.name}${c.kana}`.replace(/\s+/g, '').includes(t)) return false;
      return true;
    });
  }, [items, q]);

  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const shown = filtered.slice(page * size, page * size + size);
  const today = todayJst();

  function onSaved(c: Candidate) {
    setAdding(false);
    router.push(`/aptitude/c/${c.id}`);
  }

  return (
    <div className="ib apt">
      <div className="apt-titlebar">
        <h1 className="apt-h1">受検者</h1>
        <div className="apt-actions">
          <a className="ib-ghost" href="/api/aptitude/export" title="得点と入社後の評価を突き合わせて、判定基準を見直すための CSV（氏名・連絡先は入りません）">校正用CSV</a>
          <button className="ib-primary" onClick={() => setAdding(true)}>＋ 受検者を登録</button>
        </div>
      </div>
      <p className="ib-note apt-caution-note">判定は<b>面接の参考資料</b>です。判定だけで採否を決めないでください。結果は機微な個人情報のため、受検者の詳細（結果）を開くと閲覧が記録されます。</p>
      {backend === 'local' && <p className="ib-note ib-note-dev">開発用：手元の .data/aptitude.json に保存しています（Supabase 未設定）。</p>}
      {msg && <p className="ib-note ib-note-err" role="alert">{msg}</p>}

      <div className="ib-toolbar">
        <select value={q.base} onChange={(e) => set('base', e.target.value)} aria-label="拠点">
          <option value="">拠点：すべて</option>
          {BASES.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select value={q.role} onChange={(e) => set('role', e.target.value)} aria-label="職種">
          <option value="">職種：すべて</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <select value={q.grade} onChange={(e) => set('grade', e.target.value)} aria-label="判定">
          <option value="">判定：すべて</option>
          {['A', 'B', 'C', '未判定'].map((g) => <option key={g}>{g}</option>)}
        </select>
        <select value={q.state} onChange={(e) => set('state', e.target.value)} aria-label="受検の状態">
          <option value="">受検：すべて</option>
          {STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={q.hire} onChange={(e) => set('hire', e.target.value)} aria-label="採用結果">
          <option value="">採用結果：すべて</option>
          {HIRE_STATUSES.map((h) => <option key={h}>{h}</option>)}
        </select>
        <select value={q.gender} onChange={(e) => set('gender', e.target.value)} aria-label="性別">
          <option value="">性別：すべて</option>
          {GENDERS.map((g) => <option key={g}>{g}</option>)}
        </select>
        <input className="ib-search" value={q.text} onChange={(e) => set('text', e.target.value)} placeholder="氏名・フリガナで検索" />
      </div>

      <div className="ib-list-head">
        <span>{items == null ? '読み込み中…' : `${filtered.length}人${filtered.length !== items.length ? `（全${items.length}人）` : ''}`}</span>
        <label className="apt-size">表示
          <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}件</option>)}
          </select>
        </label>
      </div>

      <div className="ib-table-wrap">
        <table className="ib-table apt-table">
          <thead>
            <tr>
              <th>登録日</th><th>氏名</th><th>職種</th><th>拠点</th><th>性別・年齢</th><th>受検</th><th>判定</th><th>採用結果</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const age = ageOf(c.birthDate, today);
              return (
                <tr key={c.id} className="ib-row" tabIndex={0}
                  onClick={() => router.push(`/aptitude/c/${c.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/aptitude/c/${c.id}`); }}>
                  <td className="ib-date">{jpDate(c.createdAt)}</td>
                  <td className="ib-name"><b>{c.name}</b>{c.kana && <small>{c.kana}</small>}</td>
                  <td>{ROLE_LABEL[c.role]}</td>
                  <td>{c.base}</td>
                  <td>{[c.gender, age != null ? `${age}歳` : ''].filter(Boolean).join('・') || <span className="apt-muted">—</span>}</td>
                  <td>
                    <StateBadge state={c.latest?.state} />
                    {c.latest?.method === '紙' && <small className="apt-sub">紙</small>}
                  </td>
                  <td className="apt-grade-cell">
                    <GradeBadge grade={c.result?.grade} reliable={c.result?.reliable} />
                    {c.result && <FlagMarks flags={c.result.flags} reliable={c.result.reliable} />}
                  </td>
                  <td>{c.hireStatus}{c.postEval != null && <small className="apt-sub">評価 {c.postEval}</small>}</td>
                </tr>
              );
            })}
            {items != null && shown.length === 0 && (
              <tr><td colSpan={8} className="ib-empty">{items.length ? '条件に合う受検者はいません。' : 'まだ受検者がいません。［＋ 受検者を登録］から始めてください。'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="apt-pager">
          <button className="ib-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>← 前へ</button>
          <span>{page + 1} / {pages}</span>
          <button className="ib-ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>次へ →</button>
        </div>
      )}

      {adding && <AptitudeCandidateForm onClose={() => setAdding(false)} onSaved={onSaved} />}
    </div>
  );
}
