'use client';

// 事前共有のカード・詳細に出す Zoom のボタン（Zoom連携）。
//   ・［Zoomに参加］… 全員に出す。参加URLを別のタブで開く
//   ・［ホストとして開始］… その会議のホスト担当の1人にだけ、参加ボタンと並べて出す（lib/zoom/access.ts）。
//     押したときにサーバから開始用URLを取る（自動クラウド録画は、ホストが開始したときに始まる）
// ホストとして入る人は Zoom のアカウント（公式1・公式2）そのものになる。何人も入ると混乱するので、
// だれがホスト担当かをボタンの横に出し、押す前に確かめる。
// Zoom ミーティングを作っていない会議では何も出さない。

import { useState } from 'react';
import type { PreshareRow } from '@/lib/deptMinutesPreshare';
import { zoomErrorText, zoomJoinHref } from '@/lib/zoom/link';

// 押す前の確認。ホストは1人だけであることと、Zoom が「進行中のミーティング」の終了を求めてきたときの注意。
const START_CONFIRM = [
  'ホストとして会議を開始します（クラウド録画が始まります）。',
  '',
  '・ホストとして入るのは、ホスト担当の1人だけです。ほかの方は［Zoomに参加］から入ります。',
  '・Zoom に「進行中のミーティングがあります」と出たら、同じ Zoom アカウントで別の会議が開かれています。',
  '　［終了］を押すと、その会議の全員が退出になります。押さずに閉じて、管理部門に連絡してください。',
  '',
  '開始しますか？',
].join('\n');

const RESTART_CONFIRM = [
  'この会議は、すでに始まっています。',
  '',
  '参加するだけなら［キャンセル］を押して、［Zoomに参加］から入ってください。',
  '回線が切れたなどで、ホスト担当ご本人が入り直すときだけ［OK］を押してください。',
].join('\n');

export default function ZoomButtons({ row }: { row: PreshareRow }) {
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState('');
  const join = zoomJoinHref(row.zoomJoinUrl);
  if (!join) return null;

  async function request(force: boolean): Promise<'done' | 'already_started'> {
    // 開始用URLを取ってから開くと、ブラウザに「勝手に開いた窓」とみなされて止められることがある。
    // 押した直後（確認に答えた直後）に空のタブを開いておき、URLが取れたらそこへ移す。
    const tab = window.open('', '_blank');
    try {
      const res = await fetch('/api/zoom/meetings/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preshareId: row.id, force }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok && typeof j.url === 'string') {
        if (tab) {
          tab.opener = null;
          tab.location.href = j.url;
        } else {
          window.location.href = j.url;
        }
        return 'done';
      }
      tab?.close();
      if (j?.reason === 'already_started') return 'already_started';
      setErr(zoomErrorText(j?.reason));
    } catch {
      tab?.close();
      setErr('Zoom を開始できませんでした。通信状況をご確認ください。');
    }
    return 'done';
  }

  async function start() {
    if (starting) return;
    setErr('');
    if (!window.confirm(START_CONFIRM)) return;
    setStarting(true);
    try {
      const r = await request(false);
      // すでに開かれていた。入り直すかを確かめてから、もう一度だけ取りに行く。
      if (r === 'already_started' && window.confirm(RESTART_CONFIRM)) await request(true);
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      {row.canHost && (
        <button className="zoom-btn host" onClick={() => void start()} disabled={starting}>
          {starting ? '開いています…' : 'ホストとして開始'}
        </button>
      )}
      {/* 参加ボタンは全員に出す。ホスト担当の人には、開始ボタンと見分けがつく名前にする */}
      <a className={row.canHost ? 'zoom-btn sub' : 'zoom-btn'} href={join} target="_blank" rel="noopener noreferrer">
        {row.canHost ? '参加者として入る' : 'Zoomに参加'}
      </a>
      {row.zoomHost && (
        <span className="zoom-host" title="ホストとして開始できるのは、ホスト担当の方だけです">ホスト：{row.zoomHost}</span>
      )}
      {row.hostLoginNeeded && (
        <span className="zoom-err">ホストとして開始するには、共通ログイン（メールとパスワード）で入り直してください。</span>
      )}
      {err && <span className="zoom-err" role="alert">{err}</span>}
    </>
  );
}
