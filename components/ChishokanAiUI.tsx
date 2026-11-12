'use client';

// 智翔館AI の画面。社内ナレッジを調べて答える相談窓口（API は /api/chishokan-ai）。
// 会話は画面の中だけに持つ（端末には保存しない）。ログはこれまでどおり会話ログのシートに残る。
//
// 回答は 1行1つの JSON で届く（lib/chishokanAi/conversation.ts）。文章・作業中の表示・読んだ資料・注意・途中で切れた知らせを分けて表示する。
// 会話の持ち越し：AI が読んだナレッジのパスと、文字にした資料（Word・Excel・PowerPoint・テキストの添付、ドライブの資料）を覚えておき、
// 次の質問と一緒に送る。PDF・画像は大きいので持ち越さない（続けて聞くときは付け直してもらう）。

import { useEffect, useRef, useState } from 'react';
import AiMarkdown, { CopyButton } from '@/components/AiMarkdown';
import { toPlainText } from '@/lib/chishokanAi/markdown';
import {
  CONTINUE_PROMPT,
  EMPTY_CONTEXT,
  mergeContext,
  parseEvents,
  type CarryContext,
  type Source,
} from '@/lib/chishokanAi/conversation';

type Msg = {
  role: 'user' | 'assistant';
  /** 画面に出す文（質問は添付名つき、回答は Markdown） */
  content: string;
  /** 質問のうち API に送る文（添付名を付けない） */
  api?: string;
  /** 作業中の表示（📄 …を読んでいます） */
  status?: string;
  sources?: Source[];
  notices?: string[];
  cut?: 'time' | 'length' | null;
  stopped?: boolean;
  /** エラーの知らせ。次の質問の履歴には入れない */
  error?: boolean;
};
type Attach = { name: string; mime: string; kind: 'pdf' | 'image' | 'text'; data: string };

const MAX_TOTAL_BYTES = 3_500_000; // 送信全体の目安（Vercel のリクエスト上限に対する余裕分）

/** API に送る履歴（エラーの知らせ・空の回答を除き、質問は添付名を付けない文にする）。 */
function toApi(msgs: Msg[]): { role: 'user' | 'assistant'; content: string }[] {
  return msgs
    .filter((m) => !m.error && (m.role === 'user' ? (m.api ?? m.content).trim() : m.content.trim()))
    .map((m) => ({ role: m.role, content: m.role === 'user' ? m.api ?? m.content : m.content }));
}

function sourceLabel(s: Source): string {
  return s.kind === 'knowledge' ? (s.path.split('/').pop() ?? s.path).replace(/\.md$/, '') : s.name;
}

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
  // この会話で読んだ資料（次の質問と一緒に送る）
  const [context, setContext] = useState<CarryContext>(EMPTY_CONTEXT);
  const contextRef = useRef<CarryContext>(EMPTY_CONTEXT);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // 送信のしかたの案内。スマートフォンでは Enter が改行になるので、表示を切り替える（画面の表示後に判定する）。
  const [sendHint, setSendHint] = useState('Enter で送信・Shift+Enter で改行');
  useEffect(() => {
    if (!enterSends()) setSendHint('送信は右のボタンで');
  }, []);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function updateContext(next: CarryContext) {
    contextRef.current = next;
    setContext(next);
  }

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

  /**
   * API に送って、届いた回答を index 番目の回答に書き込む。
   * continuation のときは、今ある回答の後ろに足していく（「続きを書く」）。
   */
  async function run(
    apiMessages: { role: 'user' | 'assistant'; content: string }[],
    index: number,
    opts: { attachments?: Attach[]; continuation?: boolean; start: Msg },
  ) {
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    let draft: Msg = { ...opts.start, status: '', cut: null, stopped: false };
    const show = () => {
      const d = { ...draft };
      setMessages((prev) => prev.map((m, i) => (i === index ? d : m)));
    };
    show();
    try {
      const res = await fetch('/api/chishokan-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          attachments: opts.attachments ?? [],
          context: contextRef.current,
          continuation: !!opts.continuation,
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => '');
        draft = { ...draft, content: draft.content || t || 'エラーが発生しました。', error: !draft.content };
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { events, rest } = parseEvents(buf);
        buf = rest;
        if (!events.length) continue;
        for (const ev of events) {
          if (ev.t === 'text') draft = { ...draft, content: draft.content + ev.v, status: '' };
          else if (ev.t === 'status') draft = { ...draft, status: ev.v };
          else if (ev.t === 'sources') draft = { ...draft, sources: [...(draft.sources ?? []), ...ev.items] };
          else if (ev.t === 'notice') draft = { ...draft, notices: [...(draft.notices ?? []), ev.v] };
          else if (ev.t === 'cut') draft = { ...draft, cut: ev.reason };
          else if (ev.t === 'error') draft = { ...draft, notices: [...(draft.notices ?? []), ev.v], error: !draft.content };
          else if (ev.t === 'context') updateContext(mergeContext(contextRef.current, { reads: ev.reads, texts: ev.texts }));
        }
        show();
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') draft = { ...draft, stopped: true };
      else if (draft.content) draft = { ...draft, notices: [...(draft.notices ?? []), '通信が途中で切れました。'] };
      else draft = { ...draft, content: '通信エラーが発生しました。', error: true };
    } finally {
      draft = { ...draft, status: '' };
      if (!draft.content && !draft.stopped && !draft.error) {
        draft = { ...draft, content: '回答を作れませんでした。もう一度お試しください。', error: true };
      }
      if (!draft.content && draft.stopped) draft = { ...draft, content: '（停止しました）', error: true };
      show();
      abortRef.current = null;
      setBusy(false);
    }
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

    // 画面には添付名つきで出し、API には本文だけを送る。
    const base: Msg[] = [...messages, { role: 'user', content: label, api: content }];
    // 文字にした添付は、次の質問からも AI に渡す。PDF・画像は持ち越さない。
    const texts = sending.filter((a) => a.kind === 'text').map((a) => ({ name: a.name, text: a.data }));
    const heavy = sending.filter((a) => a.kind !== 'text').map((a) => a.name);
    const start: Msg = {
      role: 'assistant',
      content: '',
      notices: heavy.length ? [`PDF・画像（${heavy.join('、')}）は、次の質問には持ち越しません。続けて聞くときは付け直してください。`] : undefined,
    };
    setMessages([...base, start]);
    await run(toApi(base), base.length, { attachments: sending, start });
    if (texts.length) updateContext(mergeContext(contextRef.current, { texts }));
  }

  // 途中で切れた回答の続きを書かせる。画面には出さない「（続き）…」を送り、同じ回答の後ろに足す。
  async function continueAnswer() {
    const last = messages[messages.length - 1];
    if (busy || !last || last.role !== 'assistant' || !last.cut) return;
    const apiMessages = [...toApi(messages), { role: 'user' as const, content: CONTINUE_PROMPT }];
    await run(apiMessages, messages.length - 1, { continuation: true, start: { ...last, cut: null } });
  }

  // いちばん新しい回答を作り直す（添付の PDF・画像は付け直されない）。
  async function regenerate() {
    const last = messages[messages.length - 1];
    if (busy || !last || last.role !== 'assistant') return;
    const base = messages.slice(0, -1);
    const start: Msg = { role: 'assistant', content: '' };
    setMessages([...base, start]);
    await run(toApi(base), base.length, { start });
  }

  function stop() {
    abortRef.current?.abort();
  }

  function reset() {
    setMessages([]);
    updateContext(EMPTY_CONTEXT);
  }

  // Enter で送信、Shift+Enter で改行（一般的なチャットAIと同じ）。日本語の変換を確定する Enter では送らない。
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.metaKey || e.ctrlKey || (!e.shiftKey && enterSends())) {
      e.preventDefault();
      ask(input);
    }
  }

  const carried = context.reads.length + context.texts.length;

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
        <div className="yq-list ai-convo-bar">
          <button className="yq-toggle" onClick={reset} disabled={busy}>
            新しい相談を始める（会話を消す）
          </button>
          {carried > 0 && (
            <span className="ai-carry-note" title={[...context.reads, ...context.texts.map((t) => t.name)].join('\n')}>
              この会話で読んだ資料 {carried} 件を、次の質問でもAIに渡します
            </span>
          )}
        </div>
      )}

      <div className="wrap">
        <div className="messages">
          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            const streaming = busy && isLast;
            if (m.role === 'user') {
              return (
                <div key={i} className="msg user">
                  <div>
                    <div className="bubble"><Linkified text={m.content} /></div>
                  </div>
                </div>
              );
            }
            return (
              <div key={i} className="msg assistant">
                <div>
                  <div className={`bubble md-bubble${m.error ? ' ai-error' : ''}`}>
                    {m.content ? <AiMarkdown text={m.content} /> : <span className="ai-status">{m.status || '考えています…'}</span>}
                  </div>
                  {streaming && m.content && m.status && <div className="ai-status ai-status-line">{m.status}</div>}
                  {m.stopped && m.content && !m.error && <div className="ai-flag">（停止しました）</div>}
                  {m.cut && !streaming && (
                    <div className="ai-cut">
                      ⚠ 回答が途中で切れました（{m.cut === 'time' ? '時間の上限' : '長さの上限'}）。
                      {isLast && (
                        <button type="button" className="msg-action" onClick={continueAnswer} disabled={busy}>
                          続きを書く
                        </button>
                      )}
                    </div>
                  )}
                  {m.notices?.map((n, j) => (
                    <div key={j} className="ai-notice">{n}</div>
                  ))}
                  {!streaming && m.sources && m.sources.length > 0 && (
                    <div className="ai-sources">
                      <span className="ai-sources-label">読んだ資料</span>
                      {m.sources.map((s, j) =>
                        s.kind === 'drive' ? (
                          <a key={j} className="ai-source" href={`https://drive.google.com/open?id=${encodeURIComponent(s.id)}`} target="_blank" rel="noopener noreferrer">
                            {sourceLabel(s)}
                          </a>
                        ) : (
                          <span key={j} className="ai-source" title={s.path}>{sourceLabel(s)}</span>
                        ),
                      )}
                    </div>
                  )}
                  {m.content && !m.error && !streaming && (
                    <div className="msg-actions">
                      <CopyButton text={() => toPlainText(m.content)} label="回答をコピー" className="msg-action" />
                      {isLast && !busy && (
                        <button type="button" className="msg-action" onClick={regenerate}>
                          もう一度答えさせる
                        </button>
                      )}
                    </div>
                  )}
                  {m.error && isLast && !busy && i > 0 && (
                    <div className="msg-actions">
                      <button type="button" className="msg-action" onClick={regenerate}>
                        もう一度送る
                      </button>
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
          {busy ? (
            <button type="button" className="ai-stop" onClick={stop}>
              停止
            </button>
          ) : (
            <button onClick={() => ask(input)} disabled={!input.trim() && attachments.length === 0}>
              送信
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
