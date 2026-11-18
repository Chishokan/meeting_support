// 読み込み中に出す灰色の枠（スケルトン）。全アプリ共通の部品。
// 「読み込み中…」の1行の代わりに、これから出るもの（表・一覧・文章）の形を先に出す。
//   Sk           … 灰色の棒1本
//   SkLines      … 文章の行（span だけで組んであるので <p> の中にも置ける）
//   SkTable      … 表（見出し1行＋行）
//   SkTableRows  … すでにある <tbody> の中に入れる行だけ
//   SkList       … カードが縦に並ぶ一覧（見出し＋補足の2行）
//   SkCards      … 数字のカードが横に並ぶもの
// 見た目は app/globals.css の「読み込み中の枠（スケルトン）」。動きを減らす設定の端末では動かさない。
// ★読み込みに失敗したとき・空のときの表示は、各画面がこれまでどおり出す（ここは読み込み中だけ）。

import type { CSSProperties } from 'react';

// 幅をばらつかせて、文字の行らしく見せる（決まった並びなので、描き直しても形が変わらない）
const WIDTHS = [72, 54, 88, 63, 80, 46, 92, 58, 76, 66];
const pct = (i: number) => `${WIDTHS[i % WIDTHS.length]}%`;

export function Sk({ w = '100%', h = 14, style }: { w?: number | string; h?: number; style?: CSSProperties }) {
  return <span className="sk" style={{ width: typeof w === 'number' ? `${w}px` : w, height: `${h}px`, ...style }} />;
}

export function SkLines({ lines = 3, label = '読み込み中' }: { lines?: number; label?: string }) {
  return (
    <span className="sk-lines" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => <Sk key={i} w={pct(i + 2)} />)}
    </span>
  );
}

export function SkTableRows({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="sk-row" aria-hidden="true">
          {Array.from({ length: cols }, (_, c) => <td key={c}><Sk w={pct(r + c)} /></td>)}
        </tr>
      ))}
    </>
  );
}

export function SkTable({ rows = 8, cols = 6, label = '読み込み中' }: { rows?: number; cols?: number; label?: string }) {
  return (
    <div className="sk-table-wrap" role="status" aria-busy="true" aria-label={label}>
      <table className="sk-table">
        <thead><tr>{Array.from({ length: cols }, (_, c) => <th key={c}><Sk w={pct(c + 5)} h={11} /></th>)}</tr></thead>
        <tbody><SkTableRows rows={rows} cols={cols} /></tbody>
      </table>
    </div>
  );
}

export function SkList({ rows = 4, label = '読み込み中' }: { rows?: number; label?: string }) {
  return (
    <div className="sk-list" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-item"><Sk w={pct(i)} h={16} /><Sk w={pct(i + 4)} h={12} /></div>
      ))}
    </div>
  );
}

export function SkCards({ n = 4, label = '読み込み中' }: { n?: number; label?: string }) {
  return (
    <div className="sk-cards" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="sk-card"><Sk w={pct(i)} h={12} /><Sk w={64} h={28} /><Sk w={pct(i + 3)} h={11} /></div>
      ))}
    </div>
  );
}
