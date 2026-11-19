'use client';

// 事前共有のカード・詳細に出す Zoom のボタン（Zoom連携）。
//   ・［Zoomに参加］… 参加URLを別のタブで開く
//   ・［ホストとして開始］… 部門長（自分の部門の会議）と管理部門にだけ出す。押したときにサーバから開始用URLを取る
//     （自動クラウド録画は、ホストが開始したときに始まる）
// Zoom ミーティングを作っていない会議では何も出さない。

import { useState } from 'react';
import type { PreshareRow } from '@/lib/deptMinutesPreshare';
import { zoomErrorText, zoomJoinHref } from '@/lib/zoom/link';

export default function ZoomButtons({
  row,
  detail = false,
}: {
  row: PreshareRow;
  detail?: boolean; // 詳細（ポップアップ）では、ホストの人にも［参加者として入る］を出す
}) {
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState('');
  const join = zoomJoinHref(row.zoomJoinUrl);
  if (!join) return null;

  async function start() {
    if (starting) return;
    setErr('');
    setStarting(true);
    // 開始用URLを取ってから開くと、ブラウザに「勝手に開いた窓」とみなされて止められることがある。
    // 押した瞬間に空のタブを開いておき、URLが取れたらそこへ移す。
    const tab = window.open('', '_blank');
    try {
      const res = await fetch('/api/zoom/meetings/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preshareId: row.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok && typeof j.url === 'string') {
        if (tab) {
          tab.opener = null;
          tab.location.href = j.url;
        } else {
          window.location.href = j.url;
        }
      } else {
        tab?.close();
        setErr(zoomErrorText(j?.reason));
      }
    } catch {
      tab?.close();
      setErr('Zoom を開始できませんでした。通信状況をご確認ください。');
    } finally {
      setStarting(false);
    }
  }

  const joinLink = (label: string, cls: string) => (
    <a className={cls} href={join} target="_blank" rel="noopener noreferrer">{label}</a>
  );

  return (
    <>
      {row.canHost ? (
        <>
          <button className="zoom-btn host" onClick={() => void start()} disabled={starting}>
            {starting ? '開いています…' : 'ホストとして開始'}
          </button>
          {detail && joinLink('参加者として入る', 'zoom-btn sub')}
        </>
      ) : (
        joinLink('Zoomに参加', 'zoom-btn')
      )}
      {err && <span className="zoom-err" role="alert">{err}</span>}
    </>
  );
}
