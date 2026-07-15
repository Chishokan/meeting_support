'use client';

import { useEffect, useRef, useState } from 'react';
import { sanitizeHistory, stripRoleBleed } from '@/lib/sanitize';

type Msg = { role: 'user' | 'assistant'; content: string };

const STORE_PREFIX = 'chishokan_chat_v1';

export default function ChatUI({ name, campus }: { name: string; campus: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const sendingRef = useRef(false);
  const storeKey = `${STORE_PREFIX}:${campus}/${name}`;

  // 同じ端末・ブラウザで中断→再開できるよう、会話を localStorage に保存する。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          // 過去に保存された役割漏れ・空メッセージをここで浄化して復元する。
          const clean = sanitizeHistory(arr) as Msg[];
          if (clean.length) {
            setMessages(clean);
            setRestored(true);
          }
        }
      }
    } catch {
      // 読み込み失敗は無視して新規開始
    }
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      if (messages.length) localStorage.setItem(storeKey, JSON.stringify(messages));
      else localStorage.removeItem(storeKey);
    } catch {
      // 保存失敗は本処理を止めない
    }
  }, [messages, storeKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function copyMsg(i: number, content: string) {
    try {
      navigator.clipboard?.writeText(content);
    } catch {}
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1800);
  }

  function resetChat() {
    if (busy) return;
    if (messages.length && !confirm('この会話を最初からやり直しますか？（入力内容は消えます）')) return;
    setMessages([]);
    setInput('');
    setRestored(false);
    try {
      localStorage.removeItem(storeKey);
    } catch {}
  }

  async function sendText(text: string) {
    const t = text.trim();
    // Ref による同期ロック（busy は state で反映が遅れ、素早い二重送信を取りこぼすため）。
    if (!t || sendingRef.current) return;
    sendingRef.current = true;
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
      // ストリーム完了後、役割漏れ（AIが偽の user/assistant 発話を続ける現象）を除去して確定。
      setMessages((m) => {
        const c = [...m];
        const last = c[c.length - 1];
        if (last && last.role === 'assistant') {
          c[c.length - 1] = { role: 'assistant', content: stripRoleBleed(acc) };
        }
        return c;
      });
    } catch {
      setMessages((m) => {
        const c = [...m];
        c[c.length - 1] = { role: 'assistant', content: 'エラーが発生しました。もう一度お試しください。' };
        return c;
      });
    } finally {
      setBusy(false);
      sendingRef.current = false;
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
        <h1>会議AI</h1>
        <p>会議前の報告を、AIとの対話で「報告事項／協議事項／中間」に整理します。</p>
        {messages.length > 0 && (
          <button className="reset-chat" onClick={resetChat} disabled={busy}>
            最初からやり直す
          </button>
        )}
      </div>

      <div className="wrap">
        <div className="messages">
          {restored && messages.length > 0 && (
            <div className="resume-note">前回の続きから再開しました（この端末に保存されています）。</div>
          )}
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
                  <span
                    className={`copybtn ${copiedIdx === i ? 'copied' : ''}`}
                    onClick={() => copyMsg(i, m.content)}
                  >
                    {copiedIdx === i ? '✓ コピーされました' : 'この回答をコピー'}
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
