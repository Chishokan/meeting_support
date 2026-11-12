'use client';

// AI の回答（Markdown）を、見出し・表・箇条書き・コード枠に整えて表示する。
// 中身の分け方は lib/chishokanAi/markdown.ts。ここは描くだけで、HTML としては埋め込まない（文字として描く）。

import { memo, useMemo, useState, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '@/lib/chishokanAi/markdown';

/** クリップボードに文字を写す。https でない画面や古いブラウザでは、選択してコピーする方法に切り替える。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = 'コピー', className = 'md-copy' }: { text: () => string; label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const ok = await copyText(text());
        setState(ok ? 'done' : 'fail');
        setTimeout(() => setState('idle'), 1600);
      }}
    >
      {state === 'done' ? 'コピーしました' : state === 'fail' ? 'コピーできませんでした' : label}
    </button>
  );
}

function renderInline(nodes: Inline[], key = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    if (n.t === 'text') {
      // 改行（箇条書きの続きの行など）は <br> にする
      const parts = n.v.split('\n');
      return parts.length === 1 ? (
        <span key={k}>{n.v}</span>
      ) : (
        <span key={k}>
          {parts.map((p, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {p}
            </span>
          ))}
        </span>
      );
    }
    if (n.t === 'bold') return <strong key={k}>{renderInline(n.c, `${k}-`)}</strong>;
    if (n.t === 'code') return <code key={k}>{n.v}</code>;
    return (
      <a key={k} href={n.href} target="_blank" rel="noopener noreferrer">
        {renderInline(n.c, `${k}-`)}
      </a>
    );
  });
}

function lines(ls: Inline[][]): ReactNode[] {
  return ls.map((l, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {renderInline(l, `${i}-`)}
    </span>
  ));
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'heading': {
      const Tag = (['h3', 'h3', 'h4', 'h5', 'h5', 'h5'] as const)[b.level - 1] ?? 'h5';
      return <Tag key={i}>{renderInline(b.c)}</Tag>;
    }
    case 'para':
      return <p key={i}>{lines(b.lines)}</p>;
    case 'quote':
      return <blockquote key={i}>{lines(b.lines)}</blockquote>;
    case 'hr':
      return <hr key={i} />;
    case 'list':
      return (
        <div key={i} className="md-list" role="list">
          {b.items.map((it, j) => (
            <div key={j} className="md-li" role="listitem" style={{ paddingLeft: `${it.level * 1.3}em` }}>
              <span className={it.ordered ? 'md-num' : 'md-dot'}>{it.marker}</span>
              <span>{renderInline(it.c)}</span>
            </div>
          ))}
        </div>
      );
    case 'table':
      return (
        <div key={i} className="md-table">
          <table>
            <thead>
              <tr>{b.head.map((c, j) => <th key={j}>{renderInline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>{r.map((c, k) => <td key={k}>{renderInline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'code':
      return (
        <div key={i} className="md-code">
          <div className="md-code-bar">
            <span>{b.lang || '文字'}</span>
            <CopyButton text={() => b.v} />
          </div>
          <pre>{b.v}</pre>
        </div>
      );
  }
}

// 会話が長くなっても、変わっていない回答は描き直さない。
function AiMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="md">{blocks.map(renderBlock)}</div>;
}

export default memo(AiMarkdown);
