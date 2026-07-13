'use client';

import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string };
type Thread = { id: string; title: string; updatedAt: string; messages: Msg[] };

const STORE_KEY = 'chishokan_minutes_v1';

function loadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveThreads(t: Thread[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(t));
  } catch {}
}

function newId() {
  try {
    return crypto.randomUUID();
  } catch {
    return 'm_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }
}

function titleFrom(text: string) {
  const line = (text || '').split('\n').map((s) => s.trim()).find(Boolean) || '無題の議事録';
  return line.length > 24 ? line.slice(0, 24) + '…' : line;
}

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export default function MinutesUI({ name, campus }: { name: string; campus: string }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string>('');
  const endRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    const t = loadThreads();
    setThreads(t);
    setActiveId(t[0]?.id ?? null);
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (loaded.current) saveThreads(threads);
  }, [threads]);

  const active = threads.find((t) => t.id === activeId) || null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages.length, busy]);

  function newThread() {
    const t: Thread = { id: newId(), title: '新しい議事録', updatedAt: new Date().toISOString(), messages: [] };
    setThreads((prev) => [t, ...prev]);
    setActiveId(t.id);
    setInput('');
  }

  function deleteThread(id: string) {
    if (!confirm('この議事録スレッドを削除しますか？（元に戻せません）')) return;
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    // アクティブスレッドが無ければ作成
    let id = activeId;
    if (!id || !threads.some((t) => t.id === id)) {
      const t: Thread = { id: newId(), title: titleFrom(text), updatedAt: new Date().toISOString(), messages: [] };
      setThreads((prev) => [t, ...prev]);
      id = t.id;
      setActiveId(id);
    }

    const cur = (threads.find((t) => t.id === id)?.messages ?? []);
    const next: Msg[] = [...cur, { role: 'user', content: text }];
    setInput('');
    setBusy(true);
    setThreads((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              title: t.messages.length === 0 ? titleFrom(text) : t.title,
              updatedAt: new Date().toISOString(),
              messages: [...next, { role: 'assistant', content: '' }],
            }
          : t,
      ),
    );

    try {
      const res = await fetch('/api/minutes', {
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
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== id) return t;
            const c = [...t.messages];
            c[c.length - 1] = { role: 'assistant', content: acc };
            return { ...t, messages: c, updatedAt: new Date().toISOString() };
          }),
        );
      }
    } catch {
      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const c = [...t.messages];
          c[c.length - 1] = { role: 'assistant', content: 'エラーが発生しました。もう一度お試しください。' };
          return { ...t, messages: c };
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  function lastMinutes(): string {
    const a = [...(active?.messages ?? [])].reverse().find((m) => m.role === 'assistant' && m.content);
    return a?.content ?? '';
  }

  async function saveToSheet() {
    if (!active) return;
    const text = lastMinutes();
    if (!text) return;
    setSaved('保存中…');
    try {
      const res = await fetch('/api/minutes/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: active.title, content: text, campus, name }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) setSaved('スプレッドシートに保存しました');
      else if (j?.reason === 'not_configured') setSaved('（未設定）localStorageに保存済み。Sheets連携は設定後に有効化されます');
      else setSaved('保存に失敗しました');
    } catch {
      setSaved('保存に失敗しました');
    }
    setTimeout(() => setSaved(''), 6000);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="minutes">
      <div className="thread-list">
        <button className="new-thread" onClick={newThread}>＋ 新しい議事録</button>
        {threads.length === 0 && <p className="thread-empty">まだ議事録はありません。<br />「＋ 新しい議事録」から始めてください。</p>}
        {threads.map((t) => (
          <div
            key={t.id}
            className={`thread-item ${t.id === activeId ? 'active' : ''}`}
            onClick={() => setActiveId(t.id)}
          >
            <div className="thread-title">{t.title}</div>
            <div className="thread-meta">{fmtDate(t.updatedAt)}</div>
            <button
              className="thread-del"
              onClick={(e) => {
                e.stopPropagation();
                deleteThread(t.id);
              }}
              aria-label="削除"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="thread-main">
        <div className="page-head">
          <h1>議事録スレッド</h1>
          <p>会議中・直後のメモや口述を貼り付けると、AIが「決定事項・継続審議・ToDo」に整形します。</p>
        </div>

        {!active ? (
          <div className="thread-placeholder">
            左の「＋ 新しい議事録」を押すか、下の入力欄にメモを貼り付けて送信してください。
          </div>
        ) : (
          <>
            <div className="thread-messages">
              {active.messages.length === 0 && (
                <div className="thread-hint">
                  会議のメモ・決まったこと・宿題などを、箇条書きのままで大丈夫です。まとめて貼り付けてください。
                </div>
              )}
              {active.messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div>
                    <div className="bubble">{m.content || '…'}</div>
                    {m.role === 'assistant' && m.content && (
                      <span className="copybtn" onClick={() => navigator.clipboard?.writeText(m.content)}>
                        この議事録をコピー
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>

            {lastMinutes() && (
              <div className="thread-actions">
                <button className="save-sheet" onClick={saveToSheet} disabled={busy}>
                  スプレッドシートに保存
                </button>
                {saved && <span className="save-note">{saved}</span>}
              </div>
            )}
          </>
        )}

        <div className="thread-composer">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="会議メモを貼り付け／追記（⌘・Ctrl+Enter で送信）"
          />
          <button onClick={() => void send()} disabled={busy || !input.trim()}>
            {busy ? '…' : '整形'}
          </button>
        </div>
      </div>
    </div>
  );
}
