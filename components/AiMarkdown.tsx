'use client';

// AI の回答（Markdown）を、見出し・表・箇条書き・コード枠に整えて表示する。
// 中身の分け方は lib/chishokanAi/markdown.ts。ここは描くだけで、HTML としては埋め込まない（文字として描く）。
// 種類が「選択肢」のコード枠（```選択肢）は、1行ずつ押せるボタンにする（押すとその文で質問する）。

import { memo, useMemo, useState, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '@/lib/chishokanAi/markdown';
import { isFigureLang, parseFigure, renderFigureSvg } from '@/lib/chishokanAi/figure';

/** SVG の図を PNG（2倍の解像度）にして保存する。先生が自分のプリントに貼れるように。 */
async function saveFigurePng(svg: string, width: number, height: number, name: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('load'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!png) return;
    const href = URL.createObjectURL(png);
    const a = document.createElement('a');
    a.href = href;
    // 日本語のファイル名は、ブラウザによって使われないことがあるので英数字にする（図1 → figure1.png）
    a.download = `${(name || '図').replace(/図/g, 'figure').replace(/[^\w.-]+/g, '') || 'figure'}.png`;
    // ページに置いてから押さないと、ブラウザによってはファイル名が使われない
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 数学の図（```図 の枠）。中身は座標と短い文字だけの JSON で、SVG はこちらで作る（AI の SVG や HTML は使わない）。
function FigureBlock({ source, final }: { source: string; final: boolean }) {
  const r = useMemo(() => {
    const p = parseFigure(source);
    return p.ok ? { ok: true as const, caption: p.spec.caption ?? '', ...renderFigureSvg(p.spec) } : { ok: false as const, error: p.error };
  }, [source]);
  if (!r.ok) {
    return final ? (
      <div className="md-figure md-figure-error">図を描けませんでした（{r.error}）</div>
    ) : (
      <div className="md-figure md-figure-wait">図を描いています…</div>
    );
  }
  return (
    <figure className="md-figure">
      {/* renderFigureSvg は数値と、エスケープした文字だけで SVG を作る */}
      <div className="md-figure-svg" style={{ maxWidth: r.width }} dangerouslySetInnerHTML={{ __html: r.svg }} />
      <figcaption>
        {r.caption && <span>{r.caption}</span>}
        <button type="button" className="md-copy" onClick={() => saveFigurePng(r.svg, r.width, r.height, r.caption)}>
          画像を保存
        </button>
      </figcaption>
    </figure>
  );
}

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

/** 選択肢のコード枠か（```選択肢 / ```choices）。 */
export function isChoices(b: Block): boolean {
  return b.t === 'code' && (b.lang === '選択肢' || b.lang.toLowerCase() === 'choices');
}

export function choiceItems(v: string): string[] {
  return v
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*・]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
}

function renderBlock(b: Block, i: number, onChoose?: (text: string) => void, final = true): ReactNode {
  if (b.t === 'code' && isFigureLang(b.lang)) return <FigureBlock key={i} source={b.v} final={final} />;
  if (b.t === 'code' && isChoices(b)) {
    return (
      <div key={i} className="md-choices">
        {choiceItems(b.v).map((c, j) => (
          <button key={j} type="button" className="md-choice" disabled={!onChoose} onClick={() => onChoose?.(c)}>
            {c}
          </button>
        ))}
      </div>
    );
  }
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
// onChoose を渡したときだけ、選択肢のボタンが押せる（いちばん新しい回答だけに渡す）。
// streaming のあいだは、書きかけの図を「描いています」と出す（JSON が閉じるまで読めないため）。
function AiMarkdown({ text, onChoose, streaming = false }: { text: string; onChoose?: (text: string) => void; streaming?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="md">{blocks.map((b, i) => renderBlock(b, i, onChoose, !streaming || i < blocks.length - 1))}</div>;
}

export default memo(AiMarkdown);
