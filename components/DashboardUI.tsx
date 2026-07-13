'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string };
type Thread = { id: string; title: string; updatedAt: string; messages: Msg[] };

const STORE_KEY = 'chishokan_minutes_v1';

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return '';
  }
}

export default function DashboardUI({ name, campus }: { name: string; campus: string }) {
  const [threads, setThreads] = useState<Thread[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      setThreads(Array.isArray(arr) ? arr : []);
    } catch {
      setThreads([]);
    }
  }, []);

  const allText = threads.flatMap((t) => t.messages).map((m) => m.content).join('\n');
  const openTodos = (allText.match(/- \[ \]/g) || []).length;
  const doneTodos = (allText.match(/- \[x\]/gi) || []).length;
  const recent = [...threads].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 5);

  return (
    <div className="dash">
      <div className="page-head">
        <h1>🏠 ダッシュボード</h1>
        <p>{campus}／{name} さん、おつかれさまです。会議準備の状況をまとめます。</p>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-num">{threads.length}</div>
          <div className="stat-label">議事録スレッド</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{openTodos}</div>
          <div className="stat-label">未完了ToDo</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{doneTodos}</div>
          <div className="stat-label">完了ToDo</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-panel">
          <h2>クイックスタート</h2>
          <div className="quick-links">
            <Link href="/chat" className="quick-link">
              <span className="ql-icon">💬</span>
              <span>
                <b>AI壁打ちで事前報告をつくる</b>
                <small>会議前の報告を対話で整理</small>
              </span>
            </Link>
            <Link href="/minutes" className="quick-link">
              <span className="ql-icon">📝</span>
              <span>
                <b>議事録を整形する</b>
                <small>会議メモを決定事項・ToDoに</small>
              </span>
            </Link>
          </div>
        </div>

        <div className="dash-panel">
          <h2>直近の議事録</h2>
          {recent.length === 0 ? (
            <p className="dash-empty">まだ議事録はありません。<Link href="/minutes">議事録スレッド</Link>から作成できます。</p>
          ) : (
            <ul className="recent-list">
              {recent.map((t) => (
                <li key={t.id}>
                  <Link href="/minutes">{t.title}</Link>
                  <span className="recent-date">{fmtDate(t.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dash-panel soon-panel">
          <h2>未提出リマインド <span className="nav-badge">準備中</span></h2>
          <p className="dash-empty">
            会議前に、事前報告が未提出のメンバーを一覧表示します（次フェーズ）。<br />
            職員マスタ連携とスプレッドシート集計で実装予定です。
          </p>
        </div>
      </div>
    </div>
  );
}
