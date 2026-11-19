'use client';
// 智翔館AI：事前共有を読んだ回答の下に出す、会議ごとの［意見を足す］［修正する］と、その編集の小窓（モーダル）。
// 小窓は開くたびにいまの事前共有を読み直し（/api/chishokan-ai/preshare）、保存も同じ API に送る。
// 意見は選んだ議題の下に「└【意見】本文〔名前 日付〕」で足す。修正は、開いてから保存までにほかの人が直していたら保存しない。
// 決まりは lib/chishokanAi/preshareEdit.ts。

import { useCallback, useEffect, useState } from 'react';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { OPINION_MAX, type PreshareFields } from '@/lib/chishokanAi/preshareEdit';

export type PreshareButtonView = { id: string; campus: string; title: string; date: string };
type Mode = 'opinion' | 'edit';
type Item = PreshareFields & { id: string; campus: string; user: string; editedAt: string; editedBy: string; minutesId: string; targets: string[] };

export default function AiPreshareCards({ items, conversationId }: { items: PreshareButtonView[]; conversationId: string }) {
  const [open, setOpen] = useState<{ id: string; mode: Mode } | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  if (!items.length) return null;
  return (
    <div className="ai-agenda ai-preshare">
      <div className="ai-agenda-title">📋 事前共有に意見を足す・直す</div>
      {items.map((it) => (
        <div key={it.id} className="ai-preshare-row">
          <span className="ai-preshare-name">
            {it.campus}｜{it.title}
            {it.date ? `（${it.date}）` : ''}
          </span>
          <span className="ai-preshare-btns">
            <button type="button" onClick={() => setOpen({ id: it.id, mode: 'opinion' })}>意見を足す</button>
            <button type="button" className="ai-agenda-cancel" onClick={() => setOpen({ id: it.id, mode: 'edit' })}>修正する</button>
          </span>
          {saved[it.id] && <span className="ai-agenda-ok ai-preshare-saved">✅ {saved[it.id]}</span>}
        </div>
      ))}
      {open && (
        <AiPreshareDialog
          id={open.id}
          mode={open.mode}
          conversationId={conversationId}
          onClose={() => setOpen(null)}
          onSaved={(msg) => setSaved((s) => ({ ...s, [open.id]: msg }))}
        />
      )}
    </div>
  );
}

const EMPTY: PreshareFields = { title: '', date: '', place: '', attendees: '', agenda: '' };
const pick = (it: Item): PreshareFields => ({ title: it.title, date: it.date, place: it.place, attendees: it.attendees, agenda: it.agenda });

function AiPreshareDialog({
  id,
  mode,
  conversationId,
  onClose,
  onSaved,
}: {
  id: string;
  mode: Mode;
  conversationId: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'done' | 'failed'>('loading');
  const [item, setItem] = useState<Item | null>(null);
  const [locked, setLocked] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<Item | null>(null);
  // 修正
  const [fields, setFields] = useState<PreshareFields>(EMPTY);
  const [base, setBase] = useState<PreshareFields>(EMPTY);
  // 意見
  const [target, setTarget] = useState('');
  const [text, setText] = useState('');

  const close = useCallback(() => {
    if (state !== 'saving') onClose();
  }, [onClose, state]);
  useModalDismiss(close);

  const take = useCallback((it: Item) => {
    setItem(it);
    setFields(pick(it));
    setBase(pick(it));
    setConflict(null);
    setError('');
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/chishokan-ai/preshare?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
        const j = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.ok && j?.ok && j.item) {
          take(j.item as Item);
          setLocked(String(j.locked || ''));
          setState('ready');
        } else {
          setError(String(j?.message || '事前共有を読めませんでした。'));
          setState('failed');
        }
      } catch {
        if (!alive) return;
        setError('通信に失敗しました。閉じてもう一度開いてください。');
        setState('failed');
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, take]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    if (mode === 'opinion' && text.trim().length < 2) return setError('意見を書いてください。');
    setState('saving');
    setError('');
    try {
      const res = await fetch('/api/chishokan-ai/preshare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'opinion' ? { id, mode, target, text, conversationId } : { id, mode, fields, base, conversationId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        if (j.item) setItem(j.item as Item);
        setState('done');
        onSaved(mode === 'opinion' ? '意見を足しました' : '修正を保存しました');
        return;
      }
      if (j?.conflict && j.item) setConflict(j.item as Item);
      setError(String(j?.message || '保存できませんでした。もう一度押してください。'));
      setState('ready');
    } catch {
      setError('通信に失敗しました。もう一度押してください。');
      setState('ready');
    }
  }

  const set = (k: keyof PreshareFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const heading = mode === 'opinion' ? '💬 事前共有に意見を足す' : '✏️ 事前共有を修正する';

  return (
    <div className="dm-modal-bg" onClick={close}>
      <div className="dm-modal ai-report ai-preshare-modal" role="dialog" aria-modal="true" aria-label={heading} onClick={(e) => e.stopPropagation()}>
        <div className="dm-modal-head">
          <div>
            <h2>{heading}</h2>
            <div className="dm-modal-sub">
              {item ? `${item.campus}｜${item.title}${item.date ? `（${item.date}）` : ''}｜共有：${item.user}` : '事前共有を読んでいます…'}
            </div>
            {item?.editedAt && (
              <div className="dm-modal-edited">
                修正：{item.editedAt} {item.editedBy}
              </div>
            )}
          </div>
          <button className="dm-modal-close" onClick={close} aria-label="閉じる">×</button>
        </div>

        {state === 'loading' && <div className="dm-modal-body">いまの事前共有を読んでいます…</div>}
        {state === 'failed' && (
          <div className="dm-modal-body">
            <p className="ai-report-error">{error}</p>
          </div>
        )}
        {state === 'done' && item && (
          <div className="dm-modal-body">
            <p className="ai-report-done">{mode === 'opinion' ? '意見を足しました。' : '修正を保存しました。'}事前共有はダッシュボードと「部門会議議事録」の画面にも出ます。</p>
            <pre className="dm-modal-text ai-preshare-agenda">{item.agenda}</pre>
            <div className="ai-report-actions">
              <button type="button" className="ai-report-submit" onClick={onClose}>閉じる</button>
            </div>
          </div>
        )}
        {(state === 'ready' || state === 'saving') && item && locked && (
          <div className="dm-modal-body">
            <p className="ai-report-error">{locked}</p>
            <pre className="dm-modal-text ai-preshare-agenda">{item.agenda}</pre>
          </div>
        )}
        {(state === 'ready' || state === 'saving') && item && !locked && (
          <form className="dm-modal-body ai-report-form" onSubmit={submit}>
            {mode === 'opinion' ? (
              <>
                <div className="ai-report-field">
                  <span>いまの議題・レジュメ</span>
                  <pre className="dm-modal-text ai-preshare-agenda">{item.agenda || '（まだありません）'}</pre>
                </div>
                <label className="ai-report-field">
                  <span>どの議題への意見か</span>
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">会議全体について（いちばん下に足す）</option>
                    {item.targets.map((t) => (
                      <option key={t} value={t}>
                        {t.length > 50 ? `${t.slice(0, 50)}…` : t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ai-report-field">
                  <span>
                    意見<span className="req">必須</span>
                  </span>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={4}
                    maxLength={OPINION_MAX}
                    placeholder="例：外部生の募集は、駅前校と日野校で分担を決めたい。資料は当日配ります。"
                  />
                </label>
                <p className="ai-report-note">選んだ議題のすぐ下に「└【意見】本文〔あなたの名前 日付〕」として足します。ほかの人の書き足しは消えません。</p>
              </>
            ) : (
              <>
                {conflict && (
                  <div className="ai-report-error">
                    ほかの人が先に直しました。
                    <button type="button" className="msg-action" onClick={() => take(conflict)}>
                      最新を読み込む（いま直した分は消えます）
                    </button>
                  </div>
                )}
                <label className="ai-report-field">
                  <span>
                    会議名<span className="req">必須</span>
                  </span>
                  <input value={fields.title} onChange={set('title')} maxLength={100} />
                </label>
                <label className="ai-report-field">
                  <span>
                    開催日時<span className="req">必須</span>
                  </span>
                  <input value={fields.date} onChange={set('date')} maxLength={60} placeholder="例：2026/11/24 18:00〜19:00" />
                </label>
                <label className="ai-report-field">
                  <span>場所</span>
                  <input value={fields.place} onChange={set('place')} maxLength={100} />
                </label>
                <label className="ai-report-field">
                  <span>出席者</span>
                  <input value={fields.attendees} onChange={set('attendees')} maxLength={300} />
                </label>
                <label className="ai-report-field">
                  <span>
                    議題・レジュメ<span className="req">必須</span>
                  </span>
                  <textarea value={fields.agenda} onChange={set('agenda')} rows={10} maxLength={6000} />
                </label>
                <p className="ai-report-note">保存すると、この事前共有がそのまま置き換わります（最初に共有した人・部門はそのまま、修正した人が残ります）。</p>
              </>
            )}
            {error && !conflict && <div className="ai-report-error">{error}</div>}
            <div className="ai-report-actions">
              <button type="button" className="msg-action" onClick={close} disabled={state === 'saving'}>
                やめる
              </button>
              <button type="submit" className="ai-report-submit" disabled={state === 'saving'}>
                {state === 'saving' ? '保存しています…' : mode === 'opinion' ? '意見を足す' : '修正を保存する'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
