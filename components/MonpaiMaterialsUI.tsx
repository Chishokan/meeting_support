'use client';

// 門配管理：配布物・ノベルティの在庫。
// 在庫＝入庫の合計 − 実績で配った数（門配の「配布物」欄に品名を書くと、実施部数ぶん自動で減る）。

import { useEffect, useState } from 'react';
import { MATERIAL_KINDS, todayJst } from '@/lib/monpai/model';
import { fetchMaterials, postMaterial, reasonText, type MovementRow, type StockRow } from '@/lib/monpai/client';

export default function MonpaiMaterialsUI() {
  const [items, setItems] = useState<StockRow[]>([]);
  const [moves, setMoves] = useState<MovementRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState({ name: '', kind: 'チラシ', prep: '', threshold: '', note: '' });
  const [move, setMove] = useState({ name: '', qty: '', date: todayJst(), memo: '' });
  const [msg, setMsg] = useState('');

  async function load() {
    const r = await fetchMaterials();
    setLoading(false);
    if (r.ok) { setItems(r.items); setMoves(r.movements); setError(''); } else setError(reasonText(r.reason));
  }
  useEffect(() => { load(); }, []);

  async function submit(body: Record<string, unknown>, reset: () => void) {
    setMsg('');
    const r = await postMaterial(body);
    if (!r.ok) return setMsg(r.errors?.join(' ') || reasonText(r.reason ?? ''));
    reset();
    load();
  }

  const low = items.filter((i) => i.low);

  return (
    <div className="mp mp-materials">
      <div className="mp-toolbar"><h1 className="mp-h1">配布物・ノベルティ</h1></div>
      {error && <div className="mp-note">{error}</div>}
      {low.length > 0 && (
        <div className="mp-note warn">残りわずか：{low.map((i) => `${i.name}（残り${i.stock}）`).join('、')}　準備担当に手配を依頼してください。</div>
      )}

      <div className="ib-table-wrap">
        <table className="mp-summary">
          <thead><tr><th>品名</th><th>種類</th><th>準備担当</th><th>入庫計</th><th>配布済み</th><th>在庫</th><th>発注目安</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.name} className={i.low ? 'mp-low' : ''}>
                <td className="mp-school">{i.name}{i.note && <span className="mp-rate">{i.note}</span>}</td>
                <td>{i.kind}</td>
                <td>{i.prep}</td>
                <td className="mp-num">{i.received}</td>
                <td className="mp-num">{i.used}</td>
                <td className={`mp-num ${i.low ? 'short' : ''}`}>{i.stock}</td>
                <td className="mp-num">{i.threshold}</td>
              </tr>
            ))}
            {!loading && items.length === 0 && <tr><td colSpan={7} className="mp-muted">まだ登録されていません。下の「品目を追加」から登録してください。</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mp-legend">門配の記録の「配布物」欄に品名を書くと、実績を報告したときに配った数だけ在庫から減ります（複数渡すときは「、」で区切る）。</p>

      <div className="mp-panels">
        <section className="mp-card">
          <h2 className="mp-h2">入庫・調整を記録</h2>
          <div className="mp-form">
            <label>品名
              <select value={move.name} onChange={(e) => setMove({ ...move, name: e.target.value })}>
                <option value="">選んでください</option>
                {items.map((i) => <option key={i.name} value={i.name}>{i.name}</option>)}
              </select>
            </label>
            <div className="mp-form-row">
              <label>数量<input type="number" inputMode="numeric" value={move.qty} placeholder="入庫 500／廃棄 -20" onChange={(e) => setMove({ ...move, qty: e.target.value })} /></label>
              <label>日付<input type="date" value={move.date} onChange={(e) => setMove({ ...move, date: e.target.value })} /></label>
            </div>
            <label>メモ<input value={move.memo} placeholder="例 NEPから納品" onChange={(e) => setMove({ ...move, memo: e.target.value })} /></label>
            <button className="mp-btn primary" onClick={() => submit({ type: 'movement', ...move }, () => setMove({ ...move, qty: '', memo: '' }))}>記録する</button>
          </div>
        </section>

        <section className="mp-card">
          <h2 className="mp-h2">品目を追加・変更</h2>
          <div className="mp-form">
            <label>品名<input list="mp-material-names" value={item.name} placeholder="例 冬期講習チラシ" onChange={(e) => {
              const found = items.find((i) => i.name === e.target.value);
              setItem(found ? { name: found.name, kind: found.kind, prep: found.prep, threshold: String(found.threshold), note: found.note } : { ...item, name: e.target.value });
            }} /></label>
            <datalist id="mp-material-names">{items.map((i) => <option key={i.name} value={i.name} />)}</datalist>
            <div className="mp-form-row">
              <label>種類
                <select value={item.kind} onChange={(e) => setItem({ ...item, kind: e.target.value })}>
                  {MATERIAL_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              <label>準備担当<input value={item.prep} placeholder="NEP／教室" onChange={(e) => setItem({ ...item, prep: e.target.value })} /></label>
            </div>
            <div className="mp-form-row">
              <label>発注目安<input type="number" min={0} inputMode="numeric" value={item.threshold} placeholder="例 200" onChange={(e) => setItem({ ...item, threshold: e.target.value })} /></label>
              <label>備考<input value={item.note} onChange={(e) => setItem({ ...item, note: e.target.value })} /></label>
            </div>
            <button className="mp-btn primary" onClick={() => submit({ type: 'item', ...item }, () => setItem({ name: '', kind: 'チラシ', prep: '', threshold: '', note: '' }))}>保存する</button>
          </div>
        </section>
      </div>
      {msg && <div className="mp-err">{msg}</div>}

      {moves.length > 0 && (
        <>
          <h2 className="mp-h2">最近の入出庫</h2>
          <div className="ib-table-wrap">
            <table className="mp-summary">
              <thead><tr><th>日付</th><th>品名</th><th>数量</th><th>メモ</th><th>登録者</th></tr></thead>
              <tbody>
                {moves.map((m, i) => (
                  <tr key={i}><td>{m.date}</td><td>{m.name}</td><td className="mp-num">{m.qty > 0 ? `+${m.qty}` : m.qty}</td><td>{m.memo}</td><td>{m.user}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
