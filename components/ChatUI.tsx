'use client';

import { useEffect, useRef, useState } from 'react';
import { sanitizeHistory, stripRoleBleed } from '@/lib/sanitize';

type Msg = { role: 'user' | 'assistant'; content: string };
type Attach = { name: string; mime: string; kind: 'pdf' | 'image' | 'text'; data: string };

// 会議AIのモード。meeting＝通常の事前報告 / summer＝夏の結果報告（計画確認なし）。
type Mode = 'meeting' | 'summer';

const MODES: { id: Mode; label: string; title: string; desc: string; hint: string }[] = [
  {
    id: 'meeting',
    label: '事前報告',
    title: '会議AI',
    desc: '会議前の報告を、AIとの対話で「協議・報告・決裁」に整理します。',
    hint: '事前報告をまとめましょう。下の入力欄に「会議の報告を始めたい」などと送るか、共有したいことを箇条書きで貼り付けてください。',
  },
  {
    id: 'summer',
    label: '夏の結果報告',
    title: '会議AI（夏の結果報告）',
    desc: '夏の結果を、募集・継続・成績の「昨年対比／目標対比」とその他振り返りに整理します。授業担当の方は夏期講習会の振り返りのみです。',
    hint: '夏の結果報告をまとめましょう。下の入力欄に「始めたい」と送ってください（集計表の貼り付け・PDFの添付もできます）。',
  },
];

const MAX_TOTAL_BYTES = 3_500_000; // 送信全体の目安（Vercelのリクエスト上限に対する余裕分）

function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] ?? '');
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

// 画像は長辺1600pxに縮小してJPEG化（PDFはそのまま）。
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

// ファイルを添付データへ変換。未対応形式は null（呼び出し側で案内）。
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

const STORE_PREFIX = 'chishokan_chat_v1';

// 会話はモードごとに分けて保存する（既存の事前報告の履歴はキーを変えない）。
function keyFor(campus: string, name: string, mode: Mode): string {
  return `${STORE_PREFIX}:${campus}/${name}${mode === 'summer' ? ':summer' : ''}`;
}

function loadMessages(key: string): Msg[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    // 過去に保存された役割漏れ・空メッセージをここで浄化して復元する。
    return Array.isArray(arr) ? (sanitizeHistory(arr) as Msg[]) : [];
  } catch {
    return []; // 読み込み失敗は無視して新規開始
  }
}

export default function ChatUI({ name, campus }: { name: string; campus: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const [attachNote, setAttachNote] = useState('');
  const [mode, setMode] = useState<Mode>('meeting');

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 同じファイルを再選択できるように
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
    const total = next.reduce((n, a) => n + a.data.length, 0);
    if (total > MAX_TOTAL_BYTES) {
      setAttachNote('添付が大きすぎます。ファイルを減らすか、小さいものにしてください。');
      return;
    }
    setAttachments(next.slice(0, 5));
    setAttachNote(
      skipped.length
        ? `${skipped.join('・')} は未対応です。Excel/Wordは「PDFに書き出して」添付してください。`
        : '',
    );
  }
  const endRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const sendingRef = useRef(false);
  const storeKey = keyFor(campus, name, mode);
  const modeKey = `${STORE_PREFIX}:mode:${campus}/${name}`;
  const view = MODES.find((m) => m.id === mode) ?? MODES[0];

  // 同じ端末・ブラウザで中断→再開できるよう、会話を localStorage に保存する。
  // 前回開いていたモードと、そのモードの会話を復元する。
  useEffect(() => {
    let m: Mode = 'meeting';
    try {
      if (localStorage.getItem(modeKey) === 'summer') m = 'summer';
    } catch {}
    const saved = loadMessages(keyFor(campus, name, m));
    setMode(m);
    if (saved.length) {
      setMessages(saved);
      setRestored(true);
    }
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 空配列での上書き（＝マウント直後や空のモードへの切替）で他モードの履歴を消さないよう、
  // 保存は会話がある時だけ。削除は resetChat で明示的に行う。
  useEffect(() => {
    if (!loaded.current || !messages.length) return;
    try {
      localStorage.setItem(storeKey, JSON.stringify(messages));
    } catch {
      // 保存失敗は本処理を止めない
    }
  }, [messages, storeKey]);

  // モード切替：会話はモードごとに保持し、切り替え先の続きから再開する。
  function switchMode(next: Mode) {
    if (busy || next === mode) return;
    const saved = loadMessages(keyFor(campus, name, next));
    setMode(next);
    setMessages(saved);
    setRestored(saved.length > 0);
    setInput('');
    setAttachments([]);
    setAttachNote('');
    try {
      localStorage.setItem(modeKey, next);
    } catch {}
  }

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
    if ((!t && attachments.length === 0) || sendingRef.current) return;
    sendingRef.current = true;
    const sending = attachments;
    const base = t || '資料を添付しました。内容の確認をお願いします。';
    const label = sending.length ? `${base}\n（添付：${sending.map((a) => a.name).join('・')}）` : base;
    const next: Msg[] = [...messages, { role: 'user', content: label }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setAttachments([]);
    setAttachNote('');
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, attachments: sending, mode }),
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
    if (!t && attachments.length === 0) return;
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
        <h1>{view.title}</h1>
        <p>{view.desc}</p>
        <div className="mode-switch">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={`mode-btn ${m.id === mode ? 'active' : ''}`}
              onClick={() => switchMode(m.id)}
              disabled={busy}
            >
              {m.label}
            </button>
          ))}
        </div>
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
            <div className="hint">{view.hint}</div>
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
        <div className="attach-bar">
          <label className="attach-btn">
            📎 ファイルを添付
            <input
              type="file"
              multiple
              accept=".pdf,image/*,.txt,.csv,.md"
              onChange={onPickFiles}
              hidden
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
            placeholder="メッセージを入力（⌘/Ctrl+Enter で送信）"
          />
          <button onClick={onSend} disabled={busy || (!input.trim() && attachments.length === 0)}>
            {busy ? '…' : '送信'}
          </button>
        </div>
      </div>
    </>
  );
}
