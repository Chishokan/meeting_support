'use client';

import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string };

export default function ChatUI({ name, campus }: { name: string; campus: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void sendText('こんにちは');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <>
      <div className="topbar">
        <div className="who">{campus}／{name} さん</div>
        <button onClick={logout}>ログアウト</button>
      </div>

      <div className="wrap">
        <div className="messages">
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
