'use client';

// 智翔館AI の画面。社内ナレッジを調べて答える相談窓口（API は /api/chishokan-ai）。
// 会話は画面の中だけに持つ（端末には保存しない）。ログはこれまでどおり会話ログのシートに残る。

import { useEffect, useRef, useState } from 'react';
import AiMarkdown, { CopyButton } from '@/components/AiMarkdown';
import { toPlainText } from '@/lib/chishokanAi/markdown';

type Msg = { role: 'user' | 'assistant'; content: string };
type Attach = { name: string; mime: string; kind: 'pdf' | 'image' | 'text'; data: string };

const MAX_TOTAL_BYTES = 3_500_000; // 送信全体の目安（Vercel のリクエスト上限に対する余裕分）

// 先頭の（　）は使い方の補足。押したときは外して入力欄に入れる。
const EXAMPLES = [
  '冬期講習の外部生募集の計画を立てたい。今期の方針に沿って相談に乗ってください',
  '中3冬期講習のチラシの原稿を作って',
  '全体会議で9月の振り返りを発表するスライドの流れを考えて',
  '冬期講習の外部生募集の計画書を Google ドキュメントで作って',
  '（文章を貼って）この保護者向けの文章を、やわらかい表現に直して',
  '（資料を添付して）この資料が会社の方針に沿っているかチェックして',
];

// スマートフォン・タブレット（Shift キーが無い）では、Enter は改行にして、送信はボタンで行う。
function enterSends(): boolean {
  try {
    return !window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return true;
  }
}

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
  // Word・Excel・PowerPoint は、この画面の中で文字と表を取り出してから送る（送る量が軽くなる）。
  if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx') {
    const { officeToText } = await import('@/lib/chishokanAi/officeText');
    const text = await officeToText(ext, await file.arrayBuffer());
    return { name: file.name, mime: 'text/plain', kind: 'text', data: text };
  }
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

// 職員の質問の中のURLを押せるリンクにする（回答は AiMarkdown で整えて表示する）。
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)）」]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default function ChishokanAiUI({ name, campus }: { name: string; campus: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const [attachNote, setAttachNote] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  // 送信のしかたの案内。スマートフォンでは Enter が改行になるので、表示を切り替える（画面の表示後に判定する）。
  const [sendHint, setSendHint] = useState('Enter で送信・Shift+Enter で改行');
  useEffect(() => {
    if (!enterSends()) setSendHint('送信は右のボタンで');
  }, []);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    const next: Attach[] = [...attachments];
    const skipped: string[] = [];
    const legacy: string[] = [];
    for (const f of files) {
      try {
        const ext = (f.name.split('.').pop() ?? '').toLowerCase();
        if (ext === 'doc' || ext === 'xls' || ext === 'ppt') { legacy.push(f.name); continue; }
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
    const notes: string[] = [];
    if (legacy.length) notes.push(`${legacy.join('・')} は古い形式のため読めません。.docx・.xlsx・.pptx で保存し直すか、PDFにして添付してください。`);
    if (skipped.length) notes.push(`${skipped.join('・')} は未対応か、読み取れませんでした。`);
    setAttachNote(notes.join(' '));
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

  // Enter で送信、Shift+Enter で改行（一般的なチャットAIと同じ）。日本語の変換を確定する Enter では送らない。
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.metaKey || e.ctrlKey || (!e.shiftKey && enterSends())) {
      e.preventDefault();
      ask(input);
    }
  }

  return (
    <div className="iqa-page">
      <div className="page-head">
        <h1>智翔館AI（試用版）</h1>
        <p>
          社内の資料（理念・方針・要項・部門の計画・地域の情報・チラシやスライドの作り方など）を調べて答えます（{campus} / {name} さん）。
          社内のこと（日付・料金・数字・方針など）は社内の資料だけをもとに答え、出典の資料名を付けます。Web は見ません。
          文章の手直し・要約・アイデア出しなど、ふだんのチャットAIと同じ使い方もできます。
        </p>
        <p className="yq-pending-note">
          資料は、PDF・画像・Word・Excel・PowerPoint を添付するか、Google ドキュメント・スプレッドシート・スライドのリンクを貼ると読みます
          （リンクは決められたフォルダの中のファイルだけ・1回に3件まで）。業績の数字（売上・利益）は持っていません。
          会話はこの画面を閉じると消えます。
        </p>
      </div>

      {messages.length === 0 && (
        <div className="iqa-examples">
          {EXAMPLES.map((e) => (
            <button key={e} className="iqa-example" onClick={() => setInput(e.replace(/^（[^）]*）/, ''))} disabled={busy}>
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
          {messages.map((m, i) => {
            const streaming = busy && i === messages.length - 1;
            return (
              <div key={i} className={`msg ${m.role}`}>
                <div>
                  {m.role === 'user' ? (
                    <div className="bubble"><Linkified text={m.content} /></div>
                  ) : (
                    <div className="bubble md-bubble">
                      {m.content ? <AiMarkdown text={m.content} /> : '資料を確認しています…'}
                    </div>
                  )}
                  {m.role === 'assistant' && m.content && !streaming && (
                    <div className="msg-actions">
                      <CopyButton text={() => toPlainText(m.content)} label="回答をコピー" className="msg-action" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
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
              accept=".pdf,image/*,.txt,.csv,.md,.docx,.xlsx,.pptx,.doc,.xls,.ppt"
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
            placeholder={`相談したいことを書いてください。Google のファイルはリンクを貼れば読みます（${sendHint}）`}
          />
          <button onClick={() => ask(input)} disabled={busy || (!input.trim() && attachments.length === 0)}>
            {busy ? '…' : '送信'}
          </button>
        </div>
      </div>
    </div>
  );
}
