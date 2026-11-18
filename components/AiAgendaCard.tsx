'use client';
// 智翔館AI：議題の追加の案（propose_agenda_item）。［議題に追加する］を押したときだけ追加する（/api/chishokan-ai/agenda）。
// 次の部門会議の事前共有があればその議題の末尾に、無ければ「議題の候補」に入る（会議の担当者が事前共有を作るときに取り込む）。

import { useState } from 'react';

export type AgendaProposalView = { dept: string; item: string; detail: string; meetingId: string; meetingTitle: string; meetingDate: string };

export default function AiAgendaCard({ p, conversationId }: { p: AgendaProposalView; conversationId: string }) {
  const [state, setState] = useState<'pending' | 'busy' | 'done' | 'dismissed' | 'error'>('pending');
  const [msg, setMsg] = useState('');

  async function add() {
    setState('busy');
    setMsg('');
    try {
      const res = await fetch('/api/chishokan-ai/agenda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...p, conversationId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setState('done');
        setMsg(
          j.target === 'preshare'
            ? `「${j.title || p.meetingTitle}」（${j.date || p.meetingDate}）の議題に追加しました。`
            : `${p.dept}の「議題の候補」に入れました。会議の担当者が事前共有を作るときに取り込みます。`,
        );
      } else {
        setState('error');
        setMsg(String(j?.message || '追加できませんでした。もう一度押してください。'));
      }
    } catch {
      setState('error');
      setMsg('通信に失敗しました。もう一度押してください。');
    }
  }

  if (state === 'dismissed') return <div className="ai-agenda ai-agenda-off">議題の追加案「{p.item}」は追加しませんでした。</div>;
  return (
    <div className="ai-agenda">
      <div className="ai-agenda-title">📝 議題の追加案</div>
      <div className="ai-agenda-where">
        {p.dept}
        {p.meetingId ? `｜${p.meetingTitle}（${p.meetingDate}）の事前共有に足します` : '｜これからの会議の事前共有がまだ無いので、「議題の候補」に入れます'}
      </div>
      <div className="ai-agenda-item">{p.item}</div>
      {p.detail && <div className="ai-agenda-detail">{p.detail}</div>}
      {state === 'done' ? (
        <div className="ai-agenda-ok">✅ {msg}</div>
      ) : (
        <div className="ai-agenda-actions">
          <button type="button" onClick={() => void add()} disabled={state === 'busy'}>
            {state === 'busy' ? '追加しています…' : '議題に追加する'}
          </button>
          <button type="button" className="ai-agenda-cancel" onClick={() => setState('dismissed')} disabled={state === 'busy'}>
            やめる
          </button>
          {state === 'error' && <span className="ai-agenda-err">{msg}</span>}
        </div>
      )}
    </div>
  );
}
