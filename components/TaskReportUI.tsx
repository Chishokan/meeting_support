'use client';

// 重要タスク報告（小中等部の週次）。対象週・校舎を選び、5つの設問に答えて送る。
// 設問の文言は lib/taskReport.ts の QUESTIONS にある。

import { useState, type FormEvent } from 'react';
import { MAX_TEXT_LENGTH, QUESTIONS, TASK_REPORT_DEPT, type TaskAnswers, type WeekOption } from '@/lib/taskReport';

const EMPTY: TaskAnswers = { progress: '', m1: '', m2: '', m3: '', other: '' };
const PLACEHOLDER = 'いつから・誰に・何をしたか。結果は数字で';

const REASONS: Record<string, string> = {
  not_configured: '保存先（スプレッドシート連携の Apps Script）が未設定です。管理者に伝えてください。',
  not_deployed: '保存先のスクリプトが古いままで、保存できませんでした。管理者に Apps Script の再デプロイを依頼してください。',
  forbidden: `${TASK_REPORT_DEPT}の職員だけが報告できます。`,
  bad_week: '対象週を選び直してください。',
  bad_school: '校舎を選び直してください。',
  bad_progress: '1 は 0〜100 の数字で入れてください。',
};

export default function TaskReportUI({
  name, campus, allowed, schools, weeks, defaultWeek,
}: {
  name: string; campus: string; allowed: boolean; schools: string[]; weeks: WeekOption[]; defaultWeek: string;
}) {
  const [week, setWeek] = useState(defaultWeek);
  const [school, setSchool] = useState('');
  const [answers, setAnswers] = useState<TaskAnswers>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState('');

  const weekLabel = weeks.find((w) => w.value === week)?.label ?? week;

  function setAnswer(key: keyof TaskAnswers, value: string) {
    setAnswers((a) => ({ ...a, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const missing = QUESTIONS.filter((q) => q.required && !answers[q.key].trim()).map((q) => q.no);
    if (!school) { setStatus('校舎を選んでください。'); return; }
    if (missing.length) { setStatus(`${missing.join('・')} が入っていません。`); return; }

    setBusy(true);
    setStatus('送信中…');
    try {
      const res = await fetch('/api/task-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, school, answers }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setDone(true);
        setStatus('');
      } else if (j?.reason === 'missing') {
        setStatus(`${(j.missing ?? []).join('・')} が入っていません。`);
      } else {
        setStatus(REASONS[j?.reason] ?? `送信に失敗しました（理由：${j?.reason ?? '不明'}）。`);
      }
    } catch {
      setStatus('通信エラーが発生しました。もう一度送ってください。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="task">
      <div className="page-head">
        <h1>重要タスク報告</h1>
        <p>{campus}／{name} さん。毎週、マイルストーンの進み具合と、そのために実行した改善・工夫を報告します。</p>
      </div>

      <div className="task-body">
        {!allowed ? (
          <p className="task-guide">{TASK_REPORT_DEPT}の職員が使う画面です。</p>
        ) : done ? (
          <div className="task-done">
            <p>送信しました。{weekLabel}　{school} の報告を受け付けました。</p>
            <p className="task-done-sub">直したいときは出し直してください。同じ週・校舎の報告は、新しいほうを使います。</p>
            <button type="button" onClick={() => setDone(false)}>内容を直して出し直す</button>
          </div>
        ) : (
          <form className="task-form" onSubmit={submit} noValidate>
            <div className="task-selects">
              <label>
                <span>対象週</span>
                <select value={week} onChange={(e) => setWeek(e.target.value)}>
                  {weeks.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
              </label>
              <label>
                <span>校舎</span>
                <select value={school} onChange={(e) => setSchool(e.target.value)}>
                  <option value="">選んでください</option>
                  {schools.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>

            <p className="task-guide">生徒・保護者の名前はイニシャルで書いてください。</p>

            {QUESTIONS.map((q) => (
              <div key={q.key} className="task-q">
                <label htmlFor={`task-${q.key}`} className="task-q-label">
                  <span className="task-no">{q.no}</span>
                  <span>
                    {q.label}
                    {!q.required && <small>（任意）</small>}
                  </span>
                </label>
                {q.key === 'progress' ? (
                  <div className="task-pct">
                    <input
                      id={`task-${q.key}`} type="number" min={0} max={100} step="any" inputMode="decimal"
                      value={answers.progress} onChange={(e) => setAnswer('progress', e.target.value)}
                    />
                    <span>%</span>
                  </div>
                ) : (
                  <textarea
                    id={`task-${q.key}`} maxLength={MAX_TEXT_LENGTH}
                    placeholder={q.key === 'other' ? '' : PLACEHOLDER}
                    value={answers[q.key]} onChange={(e) => setAnswer(q.key, e.target.value)}
                  />
                )}
              </div>
            ))}

            <div className="task-actions">
              <button type="submit" disabled={busy}>{busy ? '送信中…' : '送信する'}</button>
              {status && <span className="task-note">{status}</span>}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
