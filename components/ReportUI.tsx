'use client';

import { useState } from 'react';

const DOC_URL = 'https://docs.google.com/document/d/1rwSMzzBoJEFUwOMJNPA3rmmGMkarlryCheUGbbNPQik/edit';

export default function ReportUI({ name, campus }: { name: string; campus: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function submit() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setStatus('送信中…');
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setStatus('ドキュメントに転記しました。');
        setText('');
      } else if (j?.reason === 'not_configured') {
        setStatus('未設定です。転記先ドキュメントの連携（Apps Script）を設定してください。');
      } else {
        setStatus(`転記に失敗しました（理由：${j?.reason ?? '不明'}）。Apps Scriptの再デプロイをご確認ください。`);
      }
    } catch {
      setStatus('通信エラーが発生しました。');
    } finally {
      setBusy(false);
      setTimeout(() => setStatus((s) => (s === '送信中…' ? '' : s)), 100);
    }
  }

  return (
    <div className="report">
      <div className="page-head">
        <h1>報告</h1>
        <p>
          {campus}／{name} さん。「会議AI」が出力した<b>「貼り付け用：事前報告」</b>ブロックをここに貼り付け、
          「報告する」を押すと会議ドキュメントに新しいセクションとして転記されます。
        </p>
      </div>

      <div className="report-body">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="ここに『貼り付け用：事前報告』ブロックをそのまま貼り付けてください"
        />
        <div className="report-actions">
          <button onClick={submit} disabled={busy || !text.trim()}>
            {busy ? '送信中…' : '報告する'}
          </button>
          <a className="doc-link" href={DOC_URL} target="_blank" rel="noreferrer">
            会議ドキュメントを開く
          </a>
          {status && <span className="report-note">{status}</span>}
        </div>
        <p className="report-hint">
          ※ 転記先の見出しには「{campus}／{name}／日時」が自動で付きます。個人情報の扱いは会議AIの方針（生徒氏名はイニシャル）に従ってください。
        </p>
      </div>
    </div>
  );
}
