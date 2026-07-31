'use client';

import { useEffect, useRef, useState } from 'react';
import { sanitizeHistory, stripRoleBleed } from '@/lib/sanitize';
import {
  CONSULT_TEMPLATES,
  buildFormMessage,
  findTemplate,
  templatesByCategory,
} from '@/lib/consultTemplates';

type Msg = { role: 'user' | 'assistant'; content: string };

const STORE_PREFIX = 'chishokan_consult_v1';

type Saved = { templateId: string; values: Record<string, string>; messages: Msg[] };

export default function ConsultUI({ name, campus }: { name: string; campus: string }) {
  // templateId が null なら業務の一覧、messages が空ならフォーム、あれば結果画面。
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const endRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const sendingRef = useRef(false);
  const storeKey = `${STORE_PREFIX}:${campus}/${name}`;

  const template = templateId ? findTemplate(templateId) : undefined;

  // 同じ端末・ブラウザで中断→再開できるよう、作業中の内容を localStorage に保存する。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const s: Saved = JSON.parse(raw);
        if (s && typeof s.templateId === 'string' && findTemplate(s.templateId)) {
          setTemplateId(s.templateId);
          setValues(s.values && typeof s.values === 'object' ? s.values : {});
          const clean = sanitizeHistory(Array.isArray(s.messages) ? s.messages : []) as Msg[];
          setMessages(clean);
          if (clean.length) setRestored(true);
        }
      }
    } catch {
      // 読み込み失敗は無視して新規開始
    }
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      if (templateId) localStorage.setItem(storeKey, JSON.stringify({ templateId, values, messages }));
      else localStorage.removeItem(storeKey);
    } catch {
      // 保存失敗は本処理を止めない
    }
  }, [templateId, values, messages, storeKey]);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function pickTemplate(id: string) {
    setTemplateId(id);
    setValues({});
    setMessages([]);
    setInput('');
    setMissing([]);
    setRestored(false);
  }

  function backToList() {
    if (busy) return;
    if (messages.length && !confirm('作成中の内容を破棄して業務の選択に戻りますか？')) return;
    setTemplateId(null);
    setValues({});
    setMessages([]);
    setInput('');
    setMissing([]);
    setRestored(false);
    try {
      localStorage.removeItem(storeKey);
    } catch {}
  }

  function backToForm() {
    if (busy) return;
    if (!confirm('入力内容を編集し直しますか？（作成された原稿は消えます）')) return;
    setMessages([]);
    setInput('');
    setRestored(false);
  }

  // 1ターン送信。next には送信後の履歴（末尾が user）を渡す。
  async function send(next: Msg[]) {
    if (!templateId || sendingRef.current) return;
    sendingRef.current = true;
    setMessages([...next, { role: 'assistant', content: '' }]);
    setBusy(true);
    try {
      const res = await fetch('/api/consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, messages: next }),
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

  // フォーム → 生成（1ターン目）。必須の未記入だけ止め、任意は空のまま通す。
  function onGenerate() {
    if (!template || busy) return;
    const lack = template.fields
      .filter((f) => f.required && !(values[f.key] ?? '').trim())
      .map((f) => f.label);
    setMissing(lack);
    if (lack.length) return;
    void send([{ role: 'user', content: buildFormMessage(template, values) }]);
  }

  // 結果画面 → 修正指示（2ターン目以降）。
  function onRevise() {
    const t = input.trim();
    if (!t || busy) return;
    setInput('');
    void send([...messages, { role: 'user', content: t }]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onRevise();
    }
  }

  function copyMsg(i: number, content: string) {
    try {
      navigator.clipboard?.writeText(content);
    } catch {}
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1800);
  }

  // ── 業務の一覧 ────────────────────────────────────────────
  if (!template) {
    return (
      <>
        <div className="page-head">
          <h1>相談AI</h1>
          <p>作りたい文書を選び、条件を記入すると原稿を作成します。作成後は対話で直せます。</p>
        </div>
        <div className="consult-body">
          {templatesByCategory().map((g) => (
            <section key={g.category} className="tpl-group">
              <h2 className="tpl-cat">{g.category}</h2>
              <div className="tpl-grid">
                {g.items.map((t) => (
                  <button key={t.id} className="tpl-card" onClick={() => pickTemplate(t.id)}>
                    <span className="tpl-title">{t.title}</span>
                    <span className="tpl-desc">{t.desc}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          <p className="tpl-note">
            まず {CONSULT_TEMPLATES.length} 業務で運用します。使いながら型を固め、対応業務を増やしていきます。
          </p>
        </div>
      </>
    );
  }

  // ── フォーム ─────────────────────────────────────────────
  if (messages.length === 0) {
    return (
      <>
        <div className="page-head">
          <h1>{template.title}</h1>
          <p>{template.desc}</p>
          <button className="reset-chat" onClick={backToList} disabled={busy}>
            業務の選択に戻る
          </button>
        </div>
        <div className="consult-body">
          <div className="consult-form">
            {template.fields.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`f-${f.key}`}>
                  {f.label}
                  {f.required && <span className="req">必須</span>}
                </label>
                {f.type === 'textarea' ? (
                  <textarea
                    id={`f-${f.key}`}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    rows={f.key === 'reference' ? 6 : 3}
                  />
                ) : f.type === 'select' ? (
                  <select
                    id={`f-${f.key}`}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  >
                    <option value="">選択してください</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`f-${f.key}`}
                    type="text"
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                  />
                )}
                {f.hint && <p className="field-hint">{f.hint}</p>}
              </div>
            ))}

            {missing.length > 0 && (
              <p className="field-err">未記入の必須項目があります：{missing.join('・')}</p>
            )}

            <div className="consult-actions">
              <button className="primary" onClick={onGenerate} disabled={busy}>
                {busy ? '作成中…' : '原稿を作成する'}
              </button>
              <span className="consult-note">
                空欄のままでも作成できます。足りない情報は原稿に［要確認］として印が付きます。
              </span>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── 結果＋修正の対話 ──────────────────────────────────────
  return (
    <>
      <div className="page-head">
        <h1>{template.title}</h1>
        <p>直したいところを下の欄に書くと修正します（例：「もっと短く」「別案を3つ」）。</p>
        <button className="reset-chat" onClick={backToList} disabled={busy}>
          業務の選択に戻る
        </button>
      </div>

      <div className="wrap">
        <div className="messages">
          {restored && <div className="resume-note">前回の続きから再開しました（この端末に保存されています）。</div>}
          <div className="consult-formback">
            <button onClick={backToForm} disabled={busy}>
              入力内容を編集し直す
            </button>
          </div>
          {/* 先頭の user メッセージはフォーム記入内容そのもので長い。画面には出さず、
              「入力内容を編集し直す」から見てもらう（API には従来どおり送る）。 */}
          {messages.map((m, i) =>
            i === 0 ? null : (
            <div key={i} className={`msg ${m.role}`}>
              <div>
                <div className="bubble">{m.content || '…'}</div>
                {m.role === 'assistant' && m.content && (
                  <span
                    className={`copybtn ${copiedIdx === i ? 'copied' : ''}`}
                    onClick={() => copyMsg(i, m.content)}
                  >
                    {copiedIdx === i ? '✓ コピーされました' : 'この原稿をコピー'}
                  </span>
                )}
              </div>
            </div>
            ),
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="composer">
        <div className="inner">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="直したいところを入力（⌘/Ctrl+Enter で送信）"
          />
          <button onClick={onRevise} disabled={busy || !input.trim()}>
            {busy ? '…' : '修正'}
          </button>
        </div>
      </div>
    </>
  );
}
