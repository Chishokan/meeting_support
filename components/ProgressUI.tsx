'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { sanitizeHistory, stripRoleBleed } from '@/lib/sanitize';
import { PROGRESS_BLOCK_START, PROGRESS_BLOCK_END } from '@/lib/progressPrompt';

type Msg = { role: 'user' | 'assistant'; content: string };

const STORE_PREFIX = 'chishokan_progress_v1';

// AI が出力した中間報告ブロック（囲みの内側）を取り出す。無ければ null。
function extractReportBlock(text: string): string | null {
  const start = text.indexOf(PROGRESS_BLOCK_START);
  if (start === -1) return null;
  const end = text.indexOf(PROGRESS_BLOCK_END, start + PROGRESS_BLOCK_START.length);
  if (end === -1) return null;
  const inner = text.slice(start + PROGRESS_BLOCK_START.length, end).trim();
  return inner || null;
}

export default function ProgressUI({ name, campus, isAdmin = false }: { name: string; campus: string; isAdmin?: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [transferStatus, setTransferStatus] = useState('');
  const [transferred, setTransferred] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const sendingRef = useRef(false);
  const transferringRef = useRef(false);
  const storeKey = `${STORE_PREFIX}:${campus}/${name}`;

  // 同じ端末・ブラウザで中断→再開できるよう、会話を localStorage に保存する。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
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

  function resetChat() {
    if (busy) return;
    if (messages.length && !confirm('この中間報告を最初からやり直しますか？（入力内容は消えます）')) return;
    setMessages([]);
    setInput('');
    setRestored(false);
    setTransferStatus('');
    setTransferred(false);
    try {
      localStorage.removeItem(storeKey);
    } catch {}
  }

  // 中間報告ブロックを事前共有ドキュメントへ自動転記する。
  async function transferReport(content: string) {
    if (transferringRef.current || transferred) return;
    transferringRef.current = true;
    setTransferStatus('ドキュメントへ転記中…');
    try {
      const res = await fetch('/api/progress/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setTransferStatus('✓ 事前共有ドキュメントに転記しました。');
        setTransferred(true);
      } else if (j?.reason === 'not_configured') {
        setTransferStatus('未設定です。転記先ドキュメントの連携（Apps Script）を設定してください。');
      } else {
        setTransferStatus(`転記に失敗しました（理由：${j?.reason ?? '不明'}）。Apps Scriptの再デプロイをご確認ください。`);
      }
    } catch {
      setTransferStatus('通信エラーが発生しました。');
    } finally {
      transferringRef.current = false;
    }
  }

  async function sendText(text: string) {
    const t = text.trim();
    if (!t || sendingRef.current) return;
    sendingRef.current = true;
    const next: Msg[] = [...messages, { role: 'user', content: t }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setBusy(true);
    try {
      const res = await fetch('/api/progress', {
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
      const finalText = stripRoleBleed(acc);
      setMessages((m) => {
        const c = [...m];
        const last = c[c.length - 1];
        if (last && last.role === 'assistant') {
          c[c.length - 1] = { role: 'assistant', content: finalText };
        }
        return c;
      });
      // AI が中間報告ブロックを出力したら、そのまま事前共有ドキュメントへ自動転記する。
      const block = extractReportBlock(finalText);
      if (block) void transferReport(block);
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
        <h1>中間報告</h1>
        <p>会議で決議した事項の進捗を、締切日までにAIとの対話で報告します。最後に「報告完了」と送ると事前共有ドキュメントへ自動転記します。</p>
        {isAdmin && (
          <Link className="doc-link" href="/progress/settings">定例項目を編集</Link>
        )}
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
              中間報告を始めましょう。<br />
              下の入力欄に「こんにちは」などと送ると、AIが決議事項の進捗を順に確認します。<br />
              完了した項目は「完了」、途中の項目は「3/11」（11件中3件完了）のように送ってください。
            </div>
          )}
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

      {transferStatus && (
        <div className={`report-note progress-transfer ${transferred ? 'done' : ''}`}>{transferStatus}</div>
      )}

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
