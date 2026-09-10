'use client';

import { useState } from 'react';

const PROMPT = '本日の全体会議の感想、気付き、やろうと思ったことを書いてください。';

export default function MeetingReviewUI({ name, campus }: { name: string; campus: string }) {
  const [started, setStarted] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState('');

  async function submit() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setStatus('送信中…');
    try {
      const res = await fetch('/api/meeting-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setDone(true);
        setStatus('');
        setText('');
      } else if (j?.reason === 'not_configured') {
        setStatus('未設定です。スプレッドシート連携（Apps Script）を設定してください。');
      } else {
        setStatus(`送信に失敗しました（理由：${j?.reason ?? '不明'}）。`);
      }
    } catch {
      setStatus('通信エラーが発生しました。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="review">
      <div className="page-head">
        <h1>全体会議振り返り</h1>
        <p>{campus}／{name} さん。全体会議の振り返りを書いて送信します。</p>
      </div>

      <div className="review-body">
        {!started && (
          <div className="review-start">
            <button onClick={() => setStarted(true)}>始める</button>
          </div>
        )}

        {started && !done && (
          <>
            <p className="review-prompt">{PROMPT}</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="ここに書いてください"
              autoFocus
            />
            <div className="review-actions">
              <button onClick={submit} disabled={busy || !text.trim()}>
                {busy ? '送信中…' : '送信する'}
              </button>
              {status && <span className="review-note">{status}</span>}
            </div>
          </>
        )}

        {done && (
          <div className="review-done">
            <p>送信しました。ありがとうございました。</p>
            <button onClick={() => { setDone(false); setStarted(true); }}>もう一度書く</button>
          </div>
        )}
      </div>
    </div>
  );
}
