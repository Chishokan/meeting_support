'use client';

import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string };

export default function ChatUI({ name, campus }: { name: string; campus: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendText(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: t }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok || !res.body) throw new Error('failed');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMessages((m) => {
          const c = [...m];
          c[c.length - 1] = { role: 'assistant', content: acc };
          return c;
        });
      }
    } catch {
      setMessages((m) => {
        const c = [...m];
        c[c.length - 1] = { role: 'assistant', content: 'エラーが発生しました。もう一度お試しください。' };
        return c;
      });
    } finally {
      setBusy(false);
    }
  }

  function onSend() {
    const t = input.trim();
    if (!t) return;
    setInput('');
    void sendText(t);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>AI壁打ち</h1>
        <p>会議前の報告を、AIとの対話で「報告事項／協議事項／中間」に整理します。</p>
      </div>

      <div className="wrap">
        <div className="messages">
          {messages.length === 0 && (
            <div className="hint">
              事前報告をまとめましょう。<br />
              下の入力欄に「会議の報告を始めたい」などと送るか、共有したいことを箇条書きで貼り付けてください。
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div>
                <div className="bubble">{m.content || '…'}</div>
                {m.role === 'assistant' && m.content && (
                  <span className="copybtn" onClick={() => navigator.clipboard?.writeText(m.content)}>
                    この回答をコピー
                  </span>
                )}
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
            placeholder="メッセージを入力（⌘/Ctrl+Enter で送信）"
          />
          <button onClick={onSend} disabled={busy || !input.trim()}>
            {busy ? '…' : '送信'}
          </button>
        </div>
      </div>
    </>
  );
}
