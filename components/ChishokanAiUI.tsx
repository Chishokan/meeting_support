'use client';

// 智翔館AI の画面。社内ナレッジを調べて答える相談窓口（API は /api/chishokan-ai）。
// 会話は画面の中だけに持つ（端末には保存しない）。ログはこれまでどおり会話ログのシートに残る。
// 右の欄（components/AiContextPanel.tsx）：コンテキスト（職員が置く会話の前提。質問のたびに AI に渡す）、読んだ資料、
// 会話のファイルへの書き出しと、書き出したファイルからの再開（lib/chishokanAi/savedConversation.ts）。
// AI がコンテキストの直し案を出したら、見比べる小窓（components/AiContextDiffDialog.tsx）で「置き換える」を押したときだけ変わる。
//
// 回答は 1行1つの JSON で届く（lib/chishokanAi/conversation.ts）。文章・作業中の表示・読んだ資料・注意・途中で切れた知らせを分けて表示する。
// 会話の持ち越し：AI が読んだナレッジのパスと、文字にした資料（Word・Excel・PowerPoint・テキストの添付、ドライブの資料）を覚えておき、
// 次の質問と一緒に送る。PDF・画像は大きいので持ち越さない（続けて聞くときは付け直してもらう）。
// 作業の手順書：「よく使う作業」ボタン（knowledge/05_作業/ から作る）で選ぶと、手順書と資料を AI に先に渡す。
// AI が ```選択肢 で聞き返したら、ボタンで答えられる。回答には 👍👎 を付けられる（会話ログに残る）。

import { useEffect, useRef, useState } from 'react';
import AiMarkdown, { CopyButton } from '@/components/AiMarkdown';
import AiContextPanel, { type PinDraft, type PinProposalView, type SavedView } from '@/components/AiContextPanel';
import AiContextDiffDialog from '@/components/AiContextDiffDialog';
import AiReportDialog from '@/components/AiReportDialog';
import AiRequestDialog from '@/components/AiRequestDialog';
import { imageToBase64 } from '@/lib/chishokanAi/clientImage';
import type { ReportContext } from '@/lib/chishokanAi/report';
import { toPlainText } from '@/lib/chishokanAi/markdown';
import {
  CONTINUE_PROMPT,
  EMPTY_CONTEXT,
  LONG_CONVERSATION_CHARS,
  SUMMARY_PROMPT,
  mergeContext,
  normalizeContext,
  parseEvents,
  type CarryContext,
  type Source,
} from '@/lib/chishokanAi/conversation';
import {
  guessPinName,
  newPinned,
  nextPinId,
  normalizePinnedList,
  PIN_MAX_ITEMS,
  PIN_MAX_TEXT,
  PIN_TOTAL_CHARS,
  pinnedTotal,
  replacePinned,
  restorePinned,
  type Pinned,
  type PinLogAction,
} from '@/lib/chishokanAi/pinnedContext';
import { buildSaved, conversationTitle, parseSaved, SAVE_MAX_BYTES, savedFileName, type SavedConversation } from '@/lib/chishokanAi/savedConversation';
import type { ConvoRow, Preset } from '@/lib/chishokanAi/savedRules';

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
  /** この回答で AI が出した、コンテキストの直し案（PinProposalView の key） */
  pins?: string[];
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
  // 右の欄：コンテキスト（質問のたびに送る）、AI の直し案、追加の入力欄、狭い画面での開け閉め、見比べる小窓
  const [pinned, setPinned] = useState<Pinned[]>([]);
  const pinnedRef = useRef<Pinned[]>([]);
  const pinUsedRef = useRef(0);
  const [proposals, setProposals] = useState<PinProposalView[]>([]);
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [diffKey, setDiffKey] = useState<string | null>(null);
  const [panelNote, setPanelNote] = useState('');
  // サーバーへの保存（メールアドレスでログインしたときだけ使える）。履歴は質問のたびに自動で保存する
  const [saved, setSaved] = useState<SavedView | null>(null);
  const savedRef = useRef<SavedView | null>(null);
  const messagesRef = useRef<Msg[]>([]);
  const busyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  // 「新しい相談を始める」で、コンテキストを残すか聞いているところ
  const [resetAsk, setResetAsk] = useState(false);
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

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  function updateSaved(next: SavedView | null) {
    savedRef.current = next;
    setSaved(next);
  }

  // 保存した会話・履歴・いつものコンテキストを読む（使えないときは何も出さない。保存先の設定が無いときだけ理由を出す）
  useEffect(() => {
    fetch('/api/chishokan-ai/conversations', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.enabled) {
          const v: SavedView = { enabled: true, history: j.history ?? [], saved: j.saved ?? [], presets: j.presets ?? [] };
          updateSaved(v);
          addAutoPresets(v.presets);
        } else if (j?.reason === 'db') {
          updateSaved({ enabled: false, message: j.message, history: [], saved: [], presets: [] });
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自動保存：回答が終わったとき・コンテキストを変えたとき（少し待ってまとめて）
  useEffect(() => {
    if (!busy && messages.some((m) => m.role === 'user')) scheduleSave(300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  useEffect(() => {
    if (messagesRef.current.some((m) => m.role === 'user')) scheduleSave(1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, context]);

  function scheduleSave(ms: number) {
    if (!savedRef.current?.enabled) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void saveNow(); }, ms);
  }

  function currentSaved(id: string): SavedConversation {
    return buildSaved({
      conversationId: id,
      messages: messagesRef.current.filter((m) => !(m.role === 'assistant' && !m.content)),
      pinned: pinnedRef.current,
      pinUsed: pinUsedRef.current,
      carry: contextRef.current,
      savedAt: new Date().toISOString(),
    });
  }

  /** いまの会話をサーバーに保存する（履歴）。保存できたら一覧も直す。 */
  async function saveNow(): Promise<boolean> {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const sv = savedRef.current;
    if (!sv?.enabled || busyRef.current || !messagesRef.current.some((m) => m.role === 'user')) return false;
    const id = ensureConvoId();
    const data = currentSaved(id);
    const res = await fetch('/api/chishokan-ai/conversations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, data }),
    }).catch(() => null);
    if (!res) return false;
    if (res.status === 413) { setTooLarge(true); return false; }
    const j = await res.json().catch(() => null);
    if (!j?.ok) return false;
    const now = new Date().toISOString();
    const cur = savedRef.current;
    if (!cur) return true;
    const old = [...cur.saved, ...cur.history].find((r) => r.id === id);
    const row: ConvoRow = {
      id, kind: j.kind === '保存' ? '保存' : '履歴', title: j.kind === '保存' && old ? old.title : data.title,
      turns: data.messages.filter((m) => m.role === 'user').length, chars: 0, createdAt: old?.createdAt ?? now, updatedAt: now,
    };
    const others = (xs: ConvoRow[]) => xs.filter((r) => r.id !== id);
    updateSaved({
      ...cur,
      saved: row.kind === '保存' ? [row, ...others(cur.saved)] : others(cur.saved),
      history: row.kind === '履歴' ? [row, ...others(cur.history)] : others(cur.history),
    });
    return true;
  }

  function updateContext(next: CarryContext) {
    contextRef.current = next;
    setContext(next);
  }

  function updatePinned(next: Pinned[]) {
    pinnedRef.current = next;
    setPinned(next);
  }

  function ensureConvoId(): string {
    if (!convoIdRef.current) convoIdRef.current = newConversationId();
    return convoIdRef.current;
  }

  // コンテキストの追加・置き換えなどを会話ログに1行残す（名前・字数・はじめの200字）
  function logPin(action: PinLogAction, p: { id: string; name: string; text: string }) {
    fetch('/api/chishokan-ai/context-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: ensureConvoId(), action, id: p.id, name: p.name, text: p.text }),
    }).catch(() => {});
  }

  /** コンテキストに足す。足せないときは理由を欄に出して false。 */
  function addPin(name: string, text: string, by: 'added' | 'ai' = 'added', silent = false): boolean {
    const cur = pinnedRef.current;
    const t = text.trim();
    if (!t) return false;
    if (cur.length >= PIN_MAX_ITEMS) { setPanelNote(`コンテキストは${PIN_MAX_ITEMS}個までです。要らない項目を消してください。`); return false; }
    if (t.length > PIN_MAX_TEXT || pinnedTotal(cur) + t.length > PIN_TOTAL_CHARS) {
      setPanelNote(`長すぎます（1つ${PIN_MAX_TEXT.toLocaleString()}字・合計${PIN_TOTAL_CHARS.toLocaleString()}字まで）。短くしてください。`);
      return false;
    }
    const { id, used } = nextPinId(cur, pinUsedRef.current);
    pinUsedRef.current = used;
    const p = newPinned(id, name || guessPinName(t), t, by, new Date().toISOString());
    updatePinned([...cur, p]);
    if (!silent) {
      logPin('追加', p);
      setPanelNote('');
    }
    return true;
  }

  function savePin(id: string, name: string, text: string) {
    const cur = pinnedRef.current.find((p) => p.id === id);
    if (!cur) return;
    const next = replacePinned(cur, name, text, 'self', new Date().toISOString());
    updatePinned(pinnedRef.current.map((p) => (p.id === id ? next : p)));
    if (next.text !== cur.text) logPin('書き換え（本人）', next);
  }

  function deletePin(id: string) {
    const cur = pinnedRef.current.find((p) => p.id === id);
    if (!cur || !window.confirm(`コンテキスト「${cur.name}」を消しますか（前の版も消えます）。`)) return;
    updatePinned(pinnedRef.current.filter((p) => p.id !== id));
    setProposals((prev) => prev.map((x) => (x.id === id && x.status === 'pending' ? { ...x, status: 'dismissed' } : x)));
    logPin('削除', cur);
  }

  function restorePin(id: string, index: number) {
    const cur = pinnedRef.current.find((p) => p.id === id);
    if (!cur) return;
    const next = restorePinned(cur, index, new Date().toISOString());
    updatePinned(pinnedRef.current.map((p) => (p.id === id ? next : p)));
    logPin('前の版に戻す', next);
  }

  function applyProposal(key: string) {
    const x = proposals.find((y) => y.key === key);
    if (!x || x.status !== 'pending') return;
    if (x.id) {
      const cur = pinnedRef.current.find((p) => p.id === x.id);
      if (!cur) return;
      const next = replacePinned(cur, x.name, x.text, 'ai', new Date().toISOString());
      updatePinned(pinnedRef.current.map((p) => (p.id === x.id ? next : p)));
      logPin('置き換え（AIの案）', next);
    } else if (!addPin(x.name, x.text, 'ai')) {
      return;
    }
    setProposals((prev) => prev.map((y) => (y.key === key ? { ...y, status: 'applied' } : y)));
    setDiffKey(null);
  }

  function dismissProposal(key: string) {
    setProposals((prev) => prev.map((y) => (y.key === key && y.status === 'pending' ? { ...y, status: 'dismissed' } : y)));
    setDiffKey(null);
  }

  // 読んだ資料（持ち越し）を外す・コンテキストに固定する
  function removeRead(path: string) {
    updateContext({ ...contextRef.current, reads: contextRef.current.reads.filter((p) => p !== path) });
  }
  function removeText(name: string) {
    updateContext({ ...contextRef.current, texts: contextRef.current.texts.filter((t) => t.name !== name) });
  }
  function pinText(name: string) {
    const t = contextRef.current.texts.find((x) => x.name === name);
    if (!t) return;
    const fits = t.text.trim().length <= PIN_MAX_TEXT && pinnedTotal(pinnedRef.current) + t.text.trim().length <= PIN_TOTAL_CHARS;
    if (fits && addPin(name.replace(/\.[a-z0-9]{1,5}$/i, ''), t.text)) removeText(name);
    else if (!fits) {
      setPinDraft({ name: name.replace(/\.[a-z0-9]{1,5}$/i, ''), text: t.text });
      setPanelNote('長いので、そのままでは固定できません。要るところだけに縮めてから「追加する」を押してください。');
    }
  }

  // 回答をコンテキストに入れる（入力欄に入れて開く。直してから「追加する」）
  function pinAnswer(m: Msg) {
    setPinDraft({ name: guessPinName(m.content), text: m.content });
    setPanelNote('');
    setPanelOpen(true);
  }

  // 会話をファイルに書き出す（会話・コンテキスト・読んだ資料の文字。PDF・画像は入らない）
  function exportConversation() {
    const at = new Date();
    const saved = buildSaved({
      conversationId: ensureConvoId(),
      messages,
      pinned: pinnedRef.current,
      pinUsed: pinUsedRef.current,
      carry: contextRef.current,
      savedAt: at.toISOString(),
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = savedFileName(saved.title, at);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setPanelNote(`「${a.download}」を書き出しました（ダウンロードのフォルダ）。「ファイルから再開」で続きから使えます。`);
  }

  // 書き出したファイルから再開する（同じ会話番号の続きとして会話ログに残る）
  async function importConversation(file: File) {
    if (busy) return;
    if (file.size > SAVE_MAX_BYTES) { setPanelNote('ファイルが大きすぎます。'); return; }
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setPanelNote('ファイルを読めませんでした。智翔館AIで書き出した .json のファイルを選んでください。');
      return;
    }
    const r = parseSaved(raw);
    if (!r.ok) { setPanelNote(r.message); return; }
    if ((messages.length || pinnedRef.current.length) && !window.confirm('いまの会話とコンテキストは消えて、ファイルの会話に入れ替わります。よろしいですか。')) return;
    await saveNow();
    applySaved(r.value, `「${r.value.title}」を読み込みました。続きから質問できます。`);
  }

  /** 書き出したファイル・保存した会話の中身を画面に戻す（同じ会話番号の続きになる）。 */
  function applySaved(v: SavedConversation, note: string) {
    const pins = normalizePinnedList(v.pinned);
    messagesRef.current = v.messages as Msg[];
    setMessages(v.messages as Msg[]);
    convoIdRef.current = v.conversationId || newConversationId();
    updateContext(normalizeContext(v.carry));
    updatePinned(pins);
    pinUsedRef.current = Math.max(v.pinUsed, nextPinId(pins).used - 1);
    setProposals([]);
    setPinDraft(null);
    setTask(null);
    setFeedbackDraft(null);
    setTooLarge(false);
    setResetAsk(false);
    setPanelOpen(false);
    setPanelNote(note);
  }

  // --- 保存した会話・履歴（ログインしたときだけ） ---
  async function openSaved(id: string) {
    if (busy || id === convoIdRef.current) return;
    if (!messages.some((m) => m.role === 'user') && pinnedRef.current.length && !window.confirm('いまのコンテキストは消えて、選んだ会話に入れ替わります。よろしいですか。')) return;
    const res = await fetch(`/api/chishokan-ai/conversations?id=${encodeURIComponent(id)}`, { cache: 'no-store' }).catch(() => null);
    const j = res ? await res.json().catch(() => null) : null;
    if (!j?.ok) { setPanelNote(j?.message ?? '会話を開けませんでした。もう一度お試しください。'); return; }
    const r = parseSaved(j.data);
    if (!r.ok) { setPanelNote(r.message); return; }
    await saveNow();
    applySaved({ ...r.value, conversationId: id }, `「${j.title || r.value.title}」を開きました。続きから質問できます。`);
  }

  async function saveConvo(title: string) {
    const ok = await saveNow();
    const id = convoIdRef.current;
    if (!ok || !id) { setPanelNote('まだ保存できません。質問を1つ送ってから、もう一度押してください。'); return; }
    const res = await fetch('/api/chishokan-ai/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', id, title }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => null) : null;
    if (!j?.ok) { setPanelNote(j?.message ?? '保存できませんでした。もう一度お試しください。'); return; }
    const cur = savedRef.current;
    if (cur) {
      const row = cur.history.find((r) => r.id === id) ?? cur.saved.find((r) => r.id === id);
      if (row) {
        const next: ConvoRow = { ...row, kind: '保存', title: title || row.title, updatedAt: new Date().toISOString() };
        updateSaved({ ...cur, saved: [next, ...cur.saved.filter((r) => r.id !== id)], history: cur.history.filter((r) => r.id !== id) });
      }
    }
    setPanelNote(`「${title || 'この会話'}」を保存しました。`);
  }

  async function unsaveConvo(id: string) {
    const res = await fetch('/api/chishokan-ai/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unsave', id }),
    }).catch(() => null);
    if (!res?.ok) { setPanelNote('外せませんでした。もう一度お試しください。'); return; }
    const cur = savedRef.current;
    const row = cur?.saved.find((r) => r.id === id);
    if (cur && row) updateSaved({ ...cur, saved: cur.saved.filter((r) => r.id !== id), history: [{ ...row, kind: '履歴' }, ...cur.history] });
  }

  async function deleteConvo(id: string) {
    const cur = savedRef.current;
    const row = cur && [...cur.saved, ...cur.history].find((r) => r.id === id);
    if (!row || !window.confirm(`「${row.title || 'この会話'}」を消しますか（元に戻せません。会話ログは消えません）。`)) return;
    const res = await fetch(`/api/chishokan-ai/conversations?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) { setPanelNote('消せませんでした。もう一度お試しください。'); return; }
    const now = savedRef.current;
    if (now) updateSaved({ ...now, saved: now.saved.filter((r) => r.id !== id), history: now.history.filter((r) => r.id !== id) });
    // 開いている会話を消したら、画面も新しい相談にする（続けて質問すると、また履歴に入ってしまうため）
    if (id === convoIdRef.current) clearConversation(false, true);
  }

  // --- いつものコンテキスト ---
  function addAutoPresets(presets: Preset[]) {
    for (const x of presets) {
      // 自動で入れた分は会話ログに1行ずつ残さない（質問のたびの記録に、入っているコンテキストの名前が出る）
      if (x.auto && !pinnedRef.current.some((q) => q.text === x.text)) addPin(x.name, x.text, 'added', true);
    }
  }

  async function putPresetReq(body: Record<string, unknown>): Promise<Preset | null> {
    const res = await fetch('/api/chishokan-ai/presets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const j = res ? await res.json().catch(() => null) : null;
    if (!j?.ok) { setPanelNote(j?.message ?? '登録できませんでした。もう一度お試しください。'); return null; }
    return j.item as Preset;
  }

  async function presetFromPin(pin: Pinned) {
    const cur = savedRef.current;
    if (cur?.presets.some((x) => x.text === pin.text)) { setPanelNote(`「${pin.name}」は、もういつものコンテキストに入っています。`); return; }
    const item = await putPresetReq({ name: pin.name, text: pin.text });
    if (!item) return;
    const now = savedRef.current;
    if (now) updateSaved({ ...now, presets: [...now.presets, item] });
    setPanelNote(`「${pin.name}」を、いつものコンテキストに登録しました。ほかの会話でも「この会話に入れる」で使えます。`);
  }

  function presetUse(id: string) {
    const x = savedRef.current?.presets.find((p) => p.id === id);
    if (x) addPin(x.name, x.text);
  }

  async function presetAuto(id: string, auto: boolean) {
    const cur = savedRef.current;
    const x = cur?.presets.find((p) => p.id === id);
    if (!cur || !x) return;
    // 先に画面を変え、保存できなかったら戻す
    const set = (v: boolean) => {
      const now = savedRef.current;
      if (now) updateSaved({ ...now, presets: now.presets.map((p) => (p.id === id ? { ...p, auto: v } : p)) });
    };
    set(auto);
    if (!(await putPresetReq({ id, name: x.name, text: x.text, auto }))) set(!auto);
  }

  async function presetDelete(id: string) {
    const x = savedRef.current?.presets.find((p) => p.id === id);
    if (!x || !window.confirm(`いつものコンテキスト「${x.name}」を消しますか（いまの会話に入っている分は残ります）。`)) return;
    const res = await fetch(`/api/chishokan-ai/presets?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) { setPanelNote('消せませんでした。もう一度お試しください。'); return; }
    const now = savedRef.current;
    if (now) updateSaved({ ...now, presets: now.presets.filter((p) => p.id !== id) });
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
          pinned: pinnedRef.current.map(({ id, name, text }) => ({ id, name, text })),
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
          else if (ev.t === 'pin') {
            // AI の直し案。同じ項目の前の案は捨て、この回答の下と右の欄に出す（押すまで変わらない）
            const key = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            const base = pinnedRef.current.find((p) => p.id === ev.id)?.text ?? '';
            const view: PinProposalView = { key, id: ev.id, name: ev.name, text: ev.text, summary: ev.summary, base, status: 'pending' };
            setProposals((prev) => [...prev.map((x) => (ev.id && x.id === ev.id && x.status === 'pending' ? { ...x, status: 'dismissed' as const } : x)), view]);
            draft = { ...draft, pins: [...(draft.pins ?? []), key] };
          }
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
    ensureConvoId();
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

  // 新しい相談：コンテキストがあれば、残すか消すかを聞く
  function reset() {
    if (pinnedRef.current.length) { setResetAsk(true); return; }
    clearConversation(false);
  }

  /** 画面を新しい相談にする。keepPins ならコンテキストは残す。前の会話は（ログインしていれば）履歴に残る。 */
  async function clearConversation(keepPins: boolean, skipSave = false) {
    if (!skipSave) await saveNow();
    messagesRef.current = [];
    setMessages([]);
    convoIdRef.current = '';
    updateContext(EMPTY_CONTEXT);
    if (!keepPins) {
      updatePinned([]);
      pinUsedRef.current = 0;
    }
    setProposals([]);
    setPinDraft(null);
    setPanelNote('');
    setTask(null);
    setFeedbackDraft(null);
    setTooLarge(false);
    setResetAsk(false);
    if (savedRef.current?.enabled) addAutoPresets(savedRef.current.presets);
  }

  // 会話が長くなったとき：要点をコンテキストの新しい項目の案にまとめてもらう（押すまで変わらない）
  async function summarize() {
    if (busy) return;
    ensureConvoId();
    const base: Msg[] = [...messages, { role: 'user', content: '📌 この会話の要点を、コンテキストにまとめて', api: SUMMARY_PROMPT }];
    const turn = base.filter((m) => m.role === 'user').length;
    const start: Msg = { role: 'assistant', content: '', turn };
    setMessages([...base, start]);
    await run(toApi(base), base.length, { start });
  }

  // 要望の小窓を開く。会話の途中なら、会話の番号と選んでいた作業を添える。
  const [request, setRequest] = useState<{ conversationId?: string; turn?: number; task?: string } | null>(null);
  function openRequest() {
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    setRequest({ conversationId: convoIdRef.current || undefined, turn: last?.turn, task: last?.taskLabel ?? task?.button });
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

  const panelLabel = `📌 コンテキスト ${pinned.length}${carried ? `・資料 ${carried}` : ''}`;
  const pendingCount = proposals.filter((x) => x.status === 'pending').length;
  const diffProposal = diffKey ? proposals.find((x) => x.key === diffKey) : undefined;

  return (
    <div className="iqa-page ai-has-panel">
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
              <li>右の欄の「コンテキスト」に置いた文は、質問のたびにAIに渡します（担当・決まり・前の回答など、会話の前提を置く）</li>
              <li>会話は、この画面を閉じると消えます。残すときは、右の欄の「ファイルに書き出す」。改善のため、質問と回答は社内の記録（会話ログ）に残しています</li>
              <li>生徒・保護者の名前や成績は入れないでください</li>
              <li>試用期間中です。うまく動かないときは「不具合を報告」、こうしてほしいときは「要望を送る」から送ってください</li>
            </ul>
          </details>
          <button type="button" className="ai-report-open ai-panel-toggle" onClick={() => setPanelOpen(true)}>
            {panelLabel}{pendingCount ? '・直し案あり' : ''}
          </button>
          <button type="button" className="ai-report-open" onClick={() => openReport()}>
            ⚠ 不具合を報告
          </button>
          <button type="button" className="ai-report-open ai-request-open" onClick={openRequest}>
            💡 要望を送る
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
          {resetAsk ? (
            <span className="ai-reset-ask">
              コンテキスト（{pinned.length}件）は？
              <button type="button" className="msg-action" onClick={() => clearConversation(true)}>残して始める</button>
              <button type="button" className="msg-action ai-pin-del" onClick={() => clearConversation(false)}>消して始める</button>
              <button type="button" className="msg-action" onClick={() => setResetAsk(false)}>やめる</button>
            </span>
          ) : (
            <button className="yq-toggle" onClick={reset} disabled={busy}>
              新しい相談を始める{saved?.enabled ? '' : '（会話を消す）'}
            </button>
          )}
          {carried > 0 && (
            <span className="ai-carry-note" title={[...context.reads, ...context.texts.map((t) => t.name)].join('\n')}>
              この会話で読んだ資料 {carried} 件を、次の質問でもAIに渡します
            </span>
          )}
          {/* 会話が長くなって画面の上の説明が見えなくなっても押せるように、この帯（上に固定）にも置く */}
          <span className="ai-convo-actions">
            <button type="button" className="ai-report-open ai-panel-toggle" onClick={() => setPanelOpen(true)}>
              {panelLabel}{pendingCount ? '・直し案あり' : ''}
            </button>
            <button type="button" className="ai-report-open" onClick={() => openReport()}>⚠ 不具合を報告</button>
            <button type="button" className="ai-report-open ai-request-open" onClick={openRequest}>💡 要望を送る</button>
          </span>
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
                  {m.pins?.map((k) => {
                    const x = proposals.find((y) => y.key === k);
                    if (!x) return null;
                    return (
                      <div key={k} className="ai-pin-card">
                        <span>📌 {x.id ? `コンテキスト ${x.id}「${x.name}」の直し案` : `コンテキストの新しい項目の案「${x.name}」`}</span>
                        {x.status === 'pending' ? (
                          <button type="button" className="msg-action" onClick={() => setDiffKey(k)}>{x.id ? '見比べて置き換える' : '見て追加する'}</button>
                        ) : (
                          <span className="ai-pin-card-done">{x.status === 'applied' ? (x.id ? '置き換えました' : '追加しました') : '使いませんでした'}</span>
                        )}
                      </div>
                    );
                  })}
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
                      <button type="button" className="msg-action" title="この回答を、会話の前提として右の欄に置く" onClick={() => pinAnswer(m)}>
                        📌 コンテキストに入れる
                      </button>
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
          {(tooLarge || messages.reduce((n, m) => n + m.content.length, 0) >= LONG_CONVERSATION_CHARS) && !busy && (
            <div className="ai-long-note">
              <span>
                {tooLarge ? '会話が長くなりすぎて、これ以上は保存できません。' : '会話が長くなりました。毎回すべてをAIに送るため、回答が遅くなり、費用も増えます。'}
                要点をコンテキストにまとめて、新しい相談で続けるのがおすすめです。
              </span>
              <button type="button" className="msg-action" onClick={summarize}>📌 要点をまとめる</button>
            </div>
          )}
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
      <AiContextPanel
        pinned={pinned}
        proposals={proposals}
        carry={context}
        draft={pinDraft}
        setDraft={setPinDraft}
        onAdd={(name, text) => { if (addPin(name, text)) setPinDraft(null); }}
        onSave={savePin}
        onDelete={deletePin}
        onRestore={restorePin}
        onOpenProposal={setDiffKey}
        onRemoveRead={removeRead}
        onRemoveText={removeText}
        onPinText={pinText}
        readLabel={(path) => sourceLabel({ kind: 'knowledge', path })}
        onExport={exportConversation}
        onImport={importConversation}
        canExport={!busy && (messages.length > 0 || pinned.length > 0)}
        note={panelNote}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        saved={saved}
        savedActions={{
          currentId: convoIdRef.current,
          canSave: !busy && messages.some((m) => m.role === 'user'),
          onOpen: openSaved,
          onSave: saveConvo,
          onUnsave: unsaveConvo,
          onDelete: deleteConvo,
          onPresetFromPin: presetFromPin,
          onPresetUse: presetUse,
          onPresetAuto: presetAuto,
          onPresetDelete: presetDelete,
          defaultTitle: conversationTitle(messages).replace(/…$/, ''),
          busy,
        }}
      />
      {diffProposal && (
        <AiContextDiffDialog
          proposal={diffProposal}
          current={diffProposal.id ? pinned.find((p) => p.id === diffProposal.id) : undefined}
          count={pinned.length}
          total={pinnedTotal(pinned)}
          onApply={() => applyProposal(diffProposal.key)}
          onDismiss={() => dismissProposal(diffProposal.key)}
          onClose={() => setDiffKey(null)}
        />
      )}
      {report && <AiReportDialog context={report.context} initialKind={report.kind} onClose={() => setReport(null)} />}
      {request && <AiRequestDialog context={request} onClose={() => setRequest(null)} />}
    </div>
  );
}
