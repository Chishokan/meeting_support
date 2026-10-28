'use client';

// 適性検査：受検者1人の詳細。
//   受検：受検URLの発行・コピー（案内文つき）・延長・取消、紙回答の代理入力、受検の履歴
//   結果：完了した受検ごとの判定（AptitudeResult）
//   採用結果・入社後の評価：校正用CSVに出る
//   閲覧ログ：結果の閲覧・CSV出力などの記録
// 詳細を読むと、結果があればサーバが「結果閲覧」を記録する（同じ人の10分以内の読み直しは1件にまとめる）。

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HIRE_STATUSES, RETENTION, ROLE_LABEL, ageOf, todayJst, type Candidate, type Role, type RoleRule, type Scale } from '@/lib/aptitude/model';
import type { LogRow, SessionView } from '@/lib/aptitude/store';
import { api, failText, jpDate, jpDateTime } from '@/lib/aptitude/client';
import AptitudeCandidateForm from './AptitudeCandidateForm';
import AptitudePaperForm from './AptitudePaperForm';
import AptitudeResult from './AptitudeResult';
import { StateBadge } from './AptitudeBadges';

type VersionInfo = { name: string; scales: Scale[]; rules: Record<Role, RoleRule> };
type Detail = { candidate: Candidate; sessions: SessionView[]; versions: Record<string, VersionInfo>; logs: LogRow[] };

const examUrl = (token: string) => `${window.location.origin}/exam/${token}`;

function inviteText(name: string, url: string, expiresAt: string): string {
  return [
    `${name} さん`,
    '',
    '智翔館グループの採用選考にご応募いただき、ありがとうございます。',
    '選考の一つとして、適性検査（「はい」「いいえ」で答える100問・10〜15分ほど）の受検をお願いします。',
    'スマートフォンかパソコンで、下のURLから受検してください。',
    '',
    url,
    '',
    `受検期限：${jpDateTime(expiresAt)}`,
    '途中で閉じても、同じURLから続きを再開できます。',
  ].join('\n');
}

export default function AptitudeDetailUI({ id }: { id: string }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [paper, setPaper] = useState(false);
  const [pick, setPick] = useState('');
  const [hire, setHireState] = useState<{ hireStatus: Candidate['hireStatus']; postEval: number | null; postEvalNote: string } | null>(null);
  // 採用結果の欄を書きかけのあいだは、URL の発行などで読み直しても入力を消さない
  const hireTouched = useRef(false);
  const setHire = (h: NonNullable<typeof hire>) => { hireTouched.current = true; setHireState(h); };

  const load = useCallback(async () => {
    const r = await api<Detail>(`/api/aptitude/candidates/${id}`);
    if (!r.ok) return setMsg(failText(r));
    setD(r);
    if (!hireTouched.current) setHireState({ hireStatus: r.candidate.hireStatus, postEval: r.candidate.postEval, postEvalNote: r.candidate.postEvalNote });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function act(body: Record<string, unknown>, done?: string) {
    setBusy(true);
    setMsg('');
    setOk('');
    const r = await api('/api/aptitude/sessions', { body });
    setBusy(false);
    if (!r.ok) return setMsg(failText(r));
    if (done) setOk(done);
    await load();
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setOk(`${what}をコピーしました。LINE WORKS やメールに貼り付けて送ってください。`);
    } catch {
      setMsg('コピーできませんでした。表示されている URL を選んでコピーしてください。');
    }
  }

  async function saveHire() {
    if (!d || !hire) return;
    setBusy(true);
    setMsg('');
    setOk('');
    // 採用結果・評価だけを送る（ほかの項目を、画面を開いたときの古い値で上書きしないため）
    const r = await api(`/api/aptitude/candidates/${id}`, { method: 'PATCH', body: hire });
    setBusy(false);
    if (!r.ok) return setMsg(failText(r));
    setOk('採用結果・評価を保存しました。');
    hireTouched.current = false;
    await load();
  }

  async function remove() {
    if (!d) return;
    if (!confirm(`${d.candidate.name} さんを削除しますか？\n一覧から消え、${RETENTION.deletedDays}日後に受検の記録・結果ごと完全に削除されます。未完了の受検URLは使えなくなります。`)) return;
    setBusy(true);
    const r = await api(`/api/aptitude/candidates/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (!r.ok) return setMsg(failText(r));
    router.push('/aptitude');
  }

  if (!d) {
    return (
      <div className="ib apt">
        <Link href="/aptitude" className="apt-back">← 受検者の一覧</Link>
        {msg ? <p className="ib-note ib-note-err" role="alert">{msg}</p> : <p className="apt-muted">読み込み中…</p>}
      </div>
    );
  }

  const c = d.candidate;
  const age = ageOf(c.birthDate, todayJst());
  // いま使える（または期限を延ばせば使える）Web 受検。期限切れでも、延ばせば途中までの回答を引き継いで続きから受けられる
  const open = d.sessions.find((x) => x.method === 'Web' && (x.state === '未受検' || x.state === '受検中' || x.state === '期限切れ'));
  const expired = open?.state === '期限切れ';
  const done = d.sessions.filter((x) => x.state === '完了' && x.result);
  const shown = done.find((x) => x.id === pick) ?? done[0];
  const hireDirty = hire && (hire.hireStatus !== c.hireStatus || hire.postEval !== c.postEval || hire.postEvalNote !== c.postEvalNote);

  return (
    <div className="ib apt">
      <Link href="/aptitude" className="apt-back">← 受検者の一覧</Link>

      <section className="apt-card apt-profile">
        <div className="apt-profile-main">
          <h1 className="apt-h1">{c.name}{c.kana && <small>{c.kana}</small>}</h1>
          <div className="apt-chips">
            <span className="apt-chip strong">{ROLE_LABEL[c.role]}</span>
            <span className="apt-chip">{c.base}</span>
            {c.gender && <span className="apt-chip">{c.gender}</span>}
            {age != null && <span className="apt-chip">{age}歳（{c.birthDate}）</span>}
            <span className="apt-chip">採用結果：{c.hireStatus}</span>
          </div>
          <div className="apt-contact">
            {c.phone && <span>電話 {c.phone}</span>}
            {c.email && <span>メール {c.email}</span>}
            <span className="apt-muted">登録 {jpDate(c.createdAt)}（{c.createdBy}）</span>
          </div>
          {c.memo && <p className="apt-memo">{c.memo}</p>}
        </div>
        <div className="apt-profile-actions">
          <button className="ib-ghost" onClick={() => setEditing(true)} disabled={busy}>編集</button>
          <button className="ib-delete" onClick={remove} disabled={busy}>削除</button>
        </div>
      </section>

      {msg && <p className="ib-note ib-note-err" role="alert">{msg}</p>}
      {ok && <p className="ib-note ib-note-dev" role="status">{ok}</p>}

      <section className="apt-card">
        <div className="apt-sec-head">
          <h2 className="apt-h2">受検</h2>
          <div className="apt-actions">
            <button className="ib-primary" disabled={busy} onClick={() => {
              if (open && !confirm(`いまの受検URLを取り消して、新しいURLを発行しますか？（途中までの回答${open.answered ? `${open.answered}問` : ''}は引き継ぎません。${expired ? '続きから受けてもらうなら［期限を延ばす］を使ってください。' : ''}）`)) return;
              act({ action: 'issue', candidateId: id }, '受検URLを発行しました。下の［案内文をコピー］から送ってください。');
            }}>{open ? '新しいURLを発行' : '受検URLを発行'}</button>
            <button className="ib-ghost" disabled={busy} onClick={() => setPaper(true)}>紙の回答を入力</button>
          </div>
        </div>

        {open && (
          <div className="apt-url-box">
            <div className="apt-url-row">
              <input readOnly value={examUrl(open.token)} onFocus={(e) => e.target.select()} aria-label="受検URL" />
              <button className="ib-ghost" disabled={expired} onClick={() => copy(examUrl(open.token), '受検URL')}>URLをコピー</button>
              <button className="ib-primary" disabled={expired} onClick={() => copy(inviteText(c.name, examUrl(open.token), open.expiresAt), '案内文')}>案内文をコピー</button>
            </div>
            {expired && <p className="apt-legend apt-expired-note">有効期限が切れています。［期限を延ばす］と、同じURLのまま途中までの回答を引き継いで続きから受けられます。</p>}
            <div className="apt-url-meta">
              <StateBadge state={open.state} />
              <span>回答 {open.answered} / {open.total}</span>
              <span>期限 {jpDateTime(open.expiresAt)}</span>
              <button className="ib-link" disabled={busy} onClick={() => act({ action: 'extend', id: open.id }, '有効期限を延ばしました。')}>期限を延ばす</button>
              <button className="ib-link" disabled={busy} onClick={() => confirm('この受検URLを取り消しますか？（受検者はこのURLで受けられなくなります）') && act({ action: 'revoke', id: open.id }, '受検URLを取り消しました。')}>取り消す</button>
            </div>
          </div>
        )}

        {d.sessions.length > 0 ? (
          <div className="ib-table-wrap apt-plain-wrap">
            <table className="ib-table apt-table">
              <thead><tr><th>発行</th><th>方法</th><th>職種</th><th>版</th><th>状態</th><th>回答</th><th>期限</th><th>完了</th></tr></thead>
              <tbody>
                {d.sessions.map((x) => (
                  <tr key={x.id}>
                    <td className="ib-date">{jpDateTime(x.createdAt)}<small className="apt-sub">{x.createdBy}</small></td>
                    <td>{x.method}</td>
                    <td>{ROLE_LABEL[x.role]}</td>
                    <td>{x.versionId}</td>
                    <td><StateBadge state={x.state} /></td>
                    <td>{x.answered} / {x.total}</td>
                    <td className="ib-date">{x.method === 'Web' && x.state !== '完了' ? jpDateTime(x.expiresAt) : ''}</td>
                    <td className="ib-date">{jpDateTime(x.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="apt-muted">まだ受検URLを発行していません。</p>}
      </section>

      <section className="apt-card">
        <div className="apt-sec-head">
          <h2 className="apt-h2">結果</h2>
          {done.length > 1 && (
            <select value={shown?.id} onChange={(e) => setPick(e.target.value)} aria-label="表示する受検">
              {done.map((x) => <option key={x.id} value={x.id}>{jpDateTime(x.completedAt)}（{x.method}・{x.versionId}）</option>)}
            </select>
          )}
        </div>
        <p className="ib-note apt-caution-note">判定は<b>面接の参考資料</b>です。判定だけで採否を決めず、面接での確認ポイントとあわせて判断してください。</p>
        {shown ? <AptitudeResult session={shown} version={d.versions[shown.versionId]} /> : <p className="apt-muted">受検が完了すると、ここに結果が出ます。</p>}
      </section>

      {hire && (
        <section className="apt-card">
          <h2 className="apt-h2">採用結果・入社後の評価</h2>
          <div className="ib-grid apt-hire">
            <label>採用結果
              <select value={hire.hireStatus} onChange={(e) => setHire({ ...hire, hireStatus: e.target.value as Candidate['hireStatus'] })}>
                {HIRE_STATUSES.map((h) => <option key={h}>{h}</option>)}
              </select>
            </label>
            <label>入社後の評価（1〜5）
              <select value={hire.postEval ?? ''} onChange={(e) => setHire({ ...hire, postEval: e.target.value ? Number(e.target.value) : null })}>
                <option value="">未評価</option>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="wide">評価のメモ<input value={hire.postEvalNote} onChange={(e) => setHire({ ...hire, postEvalNote: e.target.value })} placeholder="例 生徒アンケート高評価・半年で退職 など" /></label>
          </div>
          <div className="apt-hire-foot">
            <button className="ib-primary" disabled={busy || !hireDirty} onClick={saveHire}>保存</button>
            <span className="apt-legend">不採用・辞退にすると、その日から{RETENTION.deniedDays}日で受検者・結果を自動的に削除します。入社後の評価は判定基準の校正（校正用CSV）に使います。</span>
          </div>
        </section>
      )}

      <details className="apt-card apt-details">
        <summary>閲覧ログ（{d.logs.length}件）</summary>
        <table className="ib-table apt-log">
          <tbody>
            {d.logs.map((l, i) => (
              <tr key={i}><td className="ib-date">{jpDateTime(l.at)}</td><td>{l.actor}<small className="apt-sub">{l.actorCampus}</small></td><td>{l.action}</td><td>{l.detail}</td></tr>
            ))}
          </tbody>
        </table>
      </details>

      {editing && <AptitudeCandidateForm candidate={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setOk('保存しました。'); load(); }} />}
      {paper && <AptitudePaperForm candidateId={id} name={c.name} onClose={() => setPaper(false)} onSaved={() => { setPaper(false); setOk('紙の回答を採点しました。'); load(); }} />}
    </div>
  );
}
