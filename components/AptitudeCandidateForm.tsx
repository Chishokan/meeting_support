'use client';

// 適性検査：受検者の登録・編集のポップアップ（一覧の［受検者を登録］と、詳細の［編集］で使う）。

import { useCallback, useState } from 'react';
import { BASES, GENDERS, HIRE_STATUSES, ROLES, ROLE_LABEL, type Candidate, type CandidateInput } from '@/lib/aptitude/model';
import { api, failText } from '@/lib/aptitude/client';
import { useModalDismiss } from '@/lib/useModalDismiss';

const blank: CandidateInput = {
  name: '', kana: '', gender: '', birthDate: '', phone: '', email: '', role: '講師', base: BASES[0],
  hireStatus: '選考中', postEval: null, postEvalNote: '', memo: '',
};

export function inputOf(c: Candidate): CandidateInput {
  const { name, kana, gender, birthDate, phone, email, role, base, hireStatus, postEval, postEvalNote, memo } = c;
  return { name, kana, gender, birthDate, phone, email, role, base, hireStatus, postEval, postEvalNote, memo };
}

export default function AptitudeCandidateForm({
  candidate, onClose, onSaved,
}: { candidate?: Candidate; onClose: () => void; onSaved: (c: Candidate) => void }) {
  const [f, setF] = useState<CandidateInput>(candidate ? inputOf(candidate) : blank);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  useModalDismiss(close);

  const set = <K extends keyof CandidateInput>(k: K, v: CandidateInput[K]) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    setErr('');
    const r = await api<{ item: Candidate }>(candidate ? `/api/aptitude/candidates/${candidate.id}` : '/api/aptitude/candidates', {
      method: candidate ? 'PUT' : 'POST',
      body: f,
    });
    setBusy(false);
    if (!r.ok) return setErr(failText(r));
    onSaved(r.item);
  }

  return (
    <div className="dm-modal-bg" onClick={close}>
      <div className="dm-modal ib-modal apt-form-modal" role="dialog" aria-modal="true" aria-label={candidate ? '受検者の編集' : '受検者の登録'} onClick={(e) => e.stopPropagation()}>
        <div className="dm-modal-head">
          <div>
            <h2>{candidate ? '受検者の編集' : '受検者の登録'}</h2>
            <div className="dm-modal-sub">登録したあと、詳細の画面で受検URLを発行します（紙で受けた人は回答を代理入力できます）。</div>
          </div>
          <button className="dm-modal-close" onClick={close} aria-label="閉じる">×</button>
        </div>
        <div className="dm-modal-body ib-form">
          <section>
            <h3>応募の内容</h3>
            <div className="ib-grid">
              <label><span>職種<span className="req">必須</span></span>
                <select value={f.role} onChange={(e) => set('role', e.target.value as CandidateInput['role'])}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                <small>判定基準はこの職種のものを使います</small>
              </label>
              <label><span>拠点<span className="req">必須</span></span>
                <select value={f.base} onChange={(e) => set('base', e.target.value)}>
                  {BASES.map((b) => <option key={b}>{b}</option>)}
                </select>
              </label>
            </div>
          </section>
          <section>
            <h3>受検者</h3>
            <div className="ib-grid">
              <label><span>氏名<span className="req">必須</span></span><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="例 佐世保 花子" /></label>
              <label>フリガナ<input value={f.kana} onChange={(e) => set('kana', e.target.value)} placeholder="空欄なら受検時に本人が入れます" /></label>
              <label><span>性別<small>（任意）</small></span>
                <select value={f.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="">未入力</option>
                  {GENDERS.map((g) => <option key={g}>{g}</option>)}
                </select>
              </label>
              <label>生年月日<input type="date" value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></label>
              <label>電話<input type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></label>
              <label>メール<input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></label>
            </div>
          </section>
          {candidate && (
            <section>
              <h3>採用結果・入社後の評価</h3>
              <div className="ib-grid">
                <label>採用結果
                  <select value={f.hireStatus} onChange={(e) => set('hireStatus', e.target.value as CandidateInput['hireStatus'])}>
                    {HIRE_STATUSES.map((h) => <option key={h}>{h}</option>)}
                  </select>
                  <small>不採用・辞退にしてから1年で自動的に削除します</small>
                </label>
                <label>入社後の評価（1〜5）
                  <select value={f.postEval ?? ''} onChange={(e) => set('postEval', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">未評価</option>
                    {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <small>判定基準の校正（CSV）に使います</small>
                </label>
                <label className="wide">評価のメモ<input value={f.postEvalNote} onChange={(e) => set('postEvalNote', e.target.value)} placeholder="例 生徒アンケート高評価・半年で退職 など" /></label>
              </div>
            </section>
          )}
          <section>
            <h3>メモ</h3>
            <textarea value={f.memo} onChange={(e) => set('memo', e.target.value)} placeholder="面接の日程・紹介者など（判定には使いません）" />
          </section>
          {err && <div className="ib-errors" role="alert">{err}</div>}
        </div>
        <div className="dm-modal-foot ib-foot">
          <button className="ib-cancel" onClick={close} disabled={busy}>やめる</button>
          <button className="dm-modal-done" onClick={save} disabled={busy}>{busy ? '保存中…' : candidate ? '保存' : '登録する'}</button>
        </div>
      </div>
    </div>
  );
}
