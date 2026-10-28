'use client';

// 適性検査：紙で受けた回答の代理入力。回答用紙と同じ 10列×10行（列＝十の位、行＝一の位）のマス目。
// マスを押すと 空 → ○ → × → 空 と変わる。キーボードなら ○＝O/Y/1、×＝X/N/2、消す＝Delete、矢印で移動。
// 入れると次の番号（同じ列の下のマス。列の最後なら次の列の先頭）へ進む。
// 公開中の版で使わない設問は「—」になり、入れなくてよい。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerValue, Question, Version } from '@/lib/aptitude/model';
import { api, failText } from '@/lib/aptitude/client';
import { useModalDismiss } from '@/lib/useModalDismiss';

const MARK: Record<AnswerValue, string> = { Y: '○', N: '×' };

function parseBulk(text: string): AnswerValue[] {
  const out: AnswerValue[] = [];
  for (const ch of text) {
    if ('○〇oOyY1'.includes(ch)) out.push('Y');
    else if ('×xXnN0２2✕'.includes(ch)) out.push('N');
  }
  return out;
}

export default function AptitudePaperForm({
  candidateId, name, onClose, onSaved,
}: { candidateId: string; name: string; onClose: () => void; onSaved: () => void }) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [versionId, setVersionId] = useState('');
  const [ans, setAns] = useState<Record<number, AnswerValue>>({});
  const [bulk, setBulk] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const cells = useRef<Record<number, HTMLButtonElement | null>>({});
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  useModalDismiss(close);

  useEffect(() => {
    (async () => {
      const list = await api<{ versions: Version[] }>('/api/aptitude/master');
      if (!list.ok) return setErr(failText(list));
      const pub = list.versions.find((v) => v.status === '公開');
      if (!pub) return setErr('公開中の版がありません。「設問・判定基準」の画面で版を公開してください。');
      const d = await api<{ version: { questions: Question[] } }>(`/api/aptitude/master?id=${pub.id}`);
      if (!d.ok) return setErr(failText(d));
      setVersionId(pub.id);
      setQuestions(d.version.questions);
    })();
  }, []);

  const active = useMemo(() => new Set((questions ?? []).filter((q) => q.active).map((q) => q.no)), [questions]);
  const maxNo = Math.max(100, ...(questions ?? []).map((q) => q.no));
  const cols = Math.ceil(maxNo / 10);
  const order = useMemo(() => Array.from({ length: cols * 10 }, (_, i) => i + 1).filter((n) => active.has(n)), [cols, active]);
  const left = order.filter((n) => !ans[n]).length;

  const focusNo = (n: number | undefined) => { if (n) cells.current[n]?.focus(); };
  const nextOf = (n: number) => order[order.indexOf(n) + 1];

  function put(n: number, v: AnswerValue | null, advance: boolean) {
    setAns((p) => {
      const o = { ...p };
      if (v) o[n] = v; else delete o[n];
      return o;
    });
    if (advance) focusNo(nextOf(n));
  }

  function onKey(e: React.KeyboardEvent, n: number) {
    const k = e.key;
    if ('oOyY1'.includes(k) && k.length === 1) { e.preventDefault(); put(n, 'Y', true); }
    else if ('xXnN2'.includes(k) && k.length === 1) { e.preventDefault(); put(n, 'N', true); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); put(n, null, false); }
    else if (k === 'ArrowDown') { e.preventDefault(); focusNo(n % 10 === 0 ? undefined : n + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); focusNo(n % 10 === 1 ? undefined : n - 1); }
    else if (k === 'ArrowRight') { e.preventDefault(); focusNo(n + 10 <= cols * 10 ? n + 10 : undefined); }
    else if (k === 'ArrowLeft') { e.preventDefault(); focusNo(n - 10 >= 1 ? n - 10 : undefined); }
  }

  function applyBulk() {
    const marks = parseBulk(bulk);
    if (!marks.length) return setErr('○×（または Y/N、1/0）が読み取れませんでした。');
    const o: Record<number, AnswerValue> = {};
    order.forEach((n, i) => { if (marks[i]) o[n] = marks[i]; });
    setAns(o);
    setErr(marks.length === order.length ? '' : `${marks.length}問ぶん読み取りました（使う設問は${order.length}問）。足りない分はマス目で入れてください。`);
  }

  async function save() {
    setBusy(true);
    setErr('');
    const r = await api('/api/aptitude/sessions', { body: { action: 'paper', candidateId, answers: ans } });
    setBusy(false);
    if (!r.ok) return setErr(r.reason.startsWith('unanswered') ? `答えていない設問があります（${r.reason.split('|')[1]}）。` : failText(r));
    onSaved();
  }

  return (
    <div className="dm-modal-bg" onClick={close}>
      <div className="dm-modal apt-paper-modal" role="dialog" aria-modal="true" aria-label="紙回答の入力" onClick={(e) => e.stopPropagation()}>
        <div className="dm-modal-head">
          <div>
            <h2>紙回答の入力：{name} さん</h2>
            <div className="dm-modal-sub">回答用紙と同じ並び（列＝十の位、行＝一の位）。○＝O・Y・1、×＝X・N・2 のキーでも入れられます。{versionId && `版 ${versionId} で採点します。`}</div>
          </div>
          <button className="dm-modal-close" onClick={close} aria-label="閉じる">×</button>
        </div>
        <div className="dm-modal-body">
          {!questions && !err && <p className="apt-muted">設問を読み込み中…</p>}
          {questions && (
            <>
              <div className="apt-paper-wrap">
                <table className="apt-paper">
                  <thead>
                    <tr><th />{Array.from({ length: cols }, (_, c) => <th key={c}>{c * 10 + 1}〜</th>)}</tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 10 }, (_, r) => (
                      <tr key={r}>
                        <th>{(r + 1) % 10}</th>
                        {Array.from({ length: cols }, (_, c) => {
                          const n = c * 10 + r + 1;
                          const on = active.has(n);
                          const v = ans[n];
                          return (
                            <td key={c}>
                              {on ? (
                                <button ref={(el) => { cells.current[n] = el; }}
                                  className={`apt-cell ${v ? `v-${v}` : ''}`}
                                  onClick={() => put(n, v === 'Y' ? 'N' : v === 'N' ? null : 'Y', false)}
                                  onKeyDown={(e) => onKey(e, n)}
                                  aria-label={`${n}番 ${v ? MARK[v] : '未入力'}`}>
                                  <small>{n}</small>{v ? MARK[v] : ''}
                                </button>
                              ) : <span className="apt-cell off" title="この版では使わない設問"><small>{n}</small>—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="apt-details">
                <summary>まとめて貼り付ける</summary>
                <p className="apt-legend">1番から番号順に ○× を並べた文字を貼り付けて［反映］（Y/N・1/0 でも可。空白や改行は無視します）。</p>
                <textarea className="apt-bulk" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="○×○○×…" />
                <button className="ib-ghost" onClick={applyBulk}>反映</button>
              </details>
            </>
          )}
          {err && <div className="ib-errors" role="alert">{err}</div>}
        </div>
        <div className="dm-modal-foot ib-foot">
          <span className="apt-paper-left">{questions ? (left ? `あと ${left} 問` : 'すべて入力しました') : ''}</span>
          <button className="ib-cancel" onClick={close} disabled={busy}>やめる</button>
          <button className="dm-modal-done" onClick={save} disabled={busy || !questions || left > 0}>{busy ? '採点中…' : '保存して採点'}</button>
        </div>
      </div>
    </div>
  );
}
