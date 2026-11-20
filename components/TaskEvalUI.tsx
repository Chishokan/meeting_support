'use client';

// 重要タスク評価のダウンロード（小中等部）。週ごとに、評価の A4版（PDF）を保存できる。
// 一覧と中身はサーバ（/api/task-eval・/api/task-eval/download）が評価フォルダから読む。

import { useEffect, useState } from 'react';
import { TASK_EVAL_DEPT, type EvalWeek } from '@/lib/taskEval';

const REASONS: Record<string, string> = {
  not_configured: '読み込み先（Apps Script）が未設定です。管理者に伝えてください。',
  not_deployed: '読み込み先のスクリプトが古いままです。管理者に Apps Script の再デプロイを依頼してください。',
  not_allowed: '評価フォルダを読めませんでした。管理者に伝えてください。',
  forbidden: `${TASK_EVAL_DEPT}の職員だけが使えます。`,
  not_found: 'ファイルが見つかりませんでした。画面を読み直してください。',
  too_large: 'ファイルが大きすぎて渡せませんでした。管理者に伝えてください。',
  timeout: '時間がかかりすぎました。もう一度押してください。',
};

function reasonText(reason: unknown): string {
  return REASONS[String(reason)] ?? `読み込めませんでした（理由：${reason ?? '不明'}）。`;
}

function dateText(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export default function TaskEvalUI({ name, campus, allowed }: { name: string; campus: string; allowed: boolean }) {
  const [weeks, setWeeks] = useState<EvalWeek[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(''); // ダウンロード中のファイル ID
  const [status, setStatus] = useState<{ week: string; text: string } | null>(null);

  async function load() {
    setLoadError('');
    setWeeks(null);
    try {
      const res = await fetch('/api/task-eval', { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) setWeeks(j.weeks ?? []);
      else setLoadError(reasonText(j?.reason));
    } catch {
      setLoadError('通信エラーが発生しました。読み直してください。');
    }
  }

  useEffect(() => {
    if (allowed) load();
  }, [allowed]);

  async function download(week: EvalWeek) {
    if (busy) return;
    setBusy(week.pdf.id);
    setStatus(null);
    try {
      const res = await fetch(`/api/task-eval/download?id=${encodeURIComponent(week.pdf.id)}`, { cache: 'no-store' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setStatus({ week: week.week, text: reasonText(j?.reason) });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = week.pdf.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setStatus({ week: week.week, text: '通信エラーが発生しました。もう一度押してください。' });
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="task">
      <div className="page-head">
        <h1>重要タスク評価</h1>
        <p>{campus}／{name} さん。毎週の重要タスク評価（A4版の PDF）を保存できます。</p>
      </div>

      <div className="task-body">
        {!allowed ? (
          <p className="task-guide">{TASK_EVAL_DEPT}の職員が使う画面です。</p>
        ) : (
          <div className="teval">
            <p className="task-guide">
              毎週日曜に、前の週（月〜土）の重要タスク報告と数字をもとに作って置きます。評価するのは校舎の計画と報告で、個人ではありません。社外秘の数字を含むので、社外に出さないでください。
            </p>

            {loadError ? (
              <div className="teval-error">
                <span>{loadError}</span>
                <button type="button" onClick={load}>読み直す</button>
              </div>
            ) : weeks === null ? (
              <p className="teval-empty">読み込み中…</p>
            ) : weeks.length === 0 ? (
              <p className="teval-empty">まだ評価がありません。</p>
            ) : (
              <ul className="teval-list">
                {weeks.map((w, i) => (
                  <li key={w.week} className="teval-week">
                    <div className="teval-head">
                      <span className="teval-label">{w.label} の評価</span>
                      {i === 0 && <span className="teval-new">最新</span>}
                      <span className="teval-date">{dateText(w.created)} 作成</span>
                    </div>
                    <div className="teval-actions">
                      <button type="button" disabled={!!busy} onClick={() => download(w)}>
                        {busy === w.pdf.id ? '準備中…' : 'A4版（PDF）をダウンロード'}
                      </button>
                    </div>
                    {status?.week === w.week && <p className="task-note">{status.text}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
