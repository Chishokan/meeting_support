'use client';

// 智翔館AI の画面。社内ナレッジを調べて答える相談窓口（API は /api/chishokan-ai）。
// 会話は画面の中だけに持つ（端末には保存しない）。ログはこれまでどおり会話ログのシートに残る。
//
// 回答は 1行1つの JSON で届く（lib/chishokanAi/conversation.ts）。文章・作業中の表示・読んだ資料・注意・途中で切れた知らせを分けて表示する。
// 会話の持ち越し：AI が読んだナレッジのパスと、文字にした資料（Word・Excel・PowerPoint・テキストの添付、ドライブの資料）を覚えておき、
// 次の質問と一緒に送る。PDF・画像は大きいので持ち越さない（続けて聞くときは付け直してもらう）。
// 作業の手順書：「よく使う作業」ボタン（knowledge/05_作業/ から作る）で選ぶと、手順書と資料を AI に先に渡す。
// AI が ```選択肢 で聞き返したら、ボタンで答えられる。回答には 👍👎 を付けられる（会話ログに残る）。

import { useEffect, useRef, useState } from 'react';
import AiMarkdown, { CopyButton } from '@/components/AiMarkdown';
import AiReportDialog from '@/components/AiReportDialog';
import { imageToBase64 } from '@/lib/chishokanAi/clientImage';
import type { ReportContext } from '@/lib/chishokanAi/report';
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
  /** 👍👎 */
  rating?: 'up' | 'down';
  feedbackSent?: boolean;
  /** 不具合の報告に添える情報：何回目のやり取りか、選んだ作業、回答が終わった時刻 */
  turn?: number;
  taskLabel?: string;
  at?: string;
};

/** 会話の番号（会話ログで1つの会話を探すため）。画面を開くたび・新しい相談のたびに作る。 */
function newConversationId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${rand}`;
}
type TaskButton = { id: string; button: string; starter: string; useWhen: string; path?: string };
type Attach = { name: string; mime: string; kind: 'pdf' | 'image' | 'text'; data: string };

const MAX_TOTAL_BYTES = 3_500_000; // 送信全体の目安（Vercel のリクエスト上限に対する余裕分）

/** API に送る履歴（エラーの知らせ・空の回答を除き、質問は添付名を付けない文にする）。 */
function toApi(msgs: Msg[]): { role: 'user' | 'assistant'; content: string }[] {
  return msgs
    .filter((m) => !m.error && (m.role === 'user' ? (m.api ?? m.content).trim() : m.content.trim()))
    .map((m) => ({ role: m.role, content: m.role === 'user' ? m.api ?? m.content : m.content }));
}

// 読んだ資料の札の文字。「00_使い方」のようにどのフォルダにもある名前は、フォルダ名を付ける。
function sourceLabel(s: Source): string {
  if (s.kind === 'drive') return s.name;
  const parts = s.path.replace(/\.md$/, '').split('/');
  const base = parts.pop() ?? s.path;
  return /^00_/.test(base) && parts.length ? `${parts.pop()}/${base}` : base;
}

// 作業ボタン以外の使い方の例。先頭の（　）は使い方の補足で、押したときは外して入力欄に入れる。
const EXAMPLES = [
  '冬期講習の外部生募集の計画を立てたい。今期の方針に沿って相談に乗ってください',
  '全社共通テーマの4つと、それぞれ仕事で意識することを教えて',
  '佐世保市内の中学校の2学期の期末テストの日程を教えて',
  '（文章を貼って）この保護者向けの文章を、やわらかい表現に直して',
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
  // よく使う作業（手順書）と、いま選んでいる作業
  const [tasks, setTasks] = useState<TaskButton[]>([]);
  const [task, setTask] = useState<TaskButton | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState<{ index: number; text: string } | null>(null);
  const [report, setReport] = useState<{ context: ReportContext; kind?: string } | null>(null);
  const convoIdRef = useRef<string>('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    fetch('/api/chishokan-ai', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setTasks(Array.isArray(j?.tasks) ? j.tasks : []))
      .catch(() => {});
  }, []);
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
    opts: { attachments?: Attach[]; continuation?: boolean; task?: string; start: Msg },
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
          task: opts.task,
          conversationId: convoIdRef.current,
          turn: opts.start.turn,
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
      draft = { ...draft, status: '', at: new Date().toLocaleString('ja-JP') };
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
    const chosen = task;
    const label = [
      chosen ? `🧭 ${chosen.button}` : '',
      content,
      sending.length ? `（添付：${sending.map((a) => a.name).join('、')}）` : '',
    ].filter(Boolean).join('\n');
    setInput('');
    setAttachments([]);
    setAttachNote('');
    setTask(null);
    setFeedbackDraft(null);

    // 画面には添付名つきで出し、API には本文だけを送る。
    if (!convoIdRef.current) convoIdRef.current = newConversationId();
    const base: Msg[] = [...messages, { role: 'user', content: label, api: content }];
    const turn = base.filter((m) => m.role === 'user').length;
    // 文字にした添付は、次の質問からも AI に渡す。PDF・画像は持ち越さない。
    const texts = sending.filter((a) => a.kind === 'text').map((a) => ({ name: a.name, text: a.data }));
    const heavy = sending.filter((a) => a.kind !== 'text').map((a) => a.name);
    const start: Msg = {
      role: 'assistant',
      content: '',
      turn,
      taskLabel: chosen?.button,
      notices: heavy.length ? [`PDF・画像（${heavy.join('、')}）は、次の質問には持ち越しません。続けて聞くときは付け直してください。`] : undefined,
    };
    setMessages([...base, start]);
    await run(toApi(base), base.length, { attachments: sending, task: chosen?.id, start });
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
    const start: Msg = { role: 'assistant', content: '', turn: last.turn, taskLabel: last.taskLabel };
    setMessages([...base, start]);
    await run(toApi(base), base.length, { start });
  }

  function stop() {
    abortRef.current?.abort();
  }

  function reset() {
    setMessages([]);
    convoIdRef.current = '';
    updateContext(EMPTY_CONTEXT);
    setTask(null);
    setFeedbackDraft(null);
  }

  // 不具合の報告の小窓を開く。index の回答（無ければいちばん新しい回答）の状況を添える。
  function openReport(index?: number, kind?: string) {
    let i = index ?? -1;
    if (i < 0) for (let k = messages.length - 1; k >= 0; k--) if (messages[k].role === 'assistant') { i = k; break; }
    const m = i >= 0 ? messages[i] : undefined;
    const q = m ? [...messages.slice(0, i)].reverse().find((x) => x.role === 'user') : undefined;
    const flags = m
      ? [
          m.cut ? `途中で切れた（${m.cut === 'time' ? '時間' : '長さ'}の上限）` : '',
          m.stopped ? '停止した' : '',
          m.error ? 'エラー' : '',
        ].filter(Boolean)
      : [];
    setReport({
      kind,
      context: {
        conversationId: convoIdRef.current || undefined,
        turn: m?.turn,
        at: m?.at,
        task: m?.taskLabel,
        flags,
        sources: (m?.sources ?? []).map((s) => (s.kind === 'knowledge' ? s.path : s.name)),
        notices: m?.notices ?? [],
        question: q?.api ?? q?.content,
        answer: m?.content,
      },
    });
  }

  // 作業ボタン：作業を選び、入力欄が空なら文の例を入れる（そのまま直して送れる）。
  function chooseTask(t: TaskButton | null) {
    setTask(t);
    if (t && !input.trim()) setInput(t.starter);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // 👍👎 を送る（会話ログに残る）。👎 はひとことを添えられる。
  async function sendFeedback(index: number, rating: 'up' | 'down', comment = '') {
    const m = messages[index];
    if (!m) return;
    const question = [...messages.slice(0, index)].reverse().find((x) => x.role === 'user');
    setMessages((prev) => prev.map((x, i) => (i === index ? { ...x, rating, feedbackSent: true } : x)));
    try {
      await fetch('/api/chishokan-ai/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          comment,
          question: question?.api ?? question?.content ?? '',
          answer: m.content,
          sources: (m.sources ?? []).map((s) => (s.kind === 'knowledge' ? s.path : s.name)),
          conversationId: convoIdRef.current,
          turn: m.turn,
        }),
      });
    } catch {}
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
  // 前の回に開いた作業の手順書（持ち越しに入っていると、次の質問もその作業として進む）
  const carriedTaskPath = [...context.reads].reverse().find((p) => p.startsWith('05_作業/'));
  const carriedTask = !task && carriedTaskPath ? tasks.find((t) => t.path === carriedTaskPath) : undefined;
  function endCarriedTask() {
    updateContext({ ...contextRef.current, reads: contextRef.current.reads.filter((p) => !p.startsWith('05_作業/')) });
  }

  return (
    <div className="iqa-page">
      <div className="page-head">
        <h1>智翔館AI（試用版）</h1>
        <p>社内の資料をもとに答えます。資料づくりや文章の手直しにも使えます。</p>
        <div className="ai-head-links">
          <details className="ai-about">
            <summary>使い方と注意</summary>
            <ul>
              <li>社内のこと（日付・料金・方針など）は社内の資料だけで答え、出典を付けます。Web は見ません</li>
              <li>PDF・画像・Word・Excel・PowerPoint は添付、Google のファイルはリンクを貼ると読みます（決められたフォルダの中だけ・1回に3件まで）</li>
              <li>業績の数字（売上・利益）は持っていません</li>
              <li>会話は、この画面を閉じると消えます</li>
            </ul>
          </details>
          <button type="button" className="ai-report-open" onClick={() => openReport()}>
            ⚠ 不具合を報告
          </button>
        </div>
      </div>

      {messages.length === 0 && tasks.length > 0 && (
        <>
          <div className="ai-section-label">よく使う作業</div>
          <div className="ai-tasks">
            {tasks.map((t) => (
              <button key={t.id} type="button" className="ai-task" onClick={() => chooseTask(t)} disabled={busy}>
                <b>🧭 {t.button}</b>
                <span>{t.useWhen}</span>
              </button>
            ))}
          </div>
          <div className="ai-section-label">ほかの使い方の例</div>
        </>
      )}

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
                    {m.content ? (
                      <AiMarkdown text={m.content} onChoose={isLast && !busy ? (c) => ask(c) : undefined} streaming={streaming} />
                    ) : (
                      <span className="ai-status">{m.status || '考えています…'}</span>
                    )}
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
                      <span className="ai-feedback">
                        <button
                          type="button"
                          className={`msg-action${m.rating === 'up' ? ' on' : ''}`}
                          disabled={m.feedbackSent}
                          aria-label="役に立った"
                          title="役に立った"
                          onClick={() => sendFeedback(i, 'up')}
                        >
                          👍
                        </button>
                        <button
                          type="button"
                          className={`msg-action${m.rating === 'down' ? ' on' : ''}`}
                          disabled={m.feedbackSent}
                          aria-label="違っていた"
                          title="違っていた"
                          onClick={() => setFeedbackDraft({ index: i, text: '' })}
                        >
                          👎
                        </button>
                      </span>
                      <button type="button" className="msg-action" title="この回答の不具合を報告" onClick={() => openReport(i)}>
                        ⚠ 報告
                      </button>
                      {isLast && !busy && (
                        <button type="button" className="msg-action" onClick={regenerate}>
                          もう一度答えさせる
                        </button>
                      )}
                    </div>
                  )}
                  {feedbackDraft?.index === i && !m.feedbackSent && (
                    <form
                      className="ai-feedback-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        sendFeedback(i, 'down', feedbackDraft.text.trim());
                        setFeedbackDraft(null);
                      }}
                    >
                      <input
                        autoFocus
                        value={feedbackDraft.text}
                        onChange={(e) => setFeedbackDraft({ index: i, text: e.target.value })}
                        placeholder="どこが違っていましたか（空でも送れます）"
                        maxLength={500}
                      />
                      <button type="submit" className="msg-action">送る</button>
                      <button type="button" className="msg-action" onClick={() => setFeedbackDraft(null)}>やめる</button>
                    </form>
                  )}
                  {m.feedbackSent && <div className="ai-feedback-thanks">評価を送りました。回答の改善に使います。</div>}
                  {m.error && !streaming && (
                    <div className="msg-actions">
                      {isLast && !busy && i > 0 && (
                        <button type="button" className="msg-action" onClick={regenerate}>
                          もう一度送る
                        </button>
                      )}
                      <button
                        type="button"
                        className="msg-action"
                        onClick={() => openReport(i, 'エラーが出た・止まった・途中で切れた')}
                      >
                        ⚠ 報告
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
          {tasks.length > 0 && (
            <select
              className="ai-task-picker"
              value={task?.id ?? ''}
              onChange={(e) => chooseTask(tasks.find((t) => t.id === e.target.value) ?? null)}
              aria-label="作業を選ぶ"
              disabled={busy}
            >
              <option value="">🧭 作業を選ぶ</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>{t.button}</option>
              ))}
            </select>
          )}
          {carriedTask && (
            <span className="attach-chip task-chip" title="次の質問も、この作業の手順書に沿って進めます。別の話題に移るときは × で作業を終えます">
              🧭 作業の続き：{carriedTask.button}
              <button onClick={endCarriedTask} disabled={busy} aria-label="作業を終える">×</button>
            </span>
          )}
          {task && (
            <span className="attach-chip task-chip" title={task.useWhen}>
              🧭 {task.button}
              <button onClick={() => setTask(null)} aria-label="作業を外す">×</button>
            </span>
          )}
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
            ref={inputRef}
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
      {report && <AiReportDialog context={report.context} initialKind={report.kind} onClose={() => setReport(null)} />}
    </div>
  );
}
