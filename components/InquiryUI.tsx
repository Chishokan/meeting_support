'use client';

import { useEffect, useState } from 'react';

type Item = {
  ts: string;
  campus: string;
  user: string;
  category: string;
  content: string;
  imageUrl: string;
};

const CATEGORIES = ['不具合（バグ）', '改善要望', '使い方の質問', 'プロンプトの修正', 'その他'];

// 画像をブラウザ側で縮小して data URL（JPEG）に変換し、送信を軽量化する。
async function downscaleToDataUrl(file: File, maxDim = 1600, quality = 0.8): Promise<string> {
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
  if (m > maxDim) {
    const s = maxDim / m;
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

function fmt(ts: string) {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return ts;
  }
}

export default function InquiryUI({ name, campus }: { name: string; campus: string }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [content, setContent] = useState('');
  const [image, setImage] = useState<string>(''); // data URL
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filterCat, setFilterCat] = useState('すべて');

  async function loadList() {
    setLoading(true);
    try {
      const res = await fetch('/api/inquiry');
      const j = await res.json().catch(() => ({}));
      setItems(Array.isArray(j?.items) ? j.items : []);
    } catch {
      setItems([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadList();
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setImage(await downscaleToDataUrl(f));
    } catch {
      setStatus('画像の読み込みに失敗しました。');
    }
  }

  async function submit() {
    if (busy) return;
    if (!content.trim()) {
      setStatus('内容を入力してください。');
      return;
    }
    setBusy(true);
    setStatus('送信中…');
    try {
      const imagePayload = image ? { data: image.split(',')[1] ?? '', mime: 'image/jpeg', name: 'inquiry.jpg' } : null;
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, content: content.trim(), image: imagePayload }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setStatus('送信しました。ありがとうございます。');
        setContent('');
        setImage('');
        void loadList();
      } else if (j?.reason === 'not_configured') {
        setStatus('未設定です（連携先の設定が必要）。管理者にご連絡ください。');
      } else {
        setStatus(`送信に失敗しました（理由：${j?.reason ?? '不明'}）。`);
      }
    } catch {
      setStatus('通信エラーが発生しました。');
    } finally {
      setBusy(false);
    }
  }

  const shown = items.filter((it) => {
    if (filterCat !== 'すべて' && it.category !== filterCat) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${it.content} ${it.category} ${it.user} ${it.campus}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="inquiry">
      <div className="page-head">
        <h1>お問い合わせ</h1>
        <p>不具合の報告・改善要望・質問などをお寄せください（{campus}／{name} さん）。テスト運用中のご協力に感謝します。</p>
      </div>

      <div className="inq-body">
        <div className="inq-form">
          <label>種別</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <label>内容</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="どんな不具合・要望・質問か、できるだけ具体的に（どの画面で・何をしたら・どうなったか）"
          />

          <label>画像（任意・スクリーンショット等）</label>
          <input type="file" accept="image/*" onChange={onFile} />
          {image && (
            <div className="inq-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="添付プレビュー" />
              <button type="button" className="inq-clear" onClick={() => setImage('')}>画像を外す</button>
            </div>
          )}

          <div className="inq-actions">
            <button onClick={submit} disabled={busy || !content.trim()}>
              {busy ? '送信中…' : '送信する'}
            </button>
            {status && <span className="inq-note">{status}</span>}
          </div>
        </div>

        <div className="inq-list">
          <div className="inq-list-head">
            <h2>過去の問い合わせ</h2>
            <div className="inq-filters">
              <input
                className="inq-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="キーワード検索"
              />
              <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
                <option value="すべて">すべての種別</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button className="inq-reload" onClick={() => void loadList()}>更新</button>
            </div>
          </div>

          {loading ? (
            <p className="inq-empty">読み込み中…</p>
          ) : shown.length === 0 ? (
            <p className="inq-empty">該当する問い合わせはありません。</p>
          ) : (
            <ul className="inq-items">
              {shown.map((it, i) => (
                <li key={i} className="inq-item">
                  <div className="inq-item-top">
                    <span className="inq-cat">{it.category || '（種別なし）'}</span>
                    <span className="inq-meta">{it.campus}／{it.user}・{fmt(it.ts)}</span>
                  </div>
                  <div className="inq-content">{it.content}</div>
                  {it.imageUrl && it.imageUrl.startsWith('http') && (
                    <a className="inq-img-link" href={it.imageUrl} target="_blank" rel="noreferrer">画像を見る</a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
