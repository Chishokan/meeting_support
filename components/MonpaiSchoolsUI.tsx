'use client';

// 門配管理：学校マスタ（地区・学校・生徒数）と月別設定（募集期・率の上書き）。
// ボトム＝生徒数 × 率（中学校20%・小学校30%・募集期60%）。編集できるのは管理部門だけ。

import { useEffect, useMemo, useState } from 'react';
import { DISTRICTS, RATES, bottomOf, todayJst, type MonthSetting, type School } from '@/lib/monpai/model';
import { fetchMaster, masterApi, reasonText } from '@/lib/monpai/client';

type Row = { name: string; district: string; kind: string; students: string; order: string; note: string };
const toRow = (s: School): Row => ({ ...s, students: String(s.students), order: String(s.order) });
const blank = (district: string): Row => ({ name: '', district, kind: '中', students: '', order: '', note: '' });

export default function MonpaiSchoolsUI({ canEdit }: { canEdit: boolean }) {
  const [district, setDistrict] = useState<string>(DISTRICTS[0]);
  const [schools, setSchools] = useState<School[]>([]);
  const [settings, setSettings] = useState<MonthSetting[]>([]);
  const [edits, setEdits] = useState<Record<string, Row>>({});
  const [add, setAdd] = useState<Row>(blank(DISTRICTS[0]));
  const [month, setMonth] = useState(todayJst().slice(0, 7));
  const [st, setSt] = useState({ school: '', rate: '', recruit: false });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetchMaster();
    if (!r.ok) return setMsg(reasonText(r.reason));
    setSchools(r.master.schools);
    setSettings(r.master.settings);
    setEdits({});
  }
  useEffect(() => { load(); }, []);

  const list = useMemo(
    () => schools.filter((s) => s.district === district).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [schools, district],
  );
  const counts = useMemo(() => Object.fromEntries(DISTRICTS.map((d) => [d, schools.filter((s) => s.district === d).length])), [schools]);

  async function run(p: Promise<{ ok: boolean; reason?: string; errors?: string[] }>, after?: () => void) {
    setBusy(true);
    setMsg('');
    const r = await p;
    setBusy(false);
    if (!r.ok) return setMsg(r.errors?.join(' ') || reasonText(r.reason ?? ''));
    after?.();
    await load();
  }

  const saveRow = (r: Row) => run(masterApi('POST', { type: 'school', ...r, students: Number(r.students), order: Number(r.order || 0) }));

  function pickDistrict(d: string) {
    setDistrict(d);
    setAdd(blank(d));
  }

  const monthSettings = settings.filter((x) => x.month === month).sort((a, b) => a.school.localeCompare(b.school));

  return (
    <div className="mp mp-schools">
      <div className="mp-toolbar"><h1 className="mp-h1">学校マスタ</h1></div>
      {!canEdit && <div className="mp-note">閲覧のみです。追加・変更は管理部門に依頼してください。</div>}
      {msg && <div className="mp-note">{msg}</div>}

      <div className="mp-tabs" style={{ marginBottom: 12 }}>
        {DISTRICTS.map((d) => (
          <button key={d} className={`mp-tab ${d === district ? 'active' : ''}`} onClick={() => pickDistrict(d)}>
            {d}<span className="mp-tab-count">{counts[d] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="ib-table-wrap">
        <table className="mp-summary mp-edit-table">
          <thead>
            <tr><th>並び順</th><th>学校名</th><th>種別</th><th>生徒数</th><th>ボトム（通常）</th><th>備考</th>{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {list.map((s) => {
              const e = edits[s.name] ?? toRow(s);
              const dirty = !!edits[s.name];
              const set = (k: keyof Row, v: string) => setEdits((p) => ({ ...p, [s.name]: { ...e, [k]: v } }));
              return (
                <tr key={s.name}>
                  <td className="mp-w-num">{canEdit ? <input type="number" value={e.order} onChange={(x) => set('order', x.target.value)} /> : s.order}</td>
                  <td className="mp-school">{s.name}</td>
                  <td className="mp-w-kind">{canEdit ? (
                    <select value={e.kind} onChange={(x) => set('kind', x.target.value)}><option>中</option><option>小</option></select>
                  ) : s.kind}</td>
                  <td className="mp-w-num">{canEdit ? <input type="number" min={0} value={e.students} onChange={(x) => set('students', x.target.value)} /> : s.students}</td>
                  <td className="mp-num">{bottomOf(s, [], month).bottom}<span className="mp-rate">{Math.round(RATES[s.kind].normal * 100)}%</span></td>
                  <td>{canEdit ? <input value={e.note} onChange={(x) => set('note', x.target.value)} /> : s.note}</td>
                  {canEdit && (
                    <td className="mp-row-actions">
                      <button className="mp-btn primary" disabled={busy || !dirty} onClick={() => saveRow(e)}>保存</button>
                      <button className="mp-btn danger" disabled={busy} onClick={() => confirm(`${s.name} を学校マスタから外しますか？（過去の門配の記録は残ります）`) && run(masterApi('DELETE', { type: 'school', name: s.name }))}>外す</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={7} className="mp-muted">{district}地区の学校はまだありません。{canEdit && '下の欄から追加してください。'}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mp-legend">生徒数は、中学校＝全校生徒数、小学校＝小2〜6の生徒数。ボトムは通常月の値（募集期や率の上書きは下の「月別設定」）。</p>

      {canEdit && (
        <section className="mp-card">
          <h2 className="mp-h2" style={{ marginTop: 0 }}>{district}地区に学校を追加</h2>
          <div className="mp-add-row">
            <label>学校名<input value={add.name} placeholder="例 佐々中" onChange={(e) => setAdd({ ...add, name: e.target.value })} /></label>
            <label>種別<select value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value })}><option>中</option><option>小</option></select></label>
            <label>生徒数<input type="number" min={0} value={add.students} placeholder={add.kind === '中' ? '全校' : '小2〜6'} onChange={(e) => setAdd({ ...add, students: e.target.value })} /></label>
            <label>並び順<input type="number" value={add.order} placeholder={String(list.length + 1)} onChange={(e) => setAdd({ ...add, order: e.target.value })} /></label>
            <label>備考<input value={add.note} onChange={(e) => setAdd({ ...add, note: e.target.value })} /></label>
            <button className="mp-btn primary" disabled={busy} onClick={() => run(
              masterApi('POST', { type: 'school', ...add, students: Number(add.students), order: Number(add.order || list.length + 1) }),
              () => setAdd(blank(district)),
            )}>追加</button>
          </div>
        </section>
      )}

      <h2 className="mp-h2">月別設定（募集期・率の上書き）</h2>
      <div className="mp-month" style={{ marginBottom: 8 }}>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="mp-month-input" />
      </div>
      <div className="ib-table-wrap">
        <table className="mp-summary">
          <thead><tr><th>対象</th><th>募集期</th><th>率の上書き</th>{canEdit && <th />}</tr></thead>
          <tbody>
            {monthSettings.map((x) => (
              <tr key={x.school || '_all'}>
                <td className="mp-school">{x.school || '全校'}</td>
                <td>{x.recruit ? '募集期（60%）' : ''}</td>
                <td>{x.rate != null ? `${Math.round(x.rate * 100)}%` : ''}</td>
                {canEdit && <td className="mp-row-actions"><button className="mp-btn danger" disabled={busy} onClick={() => run(masterApi('DELETE', { type: 'setting', month, school: x.school }))}>削除</button></td>}
              </tr>
            ))}
            {monthSettings.length === 0 && <tr><td colSpan={4} className="mp-muted">この月の設定はありません（通常の率：中学校20%・小学校30%）。</td></tr>}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="mp-add-row" style={{ marginTop: 10 }}>
          <label>対象
            <select value={st.school} onChange={(e) => setSt({ ...st, school: e.target.value })}>
              <option value="">全校</option>
              {schools.slice().sort((a, b) => a.district.localeCompare(b.district) || a.order - b.order).map((s) => (
                <option key={s.name} value={s.name}>{s.district}・{s.name}</option>
              ))}
            </select>
          </label>
          <label className="mp-check"><input type="checkbox" checked={st.recruit} onChange={(e) => setSt({ ...st, recruit: e.target.checked })} />募集期</label>
          <label>率の上書き（%）<input type="number" min={1} max={100} value={st.rate} placeholder="例 50（空欄なら上書きしない）" onChange={(e) => setSt({ ...st, rate: e.target.value })} /></label>
          <button className="mp-btn primary" disabled={busy} onClick={() => run(masterApi('POST', { type: 'setting', month, ...st }), () => setSt({ school: '', rate: '', recruit: false }))}>設定する</button>
        </div>
      )}
      <p className="mp-legend">学校ごとの設定は「全校」の設定より優先します。例：開校月は 大野中 50%、2月は 全校 募集期。</p>
    </div>
  );
}
