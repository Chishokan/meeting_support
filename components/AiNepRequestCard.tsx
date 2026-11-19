'use client';
// 智翔館AI：NEPへの作成依頼の案（propose_nep_request）。［この内容でNEPへ作成依頼を出す］を押したときだけ送る（/api/chishokan-ai/nep-request）。
// 送った依頼はヘルプデスクの「ご意見・不具合」（種別「NEPへの制作依頼」）に入り、NEP が返事を書く。見た目は議題の追加案（AiAgendaCard）と同じ枠。

import { useState } from 'react';
import type { NepRequest } from '@/lib/chishokanAi/nepRequest';

export type NepRequestView = NepRequest;

export default function AiNepRequestCard({ p, conversationId }: { p: NepRequestView; conversationId: string }) {
  const [state, setState] = useState<'pending' | 'busy' | 'done' | 'dismissed' | 'error'>('pending');
  const [msg, setMsg] = useState('');

  async function send() {
    setState('busy');
    setMsg('');
    try {
      const res = await fetch('/api/chishokan-ai/nep-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...p, conversationId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setState('done');
        setMsg('NEPへ作成依頼を出しました。返事はヘルプデスクの「ご意見・不具合」（種別：NEPへの制作依頼）で見られます。');
      } else {
        setState('error');
        setMsg(String(j?.message || '送れませんでした。もう一度押してください。'));
      }
    } catch {
      setState('error');
      setMsg('通信に失敗しました。もう一度押してください。');
    }
  }

  if (state === 'dismissed') return <div className="ai-agenda ai-agenda-off">作成依頼の案「{p.title}」は送りませんでした。</div>;
  const rows: [string, string][] = [
    ['納品希望日', p.due],
    ['用途', p.purpose],
    ['大きさ・枚数', p.size],
    ['入れないもの', p.avoid],
  ];
  return (
    <div className="ai-agenda ai-nep">
      <div className="ai-agenda-title">🎨 NEPへの作成依頼の案</div>
      <div className="ai-agenda-where">{p.kind}｜押すまで送られません</div>
      <div className="ai-agenda-item">{p.title}</div>
      <dl className="ai-nep-rows">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      <div className="ai-agenda-detail ai-nep-content">{p.content}</div>
      {p.prompt && (
        <details className="ai-nep-more">
          <summary>画像の指示文の案</summary>
          <div className="ai-nep-content">{p.prompt}</div>
        </details>
      )}
      {p.notes && <div className="ai-agenda-detail ai-nep-content">参考：{p.notes}</div>}
      {state === 'done' ? (
        <div className="ai-agenda-ok">✅ {msg}</div>
      ) : (
        <div className="ai-agenda-actions">
          <button type="button" onClick={() => void send()} disabled={state === 'busy'}>
            {state === 'busy' ? '送っています…' : 'この内容でNEPへ作成依頼を出す'}
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
