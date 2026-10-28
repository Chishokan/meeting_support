'use client';

import { useEffect, useRef, useState } from 'react';
import YokoCard, { type YokoCardData as Card } from '@/components/YokoCard';

type Msg = { role: 'user' | 'assistant'; content: string };
type DocRef = { title: string; updated?: string; owner?: string };

type ListRes =
  | {
      ok: true;
      cards: Card[];
      periodUnknown: number;
      confirmed: DocRef[];
      pending: DocRef[];
      total: number;
    }
  | { ok: false; reason: string };

// lib/yokoCards.ts の SOON_DAYS と合わせる（画面の文言に出すだけ）。
const SOON_DAYS = 30;

const EXAMPLES = [
  '一般生の申込方法は？',
  '支払い方法を塾生と一般生で教えて',
  '申込期限はいつ？',
  '受講料はいくら？',
  'オンライン受講はできる？',
];

export default function YokoQaUI({ name, campus }: { name: string; campus: string }) {
  const [list, setList] = useState<ListRes | null>(null);
  const [showConfirmed, setShowConfirmed] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/yoko-qa')
      .then((r) => r.json())
      .then((j: ListRes) => { if (alive) setList(j); })
      .catch(() => { if (alive) setList({ ok: false, reason: 'network_error' }); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);

    const next: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages([...next, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/yoko-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => '');
        setMessages([...next, { role: 'assistant', content: t || 'エラーが発生しました。' }]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMessages([...next, { role: 'assistant', content: acc }]);
      }
    } catch {
      setMessages([...next, { role: 'assistant', content: '通信エラーが発生しました。' }]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      ask(input);
    }
  }

  const confirmed = list?.ok ? list.confirmed : [];
  const pending = list?.ok ? list.pending : [];
  const cards = list?.ok ? list.cards : [];

  return (
    <div className="iqa-page">
      <div className="page-head">
        <h1>要項QA</h1>
        <p>確定済みの実施要項に、AIが答えます（{campus} / {name} さん）。</p>
      </div>

      {list && !list.ok && <div className="iqa-err">要項の読み込みに失敗しました。</div>}

      {list?.ok && confirmed.length === 0 && (
        <div className="iqa-err">
          確定済みの要項がまだ 0 件です（下書き {pending.length} 件）。
          <br />
          担当者が内容を確認したら、<code>knowledge/40_要項/</code> の該当ファイルの
          <code> status: 下書き</code> を <code>status: 確定</code> に変えて push してください。
          確定したものだけをAIが読みます。
        </div>
      )}

      {list?.ok && cards.length > 0 && (
        <div className="yq-cards-wrap">
          <div className="yq-cards-head">
            実施中・まもなく実施の要項
            <span className="yq-cards-sub">{cards.length} 件</span>
          </div>
          <div className="iqa-cards">
            {cards.map((c) => <YokoCard key={c.file} card={c} />)}
          </div>
        </div>
      )}

      {list?.ok && confirmed.length > 0 && cards.length === 0 && (
        <div className="yq-cards-wrap">
          <div className="yq-empty">
            いま実施中の要項も、{SOON_DAYS}日以内に始まる要項もありません。
            確定済み {confirmed.length} 件はすべて実施済みです。過去の要項は下のチャットで聞けます。
          </div>
        </div>
      )}

      {list?.ok && confirmed.length > 0 && (
        <div className="yq-list">
          <button className="yq-toggle" onClick={() => setShowConfirmed((v) => !v)}>
            回答に使える要項 {confirmed.length} 件 {showConfirmed ? '▲' : '▼'}
          </button>
          {showConfirmed && (
            <ul className="yq-items">
              {confirmed.map((d) => (
                <li key={d.title}>
                  {d.title}
                  {d.updated && <span className="yq-meta">{d.updated}</span>}
                  {d.owner && <span className="yq-meta">確定: {d.owner}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {list?.ok && pending.length > 0 && (
        <div className="yq-pending">
          <button className="yq-toggle" onClick={() => setShowPending((v) => !v)}>
            未確定の要項 {pending.length} 件 {showPending ? '▲' : '▼'}
          </button>
          {showPending && (
            <>
              <p className="yq-pending-note">
                これらは内容がAIに渡っていません。案が複数あったり編集中のため、
                受講料や期限を誤って伝えないようにしています。聞かれてもAIは「未確定」と答えます。
              </p>
              <ul className="yq-items muted">
                {pending.map((d) => <li key={d.title}>{d.title}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {list?.ok && list.periodUnknown > 0 && (
        <div className="yq-list">
          <p className="yq-pending-note">
            確定済みのうち {list.periodUnknown} 件は「日程」が空欄のため、期間が来てもカードに出ません。
            要項の ＜実施内容および日程＞ に日付を書いて取り込み直すと出るようになります。
          </p>
        </div>
      )}

      {messages.length === 0 && confirmed.length > 0 && (
        <div className="iqa-examples">
          {EXAMPLES.map((e) => (
            <button key={e} className="iqa-example" onClick={() => ask(e)} disabled={busy}>
              {e}
            </button>
          ))}
        </div>
      )}

      <div className="wrap">
        <div className="messages">
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div>
                <div className="bubble">{m.content || '…'}</div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <div className="composer">
        <div className="inner">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            // 季節の講座名を例に出すと、その講座が終わったあと例文だけ古いまま残る。
            placeholder="例：〇〇講座の一般生の申込方法は？（⌘/Ctrl+Enter で送信）"
          />
          <button onClick={() => ask(input)} disabled={busy || !input.trim()}>
            {busy ? '…' : '質問'}
          </button>
        </div>
      </div>
    </div>
  );
}

