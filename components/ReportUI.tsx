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
        const shared = Number(j?.success ?? 0);
        setStatus(
          shared > 0
            ? `ドキュメントに転記しました。成功事例${shared}件を全体共有に登録しました。`
            : 'ドキュメントに転記しました。',
        );
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
        <h1>報告の転記</h1>
        <p>
          {campus}／{name} さん。事前報告・月次報告・講習の結果報告は、会議AIで「報告完了」と送ると自動で会議ドキュメントへ
          転記されるので、ふだんはこの画面を使いません。自動で保存できなかったときだけ、会議AIの報告文
          <b>（「＝＝＝ …（ここから）＝＝＝」〜「＝＝＝ …（ここまで）＝＝＝」）</b>をここに貼り付けて「報告する」を押してください。
        </p>
      </div>

      <div className="report-body">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="ここに会議AIの報告文（＝＝＝ の行を含む）をそのまま貼り付けてください"
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
          ※ 転記先の見出しには「{campus}／{name}／日時」が自動で付きます。個人情報の扱いは会議AIの方針（生徒氏名はイニシャル）に従ってください。<br />
          ※ 「成功事例（全体共有）」を含む報告文は、転記と同時に全社の成功事例としてダッシュボードに集約されます。
        </p>
      </div>
    </div>
  );
}
