'use client';

// 全体研修会アンケート（/kenshu）。2つの質問に、やりたいことを1行に1つずつ、いくつでも書く。
// ・Enter で次の行へ（日本語の変換を確定する Enter では動かない）。末尾にはいつも空の行を1つ置く
// ・箇条書きをまとめて貼り付けると1行ずつに分ける（lib/kenshu/survey.ts の splitLines）
// ・書きかけはこの端末（localStorage）に残し、提出したら消す。提出はサーバ（/api/kenshu）へ
// ・提出後に開くと「わたしのやりたいことリスト」を出し、［内容を直す］から出し直せる（上書き）

import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import {
  cheer, MAX_ITEM_LENGTH, MAX_ITEMS, MIN_ROWS, QUESTIONS, splitLines, SURVEY, type Question, type QuestionKey,
} from '@/lib/kenshu/survey';

type Item = { id: string; text: string };
type Lists = Record<QuestionKey, Item[]>;
type Answer = { work: string[]; life: string[]; submittedAt: string; updatedAt: string };
type Update = (fn: (list: Item[]) => Item[]) => void;

// サーバでの描画時に useLayoutEffect の警告を出さないため
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

let seq = 0;
const blank = (): Item => ({ id: `k${++seq}`, text: '' });
const textsOf = (list: Item[]) => list.map((it) => it.text.trim()).filter(Boolean);

// いつも末尾に空の行を1つ置き（書き足しやすくするため）、少ないうちは MIN_ROWS 行までそろえる。
// 上限まで書いたら足さない。
function normalize(list: Item[]): Item[] {
  const out = list.length ? [...list] : [blank()];
  if (out[out.length - 1].text.trim() && out.length < MAX_ITEMS) out.push(blank());
  while (out.length < MIN_ROWS) out.push(blank());
  return out;
}
const fromTexts = (texts: string[]): Item[] => normalize(texts.map((text) => ({ id: `k${++seq}`, text })));
const emptyLists = (): Lists => ({ work: normalize([]), life: normalize([]) });

// ---- 書きかけ（この端末だけ） ------------------------------------------------
type Draft = { work: string[]; life: string[] };
function readDraft(key: string): Draft | null {
  try {
    const j = JSON.parse(localStorage.getItem(key) || 'null');
    if (j && Array.isArray(j.work) && Array.isArray(j.life)) return j as Draft;
  } catch { /* 保存が使えない環境でも動く */ }
  return null;
}
function writeDraft(key: string, d: Draft) { try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* 無視 */ } }
function clearDraft(key: string) { try { localStorage.removeItem(key); } catch { /* 無視 */ } }

const REASONS: Record<string, string> = {
  not_configured: '保存先（スプレッドシート連携）が未設定です。管理部門に伝えてください。書いた内容はこの端末に残っています。',
  network_error: '通信できませんでした。電波のよい場所で、もう一度［提出する］を押してください。書いた内容はこの端末に残っています。',
  upstream_error: 'スプレッドシートに保存できませんでした。少し待ってから、もう一度［提出する］を押してください。',
  empty: '仕事と人生・プライベートを、それぞれ1つ以上書いてください。',
  unauthorized: 'ログインが切れました。ページを開き直して、もう一度ログインしてください。',
};
const reasonText = (r: string) => REASONS[r] ?? `保存できませんでした（理由：${r}）。もう一度お試しください。`;

// ---- 1行 -----------------------------------------------------------------
function ItemRow({ it, no, placeholder, onChange, onKeyDown, onPaste, onDelete, setRef }: {
  it: Item; no: number; placeholder: string;
  onChange: (text: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onDelete: () => void;
  setRef: (el: HTMLTextAreaElement | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const isBlank = !it.text.trim();
  // 1行に収まらない長さになったら高さを広げる（例文が変わったときも測り直す）
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [it.text, placeholder]);
  return (
    <li className={`ks-item ${isBlank ? 'blank' : ''}`}>
      <span className="ks-item-no" aria-hidden="true">{no}</span>
      <textarea
        rows={1} value={it.text} placeholder={placeholder} maxLength={MAX_ITEM_LENGTH} aria-label={`${no}つ目`}
        ref={(el) => { ref.current = el; setRef(el); }}
        onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ' '))}
        onKeyDown={onKeyDown} onPaste={onPaste}
      />
      {isBlank ? <span /> : (
        <button type="button" className="ks-item-del" aria-label={`${no}つ目を消す`} onClick={onDelete}>×</button>
      )}
    </li>
  );
}

// ---- 質問1つ ---------------------------------------------------------------
function QuestionCard({ q, no, items, update }: { q: Question; no: number; items: Item[]; update: Update }) {
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [focusId, setFocusId] = useState('');
  useEffect(() => {
    if (!focusId) return;
    const el = refs.current[focusId];
    if (el) { el.focus(); const n = el.value.length; el.setSelectionRange(n, n); }
    setFocusId('');
  }, [focusId, items]);
  const count = textsOf(items).length;

  const onKeyDown = (i: number, it: Item) => (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 日本語の変換中は確定に使う
      e.preventDefault();
      if (!it.text.trim()) return;
      const next = items[i + 1];
      if (next && !next.text.trim()) { setFocusId(next.id); return; }
      if (items.length >= MAX_ITEMS) return;
      const b = blank();
      update((list) => { const l = [...list]; l.splice(i + 1, 0, b); return l; });
      setFocusId(b.id);
    } else if (e.key === 'Backspace' && !it.text && i > 0) {
      e.preventDefault();
      const prev = items[i - 1];
      update((list) => list.filter((x) => x.id !== it.id));
      setFocusId(prev.id);
    }
  };
  const onPaste = (i: number, it: Item) => (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/\n/.test(text)) return;
    e.preventDefault();
    const lines = splitLines(text).map((l) => l.slice(0, MAX_ITEM_LENGTH));
    if (!lines.length) return;
    const head = `${it.text}${lines[0]}`.slice(0, MAX_ITEM_LENGTH);
    const rest = lines.slice(1, Math.max(1, MAX_ITEMS - items.length + 1)).map((t) => ({ ...blank(), text: t }));
    update((list) => {
      const l = list.map((x) => (x.id === it.id ? { ...x, text: head } : x));
      l.splice(i + 1, 0, ...rest);
      return l.slice(0, MAX_ITEMS);
    });
    setFocusId(rest.length ? rest[rest.length - 1].id : it.id);
  };

  return (
    <section className={`ks-q ks-q-${q.key}`} aria-labelledby={`ks-qt-${q.key}`}>
      <div className="ks-q-head">
        <span className="ks-q-no" aria-hidden="true">{no}</span>
        <span className="ks-q-tag">{q.tag}</span>
        <span className="ks-q-count" aria-label={`${count}個`}>{count}個</span>
        <h2 className="ks-q-title" id={`ks-qt-${q.key}`}>{q.title}</h2>
      </div>
      <p className="ks-q-sub">{q.sub}</p>
      <ol className="ks-items">
        {items.map((it, i) => (
          <ItemRow
            key={it.id} it={it} no={i + 1}
            placeholder={it.text.trim() ? '' : (q.placeholders[i] || '思いついたことを1つ')}
            setRef={(el) => { refs.current[it.id] = el; }}
            onChange={(text) => update((list) => list.map((x) => (x.id === it.id ? { ...x, text } : x)))}
            onKeyDown={onKeyDown(i, it)} onPaste={onPaste(i, it)}
            onDelete={() => update((list) => list.filter((x) => x.id !== it.id))}
          />
        ))}
      </ol>
      <div className="ks-q-foot">
        <p className="ks-cheer" aria-live="polite">{cheer(count)}</p>
        <span className="ks-keys"><kbd>Enter</kbd> で次の行へ。まとめて貼り付けると1行ずつに分かれます</span>
      </div>
      <details className="ks-hints">
        <summary>思いつかないときは</summary>
        <ul>{q.hints.map((h) => <li key={h}>{h}</li>)}</ul>
      </details>
    </section>
  );
}

// ---- 提出後のリスト ----------------------------------------------------------
function DoneView({ answer, onEdit }: { answer: Answer; onEdit: () => void }) {
  const total = answer.work.length + answer.life.length;
  return (
    <div className="ks">
      <div className="ks-done-msg" role="status">
        <span className="ks-eyebrow">
          提出しました（{answer.submittedAt}{answer.updatedAt ? `／最終更新 ${answer.updatedAt}` : ''}）
        </span>
        <h1>ありがとうございました。{SURVEY.eventShort}でお会いしましょう</h1>
        <p>当日はこのリストをもとに、グループで「この1年」を話し合います。研修会の当日まで、何度でも直せます。</p>
      </div>
      <article className="ks-list" aria-label="わたしのやりたいことリスト">
        <header className="ks-list-head">
          <span className="ks-list-period">{SURVEY.periodShort}</span>
          <h2>わたしのやりたいことリスト</h2>
          <span className="ks-list-total">
            あわせて<b>{total}</b>個（仕事 {answer.work.length}個・人生・プライベート {answer.life.length}個）
          </span>
        </header>
        <div className="ks-list-cols">
          {QUESTIONS.map((q) => (
            <section key={q.key} className={`ks-list-col ks-q-${q.key}`}>
              <h3>{q.tag}<span>{answer[q.key].length}個</span></h3>
              <ol>{answer[q.key].map((t, i) => <li key={i}>{t}</li>)}</ol>
            </section>
          ))}
        </div>
      </article>
      <div className="ks-done-actions">
        <button type="button" className="ks-btn ks-ghost" onClick={onEdit}>内容を直す</button>
      </div>
    </div>
  );
}

// ---- 画面全体 --------------------------------------------------------------
export default function KenshuSurveyUI({ name, campus }: { name: string; campus: string }) {
  const draftKey = `kenshu:${SURVEY.id}:${campus}:${name}`;
  const [phase, setPhase] = useState<'loading' | 'edit' | 'done'>('loading');
  const [lists, setLists] = useState<Lists>(emptyLists);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const touched = useRef(false);

  // 開いたとき：提出済みの回答と、この端末の書きかけを読む。書きかけがあればそちらを優先する。
  useEffect(() => {
    let alive = true;
    (async () => {
      const draft = readDraft(draftKey);
      let loaded: Answer | null = null;
      let failed = '';
      try {
        const res = await fetch('/api/kenshu', { cache: 'no-store' });
        const j = await res.json().catch(() => null);
        if (j?.ok) loaded = j.answer ?? null;
        else failed = j?.reason || 'upstream_error';
      } catch {
        failed = 'network_error';
      }
      if (!alive) return;
      setAnswer(loaded);
      if (draft) {
        setLists({ work: fromTexts(draft.work), life: fromTexts(draft.life) });
        setNotice(loaded
          ? 'まだ提出していない書きかけを表示しています。直し終えたら［提出し直す］を押してください。'
          : 'この端末に残っていた書きかけを表示しています。');
        setPhase('edit');
      } else if (loaded) {
        setLists({ work: fromTexts(loaded.work), life: fromTexts(loaded.life) });
        setPhase('done');
      } else {
        setPhase('edit');
      }
      if (failed && failed !== 'not_configured') {
        setNotice('これまでの回答を読み込めませんでした。提出済みの方は、少し待ってからページを開き直してください。');
      }
    })();
    return () => { alive = false; };
  }, [draftKey]);

  // 書いたら、この端末に書きかけを残す（提出したら消す）
  useEffect(() => {
    if (phase !== 'edit' || !touched.current) return;
    writeDraft(draftKey, { work: textsOf(lists.work), life: textsOf(lists.life) });
  }, [lists, phase, draftKey]);

  const update = (key: QuestionKey): Update => (fn) => {
    touched.current = true;
    setError('');
    setLists((p) => ({ ...p, [key]: normalize(fn(p[key])) }));
  };

  const work = textsOf(lists.work);
  const life = textsOf(lists.life);
  const ok = work.length > 0 && life.length > 0;

  async function submit() {
    if (!ok || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/kenshu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work, life }),
      });
      const j = await res.json().catch(() => null);
      if (j?.ok && j.answer) {
        clearDraft(draftKey);
        touched.current = false;
        setAnswer(j.answer);
        setLists({ work: fromTexts(j.answer.work), life: fromTexts(j.answer.life) });
        setNotice('');
        setPhase('done');
        window.scrollTo({ top: 0 });
      } else {
        setError(reasonText(j?.reason || 'upstream_error'));
      }
    } catch {
      setError(reasonText('network_error'));
    } finally {
      setSaving(false);
    }
  }

  // 提出済みの内容に戻す（書きかけは消す）
  function cancelEdit() {
    if (!answer) return;
    clearDraft(draftKey);
    touched.current = false;
    setLists({ work: fromTexts(answer.work), life: fromTexts(answer.life) });
    setNotice('');
    setError('');
    setPhase('done');
    window.scrollTo({ top: 0 });
  }

  if (phase === 'loading') return <div className="ks"><p className="ks-loading">読み込み中…</p></div>;
  if (phase === 'done' && answer) {
    return <DoneView answer={answer} onEdit={() => { setPhase('edit'); window.scrollTo({ top: 0 }); }} />;
  }

  const msg = ok
    ? (answer ? '提出し直すと、前の回答に上書きされます' : `提出後も${SURVEY.eventShort}の当日まで直せます`)
    : (work.length === 0 ? '1の仕事を1つ以上書いてください' : '2の人生・プライベートを1つ以上書いてください');

  return (
    <>
      <div className="ks ks-edit">
        <div className="ks-intro">
          <span className="ks-eyebrow">{SURVEY.event}</span>
          <h1>この1年でやりたいことを、思いつくまま書き出しましょう</h1>
          <p>質問は2つだけです。正解はありません。数も形も自由です。研修会の当日は、このリストをもとにグループで話し合います。</p>
          <div className="ks-intro-meta">
            <span>対象の期間：<b>{SURVEY.period}</b></span>
            <span>所要時間：<b>約5〜10分</b></span>
            <span>回答：<b>研修会の当日まで</b></span>
          </div>
          {answer && (
            <p className="ks-status">
              提出済みです（{answer.updatedAt || answer.submittedAt}）。直したら下の［提出し直す］を押してください。
              <button type="button" className="ks-link" onClick={cancelEdit}>直すのをやめる</button>
            </p>
          )}
          {notice && <p className="ks-notice">{notice}</p>}
        </div>
        {QUESTIONS.map((q, i) => (
          <QuestionCard key={q.key} q={q} no={i + 1} items={lists[q.key]} update={update(q.key)} />
        ))}
      </div>
      <footer className="ks-bar">
        <div className="ks-bar-in">
          <div className="ks-tally" role="status">
            <span className="w">仕事 <b>{work.length}</b>個</span>
            <span className="l">人生・プライベート <b>{life.length}</b>個</span>
            <span className="ks-tally-msg">{msg}</span>
          </div>
          <button type="button" className="ks-btn ks-primary" disabled={!ok || saving} onClick={submit}>
            {saving ? '送信中…' : answer ? '提出し直す' : '提出する'}
          </button>
          {error && <p className="ks-error" role="alert">{error}</p>}
        </div>
      </footer>
    </>
  );
}
