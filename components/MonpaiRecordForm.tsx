'use client';

// 門配の記録1件の入力・編集（月間一覧から開くモーダル）。計画と実績を同じ画面で扱う。

import { useState } from 'react';
import type { MonpaiRecord, School } from '@/lib/monpai/model';
import { weekOf } from '@/lib/monpai/model';
import { deleteRecordApi, reasonText, saveRecordApi } from '@/lib/monpai/client';

export type Draft = Partial<MonpaiRecord> & { date: string; district: string; school: string };

export default function MonpaiRecordForm({
  draft, schools, staffNames, onClose, onSaved, onDeleted,
}: {
  draft: Draft;
  schools: School[]; // この地区の学校
  staffNames: string[];
  onClose: () => void;
  onSaved: (r: MonpaiRecord) => void;
  onDeleted: (id: string) => void;
}) {
  const [f, setF] = useState({
    date: draft.date,
    school: draft.school,
    time: draft.time ?? '',
    staff1: draft.staff1 ?? '',
    staff2: draft.staff2 ?? '',
    material: draft.material ?? '',
    planned: draft.planned != null ? String(draft.planned) : '',
    done: draft.done != null ? String(draft.done) : '',
    cancel: draft.status === '中止',
    reason: draft.reason ?? '',
    memo: draft.memo ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string[]>([]);
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    setErr([]);
    const r = await saveRecordApi({
      id: draft.id,
      district: draft.district,
      date: f.date,
      school: f.school,
      time: f.time,
      staff1: f.staff1,
      staff2: f.staff2,
      material: f.material,
      planned: f.planned === '' ? 0 : Number(f.planned),
      done: f.done === '' ? null : Number(f.done),
      status: f.cancel ? '中止' : '予定',
      reason: f.reason,
      memo: f.memo,
    });
    setBusy(false);
    if (!r.ok) return setErr(r.errors?.length ? r.errors : [reasonText(r.reason)]);
    onSaved(r.item);
  }

  async function remove() {
    if (!draft.id || !confirm('この門配の記録を削除しますか？')) return;
    setBusy(true);
    const r = await deleteRecordApi(draft.id);
    setBusy(false);
    if (!r.ok) return setErr([reasonText(r.reason ?? '')]);
    onDeleted(draft.id);
  }

  return (
    <div className="mp-modal-bg" onClick={onClose}>
      <div className="mp-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mp-modal-head">
          <h2>{draft.id ? '門配を編集' : '門配を追加'}</h2>
          <span className="mp-modal-sub">{draft.district}地区</span>
        </div>
        <div className="mp-form">
          <label>日付<input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
            {f.date && <span className="mp-week">（{weekOf(f.date)}）</span>}
          </label>
          <label>学校
            <select value={f.school} onChange={(e) => set('school', e.target.value)}>
              {schools.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </label>
          <label>時間<input value={f.time} placeholder="例 16:00-17:00" onChange={(e) => set('time', e.target.value)} /></label>
          <div className="mp-form-row">
            <label>担当1<input list="mp-staff" value={f.staff1} onChange={(e) => set('staff1', e.target.value)} /></label>
            <label>担当2<input list="mp-staff" value={f.staff2} onChange={(e) => set('staff2', e.target.value)} /></label>
          </div>
          <datalist id="mp-staff">{staffNames.map((n) => <option key={n} value={n} />)}</datalist>
          <label>配布物・ノベルティ<input value={f.material} placeholder="例 冬期講習チラシ＋ノート" onChange={(e) => set('material', e.target.value)} /></label>
          <div className="mp-form-row">
            <label>計画部数<input type="number" min={0} inputMode="numeric" value={f.planned} onChange={(e) => set('planned', e.target.value)} /></label>
            <label>実施部数<input type="number" min={0} inputMode="numeric" value={f.done} placeholder="配ったら入力" onChange={(e) => set('done', e.target.value)} /></label>
          </div>
          <label className="mp-check"><input type="checkbox" checked={f.cancel} onChange={(e) => set('cancel', e.target.checked)} />中止した（配れなかった）</label>
          {(f.cancel || (f.done !== '' && Number(f.done) < Number(f.planned || 0))) && (
            <label>不実施理由・少なかった理由<input value={f.reason} placeholder="例 雨天、学校行事で下校時刻変更" onChange={(e) => set('reason', e.target.value)} /></label>
          )}
          <label>反応・様子<textarea rows={2} value={f.memo} placeholder="例 部活生が多く受け取りが良かった" onChange={(e) => set('memo', e.target.value)} /></label>
          {err.length > 0 && <div className="mp-err">{err.map((e) => <div key={e}>{e}</div>)}</div>}
          {draft.updatedAt && <div className="mp-meta">最終更新：{draft.updatedAt} {draft.updatedBy}</div>}
        </div>
        <div className="mp-modal-foot">
          {draft.id && <button className="mp-btn danger" disabled={busy} onClick={remove}>削除</button>}
          <span className="mp-spacer" />
          <button className="mp-btn" disabled={busy} onClick={onClose}>閉じる</button>
          <button className="mp-btn primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}
