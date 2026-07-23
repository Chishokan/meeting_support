'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type ItemsMap = Record<string, string[]>;

export default function ProgressItemsAdmin() {
  const [items, setItems] = useState<ItemsMap>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [savingCampus, setSavingCampus] = useState('');
  const [statusByCampus, setStatusByCampus] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/progress/items');
        const j = await res.json().catch(() => ({}));
        if (!alive) return;
        if (j?.ok && j.items) {
          const map = j.items as ItemsMap;
          setItems(map);
          const d: Record<string, string> = {};
          for (const c of Object.keys(map)) d[c] = (map[c] ?? []).join('\n');
          setDrafts(d);
          if (j.configured === false) {
            setNote('※ Apps Script が未設定のため、初期値の表示のみで保存はできません。');
          }
        } else if (j?.reason === 'forbidden') {
          setNote('この操作は管理部門のみ可能です。');
        } else {
          setNote('項目の取得に失敗しました。');
        }
      } catch {
        if (alive) setNote('項目の取得に失敗しました。');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function save(campus: string) {
    if (savingCampus) return;
    setSavingCampus(campus);
    setStatusByCampus((s) => ({ ...s, [campus]: '保存中…' }));
    const list = (drafts[campus] ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    try {
      const res = await fetch('/api/progress/items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campus, items: list }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        const saved = (j.items as string[]) ?? list;
        setItems((m) => ({ ...m, [campus]: saved }));
        setDrafts((d) => ({ ...d, [campus]: saved.join('\n') }));
        setStatusByCampus((s) => ({ ...s, [campus]: '✓ 保存しました' }));
      } else if (j?.reason === 'not_configured') {
        setStatusByCampus((s) => ({ ...s, [campus]: '未設定のため保存できません' }));
      } else if (j?.reason === 'forbidden') {
        setStatusByCampus((s) => ({ ...s, [campus]: '権限がありません' }));
      } else {
        setStatusByCampus((s) => ({ ...s, [campus]: `保存に失敗（${j?.reason ?? '不明'}）` }));
      }
    } catch {
      setStatusByCampus((s) => ({ ...s, [campus]: '通信エラー' }));
    } finally {
      setSavingCampus('');
    }
  }

  const campuses = Object.keys(items);

  return (
    <div className="items-admin">
      <div className="page-head">
        <h1>中間報告の定例項目</h1>
        <p>
          部門ごとに、中間報告でAIが尋ねる項目を編集できます（管理部門のみ）。1行に1項目。
          ここに書いた項目が、この順番・この表記のまま「〇〇についての報告をお願いします。」と1つずつ聞かれます。
          「会議で決議した事項の進捗」も聞きたい場合は、1行目に書いてください（自動では追加されません）。
        </p>
        <Link className="doc-link" href="/progress">← 中間報告へ戻る</Link>
      </div>

      {note && <p className="report-note">{note}</p>}
      {loading ? (
        <p className="dash-empty">読み込み中…</p>
      ) : (
        <div className="items-grid">
          {campuses.map((c) => (
            <div key={c} className="items-card">
              <div className="items-card-head">
                <b>{c}</b>
                {statusByCampus[c] && <span className="report-note">{statusByCampus[c]}</span>}
              </div>
              <textarea
                value={drafts[c] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [c]: e.target.value }))}
                placeholder="1行に1項目（例：生徒数（在籍・前年比））"
                rows={6}
              />
              <div className="items-card-actions">
                <button onClick={() => save(c)} disabled={savingCampus === c}>
                  {savingCampus === c ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
