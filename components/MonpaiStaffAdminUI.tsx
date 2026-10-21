'use client';

// 門配管理：門配スタッフ（大学生・アルバイト）の名簿。ここに載せた人が、スタッフ専用画面（/monpai-staff）に
// 「所属」と「名前」を選んでログインできる。スタッフ専用画面では、自分が担当の門配の報告と月間の計画だけが見られる。
// 編集できるのは学校マスタと同じ部門だけ。

import { useEffect, useMemo, useState } from 'react';
import { groupStaff, type MonpaiStaff } from '@/lib/monpai/model';
import { fetchStaff, reasonText, staffApi } from '@/lib/monpai/client';

type Row = { affiliation: string; name: string; order: string; note: string };
const blank = (affiliation = ''): Row => ({ affiliation, name: '', order: '', note: '' });

export default function MonpaiStaffAdminUI({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<MonpaiStaff[]>([]);
  const [add, setAdd] = useState<Row>(blank());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [loginUrl, setLoginUrl] = useState('/monpai-staff/login');

  async function load() {
    const r = await fetchStaff();
    if (!r.ok) return setMsg(reasonText(r.reason));
    setItems(r.items);
  }
  useEffect(() => {
    load();
    setLoginUrl(`${window.location.origin}/monpai-staff/login`);
  }, []);

  const affiliations = useMemo(() => groupStaff(items).map((g) => g.affiliation), [items]);
  const sorted = useMemo(
    () => [...items].sort((a, b) => affiliations.indexOf(a.affiliation) - affiliations.indexOf(b.affiliation) || a.order - b.order || a.name.localeCompare(b.name, 'ja')),
    [items, affiliations],
  );

  async function run(p: Promise<{ ok: boolean; reason?: string; errors?: string[] }>, after?: () => void) {
    setBusy(true);
    setMsg('');
    const r = await p;
    setBusy(false);
    if (!r.ok) return setMsg(r.errors?.join(' ') || reasonText(r.reason ?? ''));
    after?.();
    await load();
  }

  const save = (s: MonpaiStaff) => run(staffApi('POST', { ...s }));

  return (
    <div className="mp mp-schools">
      <div className="mp-toolbar"><h1 className="mp-h1">門配スタッフ</h1></div>
      <div className="mp-note">
        大学生・アルバイトのスタッフは、下の URL から「所属」と「名前」を選んでログインします。
        見られるのは<b>自分が担当の門配の報告と月間の計画だけ</b>で、会議DXなど他のアプリには入れません。
        <br />スタッフ用 URL：<a href="/monpai-staff/login" target="_blank" rel="noopener noreferrer">{loginUrl}</a>
      </div>
      {!canEdit && <div className="mp-note">閲覧のみです。追加・変更は管理部門に依頼してください。</div>}
      {msg && <div className="mp-note warn">{msg}</div>}

      <div className="ib-table-wrap">
        <table className="mp-summary mp-edit-table">
          <thead>
            <tr><th>所属</th><th>名前</th><th>並び順</th><th>ログイン</th><th>備考</th>{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={`${s.affiliation}|${s.name}`} className={s.active ? '' : 'mp-muted'}>
                <td>{s.affiliation}</td>
                <td className="mp-school">{s.name}</td>
                <td className="mp-num">{s.order}</td>
                <td>{s.active ? 'できる' : '停止中'}</td>
                <td>{s.note}</td>
                {canEdit && (
                  <td className="mp-row-actions">
                    <button className="mp-btn" disabled={busy} onClick={() => save({ ...s, active: !s.active })}>
                      {s.active ? 'ログイン停止' : 'ログイン再開'}
                    </button>
                    <button className="mp-btn danger" disabled={busy} onClick={() => confirm(`${s.affiliation}／${s.name} を名簿から外しますか？（過去の門配の記録は残ります）`) && run(staffApi('DELETE', { affiliation: s.affiliation, name: s.name }))}>外す</button>
                  </td>
                )}
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={6} className="mp-muted">名簿にまだ誰もいません。{canEdit && '下の欄から追加してください。'}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mp-legend">
        門配の記録の担当欄に、ここの名前（または姓だけ）を書くと、そのスタッフの画面に出ます。
        例：名前「松田花子」なら、担当欄が「松田」でも「松田花子」でも本人の担当になります（同じ姓の人が2人いるときはフルネームで書く）。
      </p>

      {canEdit && (
        <section className="mp-card">
          <h2 className="mp-h2" style={{ marginTop: 0 }}>スタッフを追加</h2>
          <div className="mp-add-row">
            <label>所属
              <input list="mp-affiliations" value={add.affiliation} placeholder="例 RED個別 日野校" onChange={(e) => setAdd({ ...add, affiliation: e.target.value })} />
              <datalist id="mp-affiliations">{affiliations.map((a) => <option key={a} value={a} />)}</datalist>
            </label>
            <label>名前<input value={add.name} placeholder="例 松田花子" onChange={(e) => setAdd({ ...add, name: e.target.value })} /></label>
            <label>並び順<input type="number" value={add.order} placeholder="0" onChange={(e) => setAdd({ ...add, order: e.target.value })} /></label>
            <label>備考<input value={add.note} placeholder="例 長崎県立大学2年" onChange={(e) => setAdd({ ...add, note: e.target.value })} /></label>
            <button className="mp-btn primary" disabled={busy} onClick={() => run(
              staffApi('POST', { ...add, order: Number(add.order || 0), active: true }),
              () => setAdd(blank(add.affiliation)),
            )}>追加</button>
          </div>
        </section>
      )}
    </div>
  );
}
