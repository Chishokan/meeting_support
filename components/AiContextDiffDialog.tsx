'use client';

// 智翔館AI：コンテキストの直し案を「変更前・変更後」で見比べる小窓。変わったところに色を付ける（lib/chishokanAi/textDiff.ts）。
// 「置き換える」を押したときだけ入れ替わる（前の文は「前の版」に残る）。新しい項目の案は「追加する」。

import { useMemo } from 'react';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { PIN_MAX_ITEMS, PIN_MAX_TEXT, PIN_TOTAL_CHARS, type Pinned } from '@/lib/chishokanAi/pinnedContext';
import { diffText } from '@/lib/chishokanAi/textDiff';
import type { PinProposalView } from '@/components/AiContextPanel';

type Props = {
  proposal: PinProposalView;
  /** 直す項目（新しい項目の案なら undefined） */
  current?: Pinned;
  /** 今ある項目の数と合計の字数（新しい項目を足せるか） */
  count: number;
  total: number;
  onApply: () => void;
  onDismiss: () => void;
  onClose: () => void;
};

export default function AiContextDiffDialog({ proposal, current, count, total, onApply, onDismiss, onClose }: Props) {
  useModalDismiss(onClose);
  const parts = useMemo(() => (current ? diffText(current.text, proposal.text) : []), [current, proposal.text]);
  const changedSince = !!current && current.text !== proposal.base;
  const isNew = !proposal.id;
  const lost = !isNew && !current;
  const blocked = isNew
    ? count >= PIN_MAX_ITEMS
      ? `コンテキストは${PIN_MAX_ITEMS}個までです。要らない項目を消してから追加してください。`
      : total + proposal.text.length > PIN_TOTAL_CHARS
        ? `合計が${PIN_TOTAL_CHARS.toLocaleString()}字を超えます。ほかの項目を短くするか消してから追加してください。`
        : ''
    : current && total - current.text.length + proposal.text.length > PIN_TOTAL_CHARS
      ? `置き換えると合計が${PIN_TOTAL_CHARS.toLocaleString()}字を超えます。ほかの項目を短くするか消してください。`
      : proposal.text.length > PIN_MAX_TEXT
        ? `1つの項目は${PIN_MAX_TEXT.toLocaleString()}字までです。`
        : '';
  const title = isNew ? `新しい項目の案「${proposal.name}」` : `${proposal.id}「${current?.name ?? proposal.name}」の直し案`;

  return (
    <div className="dm-modal-bg" onClick={onClose}>
      <div className="dm-modal ai-diff" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dm-modal-head">
          <div>
            <h2>{title}</h2>
            {proposal.summary && <div className="dm-modal-sub">AI：{proposal.summary}</div>}
          </div>
          <button className="dm-modal-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <div className="dm-modal-body">
          {lost && <p className="ai-diff-warn">この項目はもう消されています。案を捨ててください。</p>}
          {changedSince && (
            <p className="ai-diff-warn">この案を出したあとで、項目が書き換えられています。置き換えると、いまの文は「前の版」に残ります。</p>
          )}
          {current && current.name !== proposal.name && (
            <p className="ai-diff-name">名前：<del>{current.name}</del> → <ins>{proposal.name}</ins></p>
          )}
          {isNew ? (
            <div className="ai-diff-cols one">
              <section>
                <h3>追加する文（{proposal.text.length.toLocaleString()}字）</h3>
                <div className="ai-diff-text">{proposal.text}</div>
              </section>
            </div>
          ) : current ? (
            <div className="ai-diff-cols">
              <section>
                <h3>変更前（{current.text.length.toLocaleString()}字）</h3>
                <div className="ai-diff-text">
                  {parts.map((d, i) => (d.kind === 'same' ? <span key={i}>{d.text}</span> : d.kind === 'del' ? <del key={i}>{d.text}</del> : null))}
                </div>
              </section>
              <section>
                <h3>変更後（{proposal.text.length.toLocaleString()}字）</h3>
                <div className="ai-diff-text">
                  {parts.map((d, i) => (d.kind === 'same' ? <span key={i}>{d.text}</span> : d.kind === 'add' ? <ins key={i}>{d.text}</ins> : null))}
                </div>
              </section>
            </div>
          ) : null}
          {blocked && <p className="ai-diff-warn">{blocked}</p>}
        </div>
        <div className="ai-diff-actions">
          <button type="button" className="msg-action" onClick={onDismiss}>案を捨てる</button>
          <button type="button" className="msg-action" onClick={onClose}>あとで</button>
          <button type="button" className="ai-report-submit" onClick={onApply} disabled={!!blocked || lost}>
            {isNew ? '追加する' : '置き換える'}
          </button>
        </div>
      </div>
    </div>
  );
}
