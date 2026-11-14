'use client';

// 智翔館AI の右の欄（会話のメニュー）。決まりは lib/chishokanAi/pinnedContext.ts。
// - コンテキスト：職員が会話の前提として置く文。質問のたびに AI に渡す。追加・書き換え・消す・前の版に戻す。
//   AI の直し案があれば、ここから見比べて置き換える（components/AiContextDiffDialog.tsx）。
// - 読んだ資料：この会話で AI が読んだ資料（次の質問にも自動で渡している）。外したり、コンテキストに固定したりできる。
// - この会話：ファイルに書き出す・書き出したファイルから再開する。
// 画面が広いときは右に常に出し、狭いとき（スマホなど）は「📌 コンテキスト」で引き出す。

import { useEffect, useRef, useState } from 'react';
import type { CarryContext } from '@/lib/chishokanAi/conversation';
import {
  PIN_BY_LABEL,
  PIN_MAX_HISTORY,
  PIN_MAX_ITEMS,
  PIN_MAX_NAME,
  PIN_MAX_TEXT,
  PIN_TOTAL_CHARS,
  pinnedTotal,
  type Pinned,
} from '@/lib/chishokanAi/pinnedContext';

export type PinProposalView = {
  key: string;
  /** 直す項目の番号（空なら新しい項目の案） */
  id: string;
  name: string;
  text: string;
  summary: string;
  /** 案を出したときの、項目の文（そのあと書き換えられたかを確かめる） */
  base: string;
  status: 'pending' | 'applied' | 'dismissed';
};

export type PinDraft = { name: string; text: string };

type Props = {
  pinned: Pinned[];
  proposals: PinProposalView[];
  carry: CarryContext;
  draft: PinDraft | null;
  setDraft: (d: PinDraft | null) => void;
  onAdd: (name: string, text: string) => void;
  onSave: (id: string, name: string, text: string) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string, index: number) => void;
  onOpenProposal: (key: string) => void;
  onRemoveRead: (path: string) => void;
  onRemoveText: (name: string) => void;
  onPinText: (name: string) => void;
  readLabel: (path: string) => string;
  onExport: () => void;
  onImport: (file: File) => void;
  canExport: boolean;
  note: string;
  open: boolean;
  onClose: () => void;
};

export function shortTime(at: string): string {
  const d = new Date(at);
  if (!at || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 追加・書き換えの入力欄。 */
function PinForm({
  initial, rest, submitLabel, onSubmit, onCancel,
}: { initial: PinDraft; rest: number; submitLabel: string; onSubmit: (d: PinDraft) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial.name);
  const [text, setText] = useState(initial.text);
  const len = text.trim().length;
  const over = len > PIN_MAX_TEXT ? `1つの項目は${PIN_MAX_TEXT.toLocaleString()}字までです` : len > rest ? `合計が${PIN_TOTAL_CHARS.toLocaleString()}字を超えます（ほかの項目を短くするか消してください）` : '';
  return (
    <form
      className="ai-pin-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!len || over) return;
        onSubmit({ name, text });
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={PIN_MAX_NAME} placeholder="名前（例：担当学年、教材の決まり）" aria-label="名前" />
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="会話の前提にしたいことを書くか、貼ってください（例：担当は中3の数学。問題は県立入試の形式で作る）"
        aria-label="本文"
      />
      <div className={`ai-pin-count${over ? ' over' : ''}`}>{over || `${len.toLocaleString()}字（あと${Math.max(0, Math.min(PIN_MAX_TEXT, rest) - len).toLocaleString()}字まで）`}</div>
      <div className="ai-pin-form-actions">
        <button type="button" className="msg-action" onClick={onCancel}>やめる</button>
        <button type="submit" className="ai-pin-submit" disabled={!len || !!over}>{submitLabel}</button>
      </div>
    </form>
  );
}

export default function AiContextPanel(p: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 狭い画面で引き出しているときは、Esc でも閉じる
  const { open, onClose } = p;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.dm-modal-bg')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const total = pinnedTotal(p.pinned);
  const pending = p.proposals.filter((x) => x.status === 'pending');
  const newOnes = pending.filter((x) => !x.id);
  const full = p.pinned.length >= PIN_MAX_ITEMS;
  const carried = p.carry.reads.length + p.carry.texts.length;

  return (
    <>
      {p.open && <div className="ai-panel-bg" onClick={p.onClose} />}
      <aside className={`ai-panel${p.open ? ' open' : ''}`} aria-label="コンテキストと会話のメニュー">
        <div className="ai-panel-head">
          <h2>📌 コンテキスト <span>{p.pinned.length}/{PIN_MAX_ITEMS}</span></h2>
          <button type="button" className="ai-panel-close" onClick={p.onClose} aria-label="閉じる">×</button>
        </div>
        <p className="ai-panel-lead">
          ここに置いた文は、質問のたびにAIに渡します（この会話の前提になります）。AIに「c1を直して」と頼むと、直し案がここに出ます。
        </p>

        {newOnes.map((x) => (
          <button key={x.key} type="button" className="ai-pin-proposal" onClick={() => p.onOpenProposal(x.key)}>
            <b>✨ AIの新しい項目の案「{x.name}」</b>
            {x.summary && <span>{x.summary}</span>}
            <i>見て追加する</i>
          </button>
        ))}

        {p.pinned.map((it) => {
          const prop = pending.find((x) => x.id === it.id);
          const isOpen = expanded === it.id;
          return (
            <div key={it.id} className="ai-pin">
              <div className="ai-pin-head">
                <b title={it.name}>{it.name}</b>
                <span className="ai-pin-meta">{it.id}・{it.text.length.toLocaleString()}字</span>
              </div>
              {prop && (
                <button type="button" className="ai-pin-proposal" onClick={() => p.onOpenProposal(prop.key)}>
                  <b>✏️ AIの直し案があります</b>
                  {prop.summary && <span>{prop.summary}</span>}
                  <i>見比べる</i>
                </button>
              )}
              {editing === it.id ? (
                <PinForm
                  initial={{ name: it.name, text: it.text }}
                  rest={PIN_TOTAL_CHARS - total + it.text.length}
                  submitLabel="保存"
                  onSubmit={(d) => { p.onSave(it.id, d.name, d.text); setEditing(null); }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <button type="button" className={`ai-pin-text${isOpen ? ' open' : ''}`} onClick={() => setExpanded(isOpen ? null : it.id)} title={isOpen ? 'たたむ' : '全文を見る'}>
                  {it.text}
                </button>
              )}
              {editing !== it.id && (
                <div className="ai-pin-actions">
                  <span className="ai-pin-by">{PIN_BY_LABEL[it.by]}{shortTime(it.at) ? `・${shortTime(it.at)}` : ''}</span>
                  <button type="button" className="msg-action" onClick={() => setEditing(it.id)}>書き換える</button>
                  {it.history.length > 0 && (
                    <button type="button" className={`msg-action${historyOf === it.id ? ' on' : ''}`} onClick={() => setHistoryOf(historyOf === it.id ? null : it.id)}>
                      前の版（{it.history.length}）
                    </button>
                  )}
                  <button type="button" className="msg-action ai-pin-del" onClick={() => p.onDelete(it.id)}>消す</button>
                </div>
              )}
              {historyOf === it.id && editing !== it.id && (
                <ul className="ai-pin-history">
                  {[...it.history].map((v, i) => ({ v, i })).reverse().map(({ v, i }) => (
                    <li key={i}>
                      <div>
                        <span>{shortTime(v.at) || '—'}・{PIN_BY_LABEL[v.by]}（{v.text.length.toLocaleString()}字）</span>
                        <button type="button" className="msg-action" onClick={() => { p.onRestore(it.id, i); setHistoryOf(null); }}>この版に戻す</button>
                      </div>
                      <p>{v.text.length > 120 ? `${v.text.slice(0, 120)}…` : v.text}</p>
                    </li>
                  ))}
                  <li className="ai-pin-history-note">戻しても、いまの文は「前の版」に残ります（{PIN_MAX_HISTORY}つ前まで）。</li>
                </ul>
              )}
            </div>
          );
        })}

        {p.draft ? (
          <PinForm
            key={`${p.draft.name}\u0000${p.draft.text.length}`}
            initial={p.draft}
            rest={PIN_TOTAL_CHARS - total}
            submitLabel="追加する"
            onSubmit={(d) => p.onAdd(d.name, d.text)}
            onCancel={() => p.setDraft(null)}
          />
        ) : (
          <button type="button" className="ai-pin-add" onClick={() => p.setDraft({ name: '', text: '' })} disabled={full}>
            {full ? `コンテキストは${PIN_MAX_ITEMS}個までです` : '＋ 追加'}
          </button>
        )}
        {p.pinned.length > 0 && <div className="ai-panel-total">合計 {total.toLocaleString()} / {PIN_TOTAL_CHARS.toLocaleString()}字</div>}

        <h3 className="ai-panel-sub">読んだ資料 <span>{carried}</span></h3>
        {carried === 0 ? (
          <p className="ai-panel-empty">AIが読んだ資料・添付した文字の資料は、ここに出て、次の質問にも自動で渡します。</p>
        ) : (
          <ul className="ai-carry-list">
            {p.carry.reads.map((r) => (
              <li key={r} title={r}>
                <span>📚 {p.readLabel(r)}</span>
                <button type="button" onClick={() => p.onRemoveRead(r)} aria-label="外す" title="次の質問から渡さない">×</button>
              </li>
            ))}
            {p.carry.texts.map((t) => (
              <li key={t.name} title={t.name}>
                <span>📄 {t.name}</span>
                <button type="button" onClick={() => p.onPinText(t.name)} disabled={full} aria-label="コンテキストに固定" title="コンテキストに固定する（古い資料から外れていかない）">📌</button>
                <button type="button" onClick={() => p.onRemoveText(t.name)} aria-label="外す" title="次の質問から渡さない">×</button>
              </li>
            ))}
          </ul>
        )}

        <h3 className="ai-panel-sub">この会話</h3>
        <div className="ai-panel-file">
          <button type="button" className="msg-action" onClick={p.onExport} disabled={!p.canExport}>💾 ファイルに書き出す</button>
          <button type="button" className="msg-action" onClick={() => fileRef.current?.click()}>📂 ファイルから再開</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) p.onImport(f);
            }}
          />
        </div>
        {p.note && <p className="ai-panel-note">{p.note}</p>}
        <p className="ai-panel-empty">
          書き出したファイルには、会話・コンテキスト・読んだ資料の文字が入ります（添付したPDF・画像は入りません）。各自で管理し、共有のフォルダには置かないでください。
        </p>
      </aside>
    </>
  );
}
