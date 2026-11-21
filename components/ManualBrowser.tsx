'use client';

// ヘルプデスク「マニュアル」タブの中身。資料は lib/manuals.ts、検索は lib/manualSearch.ts。
// 分類ごとにまとめ、左（スマホでは上）の目次から飛べるようにし、上の検索欄と種類（PDF・動画）で絞り込める。
// 動画はページが長くならないよう、［この画面で再生］を押したときだけ開く。

import { useEffect, useMemo, useState } from 'react';
import { MANUALS, MANUAL_CATEGORIES, type ManualCategoryId, type ManualDoc } from '@/lib/manuals';
import { matchesManual, splitQuery } from '@/lib/manualSearch';

type KindFilter = 'all' | 'pdf' | 'video';

const KIND_TABS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'すべて' },
  { id: 'pdf', label: 'PDF' },
  { id: 'video', label: '動画' },
];

// 目次では「動画：」を外して短くする（種類は印で出す）
function tocTitle(m: ManualDoc): string {
  return m.title.replace(/^動画：/, '');
}

export default function ManualBrowser() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [activeCat, setActiveCat] = useState<ManualCategoryId | null>(null);

  const words = useMemo(() => splitQuery(query), [query]);
  const filtering = words.length > 0 || kind !== 'all';

  const groups = useMemo(
    () =>
      MANUAL_CATEGORIES.map((c) => ({
        ...c,
        items: MANUALS.filter(
          (m) =>
            m.category === c.id &&
            (kind === 'all' || m.kind === kind) &&
            matchesManual(m, c.label, words),
        ),
      })).filter((g) => g.items.length > 0),
    [kind, words],
  );
  const hitCount = groups.reduce((n, g) => n + g.items.length, 0);

  // いま見ている分類を目次で目立たせる
  useEffect(() => {
    const els = groups
      .map((g) => document.getElementById(`cat-${g.id}`))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveCat(top.target.id.replace(/^cat-/, '') as ManualCategoryId);
      },
      { rootMargin: '-80px 0px -55% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [groups]);

  function clearFilters() {
    setQuery('');
    setKind('all');
  }

  return (
    <div className="mb" id="mb-top">
      <div className="mb-tools">
        <label className="mb-search">
          <span className="mb-search-icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="言葉で探す（例：議事録、受験票）"
            aria-label="マニュアルを探す"
          />
        </label>
        <div className="mb-kinds" role="group" aria-label="種類で絞り込む">
          {KIND_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`mb-kind ${kind === t.id ? 'active' : ''}`}
              aria-pressed={kind === t.id}
              onClick={() => setKind(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {filtering && hitCount > 0 && (
          <p className="mb-hits">
            {hitCount} 件見つかりました
            <button type="button" className="mb-clear" onClick={clearFilters}>
              絞り込みを解除
            </button>
          </p>
        )}
      </div>

      <div className="mb-body">
        <nav className={`mb-toc ${groups.length === 0 ? 'empty' : ''}`} aria-label="目次">
          <p className="mb-toc-head">目次</p>
          <ol className="mb-toc-cats">
            {groups.map((g) => (
              <li key={g.id} className={`mb-toc-cat ${activeCat === g.id ? 'active' : ''}`}>
                <a href={`#cat-${g.id}`} className="mb-toc-cat-link">
                  <span>{g.label}</span>
                  <span className="mb-toc-n">{g.items.length}</span>
                </a>
                <ul className="mb-toc-items">
                  {g.items.map((m) => (
                    <li key={m.id}>
                      <a href={`#m-${m.id}`} className="mb-toc-item">
                        <span className={`mb-toc-kind ${m.kind}`}>{m.kind === 'pdf' ? 'PDF' : '動画'}</span>
                        <span>{tocTitle(m)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mb-sections">
          {groups.length === 0 && (
            <div className="mb-empty">
              <p>「{query.trim() || KIND_TABS.find((t) => t.id === kind)?.label}」に合うマニュアルはありませんでした。</p>
              <p>言葉を短くするか、別の言い方で探してみてください。</p>
              <button type="button" className="mb-clear" onClick={clearFilters}>
                すべてのマニュアルを出す
              </button>
            </div>
          )}
          {groups.map((g) => (
            <section key={g.id} id={`cat-${g.id}`} className="mb-section">
              <div className="mb-section-head">
                <h2>{g.label}</h2>
                <p>{g.desc}</p>
                <a href="#mb-top" className="mb-to-top">↑ 目次へ</a>
              </div>
              <ul className="manual-list">
                {g.items.map((m) => (
                  <ManualCard key={m.id} m={m} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function ManualCard({ m }: { m: ManualDoc }) {
  return (
    <li id={`m-${m.id}`} className="manual-item">
      <div className="manual-head">
        <span className={`manual-kind ${m.kind}`}>{m.kind === 'pdf' ? 'PDF' : '動画'}</span>
        <span className="manual-title">{m.title}</span>
      </div>
      <p className="manual-desc">{m.desc}</p>
      {m.kind === 'video' && (
        <details className="manual-player">
          <summary>▶ この画面で再生</summary>
          <video className="manual-video" controls preload="none" playsInline poster={m.poster}>
            <source src={m.href} type="video/mp4" />
          </video>
        </details>
      )}
      <div className="manual-foot">
        <span className="manual-meta">{m.meta}</span>
        <div className="manual-actions">
          {m.kind === 'pdf' && (
            <a className="manual-open" href={m.href} target="_blank" rel="noopener noreferrer">
              開く
            </a>
          )}
          <a className="manual-download" href={m.href} download={m.downloadName}>
            ダウンロード
          </a>
        </div>
      </div>
    </li>
  );
}
