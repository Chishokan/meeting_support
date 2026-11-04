'use client';

// 智翔館AI の画面。社内ナレッジを調べて答える相談窓口（API は /api/chishokan-ai）。
// 会話は画面の中だけに持つ（端末には保存しない）。ログはこれまでどおり会話ログのシートに残る。

import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string };
type Attach = { name: string; mime: string; kind: 'pdf' | 'image' | 'text'; data: string };

const MAX_TOTAL_BYTES = 3_500_000; // 送信全体の目安（Vercel のリクエスト上限に対する余裕分）

const EXAMPLES = [
  '冬期講習の外部生募集の計画を立てたい。今期の方針に沿って相談に乗ってください',
  '全社共通テーマの4つと、それぞれ仕事で意識することを教えて',
  '定期テスト対策のチラシを作りたい。何から決めればいい？',
  '（資料を添付して）この資料が会社の方針に沿っているかチェックして',
];

function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] ?? '');
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

// 画像は長辺1600pxに縮小してJPEG化（会議AIと同じ）。
async function imageToBase64(file: File): Promise<{ data: string; mime: string }> {
  const dataUrl: string = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  const img: HTMLImageElement = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = dataUrl;
  });
  let w = img.width;
  let h = img.height;
  const m = Math.max(w, h);
  if (m > 1600) {
    const s = 1600 / m;
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { data: dataUrl.split(',')[1] ?? '', mime: file.type || 'image/png' };
  ctx.drawImage(img, 0, 0, w, h);
  return { data: canvas.toDataURL('image/jpeg', 0.8).split(',')[1] ?? '', mime: 'image/jpeg' };
}

async function toAttach(file: File): Promise<Attach | null> {
  const mime = file.type || '';
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (mime === 'application/pdf' || ext === 'pdf') {
    return { name: file.name, mime: 'application/pdf', kind: 'pdf', data: await toBase64(file) };
  }
  if (mime.startsWith('image/')) {
    const { data, mime: m } = await imageToBase64(file);
    return { name: file.name, mime: m, kind: 'image', data };
  }
  if (mime.startsWith('text/') || ['txt', 'csv', 'md', 'json'].includes(ext)) {
    return { name: file.name, mime: 'text/plain', kind: 'text', data: await file.text() };
  }
  return null;
}

export default function ChishokanAiUI({ name, campus }: { name: string; campus: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const [attachNote, setAttachNote] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    const next: Attach[] = [...attachments];
    const skipped: string[] = [];
    for (const f of files) {
      try {
        const a = await toAttach(f);
        if (a) next.push(a);
        else skipped.push(f.name);
      } catch {
        skipped.push(f.name);
      }
    }
    if (next.reduce((n, a) => n + a.data.length, 0) > MAX_TOTAL_BYTES) {
      setAttachNote('添付が大きすぎます。ファイルを減らすか、小さいものにしてください。');
      return;
    }
    setAttachments(next.slice(0, 5));
    setAttachNote(
      skipped.length
        ? `${skipped.join('・')} は未対応です。PowerPoint・Excel・Word は「PDFに書き出して」添付してください。`
        : '',
    );
  }

  async function ask(text: string) {
    const q = text.trim();
    if ((!q && attachments.length === 0) || busy) return;
    const content = q || '添付した資料が、会社の方針に沿っているかチェックしてください。';
    const sending = attachments;
    const label = sending.length ? `${content}\n（添付：${sending.map((a) => a.name).join('、')}）` : content;
    setInput('');
    setAttachments([]);
    setAttachNote('');
    setBusy(true);

    // 画面には添付名つきで出し、API には本文だけを送る（添付は今回の質問にだけ付ける）。
    const shown: Msg[] = [...messages, { role: 'user', content: label }];
    const sent: Msg[] = [...messages, { role: 'user', content }];
    setMessages([...shown, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/chishokan-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: sent, attachments: sending }),
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => '');
        setMessages([...shown, { role: 'assistant', content: t || 'エラーが発生しました。' }]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMessages([...shown, { role: 'assistant', content: acc }]);
      }
      if (!acc) setMessages([...shown, { role: 'assistant', content: '回答を作れませんでした。もう一度お試しください。' }]);
    } catch {
      setMessages([...shown, { role: 'assistant', content: '通信エラーが発生しました。' }]);
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

  return (
    <div className="iqa-page">
      <div className="page-head">
        <h1>智翔館AI（試用版）</h1>
        <p>
          社内の資料（理念・方針・要項・チラシ制作ルールなど）を調べて答えます（{campus} / {name} さん）。
          答えには出典の資料名が付きます。
        </p>
        <p className="yq-pending-note">
          まだ入っていない資料：佐世保市の地域情報、Webページ制作・スライド制作のルール、業績の数字。
          これらは「資料に無い」と答えます。会話はこの画面を閉じると消えます。
        </p>
      </div>

      {messages.length === 0 && (
        <div className="iqa-examples">
          {EXAMPLES.map((e) => (
            <button key={e} className="iqa-example" onClick={() => setInput(e.replace(/^（資料を添付して）/, ''))} disabled={busy}>
              {e}
            </button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div className="yq-list">
          <button className="yq-toggle" onClick={() => setMessages([])} disabled={busy}>
            新しい相談を始める（会話を消す）
          </button>
        </div>
      )}

      <div className="wrap">
        <div className="messages">
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div>
                <div className="bubble">{m.content || '資料を確認しています…'}</div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <div className="composer">
        <div className="attach-bar">
          <label className="attach-btn">
            📎 資料を添付
            <input
              type="file"
              multiple
              accept=".pdf,image/*,.txt,.csv,.md"
              onChange={onPickFiles}
              style={{ display: 'none' }}
            />
          </label>
          {attachments.map((a, i) => (
            <span key={i} className="attach-chip">
              {a.name}
              <button onClick={() => setAttachments((v) => v.filter((_, j) => j !== i))} aria-label="外す">×</button>
            </span>
          ))}
          {attachNote && <span className="attach-note">{attachNote}</span>}
        </div>
        <div className="inner">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="相談したいことを書いてください（⌘/Ctrl+Enter で送信）"
          />
          <button onClick={() => ask(input)} disabled={busy || (!input.trim() && attachments.length === 0)}>
            {busy ? '…' : '送信'}
          </button>
        </div>
      </div>
    </div>
  );
}
