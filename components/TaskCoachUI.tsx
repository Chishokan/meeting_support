'use client';

// AI壁打ち。校舎と項目を選ぶ → 評価の要点を見る → AI と会話する → 行動計画の案を作る →
// 秋～冬行動計画に書き込む／Word ファイルにする、を1画面で行う。会話はこの画面の中だけ（保存しない）。

import { useEffect, useRef, useState } from 'react';
import {
  COACH_DEPT, COACH_SCHOOLS, itemOptions, PLAN_KINDS,
  type CoachPlan, type DateOption, type PlanKind, type TaskEvaluation,
} from '@/lib/taskCoach';

type Msg = { role: 'user' | 'assistant'; content: string };
type WriteResult = { date: string; kind: string; text: string; status: 'written' | 'skipped' | 'not_found'; cell?: string };

const STARTERS = ['この評価の根拠をくわしく教えてください', '来週の行動を一緒に考えたいです'];

const REASONS: Record<string, string> = {
  not_configured: '保存先（スプレッドシート連携の Apps Script）が未設定です。管理者に伝えてください。',
  not_deployed: 'Apps Script が古いままです。管理者に Apps Script の再デプロイを依頼してください。',
  eval_not_configured: '評価シートが設定されていません（Apps Script の TASK_EVAL_BOOK_ID）。',
  eval_open_failed: '評価シートを開けませんでした。Apps Script のアカウントが評価シートを見られるか確認してください。',
  eval_sheet_not_found: 'この校舎のタブが評価シートにありません。',
  no_evaluation: 'この校舎の評価がまだ入っていません。',
  goals_not_configured: '秋～冬行動計画が設定されていません（Apps Script の GOALS_BOOK_ID）。',
  goals_open_failed: '秋～冬行動計画を開けませんでした。',
  goals_sheet_not_found: '「秋～冬行動計画」のタブが見つかりませんでした。',
  forbidden: `${COACH_DEPT}の職員だけが使えます。`,
  bad_date: '日付を選んでいない行があります。',
  no_actions: '行動が1つもありません。',
  bad_plan: '行動計画の案を読み取れませんでした。もう一度［行動計画の案を作る］を押してください。',
  ai_error: 'AI の返事を受け取れませんでした。もう一度お試しください。',
};
const reasonText = (r?: string) => REASONS[r ?? ''] ?? `うまくいきませんでした（理由：${r ?? '不明'}）。`;

export default function TaskCoachUI({ name, campus }: { name: string; campus: string }) {
  const [school, setSchool] = useState('');
  const [item, setItem] = useState('all');
  const [ev, setEv] = useState<TaskEvaluation | null>(null);
  const [dates, setDates] = useState<DateOption[]>([]);
  const [loadNote, setLoadNote] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<CoachPlan | null>(null);
  const [note, setNote] = useState('');
  const [results, setResults] = useState<WriteResult[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const allowed = campus === COACH_DEPT;

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const items = itemOptions(ev);
  const itemLabel = items.find((o) => o.key === item)?.label ?? '全体';
  const focus = item === 'all' ? null : ev?.actions[Number(item)] ?? null;

  function clearTalk() {
    setMessages([]); setPlan(null); setNote(''); setResults([]);
  }
  function okToReset(): boolean {
    return messages.length === 0 || window.confirm('会話を最初からにします。よろしいですか？');
  }

  async function pickSchool(next: string) {
    if (!okToReset()) return;
    clearTalk(); setSchool(next); setItem('all'); setEv(null);
    if (!next) return;
    setLoadNote('評価を読み込んでいます…');
    try {
      const res = await fetch(`/api/task-coach/evaluation?school=${encodeURIComponent(next)}&fresh=1`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setLoadNote(reasonText(j?.reason)); return; }
      setEv(j.evaluation); setDates(j.dates ?? []); setLoadNote('');
    } catch {
      setLoadNote('通信エラーが発生しました。');
    }
  }

  function pickItem(next: string) {
    if (!okToReset()) return;
    clearTalk(); setItem(next);
  }

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy || !ev) return;
    const next: Msg[] = [...messages, { role: 'user', content: t }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput(''); setBusy(true); setNote('');
    try {
      const res = await fetch('/api/task-coach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chat', school, item, messages: next }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(reasonText(j?.reason));
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMessages([...next, { role: 'assistant', content: acc }]);
      }
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: e instanceof Error && e.message !== 'Failed to fetch' ? e.message : '通信エラーが発生しました。' }]);
    } finally {
      setBusy(false);
    }
  }

  async function makePlan() {
    if (busy || messages.length < 2) return;
    setBusy(true); setNote('行動計画の案を作っています…'); setResults([]);
    try {
      const res = await fetch('/api/task-coach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'plan', school, item, messages: messages.filter((m) => m.content) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setNote(reasonText(j?.reason)); return; }
      setPlan(j.plan);
      setNote(j.plan.actions.some((a: { date: string }) => !a.date) ? '日付が決まっていない行があります。日付を選んでください。' : '');
    } catch {
      setNote('通信エラーが発生しました。');
    } finally {
      setBusy(false);
    }
  }

  function editAction(i: number, patch: Partial<{ date: string; kind: PlanKind; text: string }>) {
    if (!plan) return;
    setPlan({ ...plan, actions: plan.actions.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
    setResults([]);
  }
  function removeAction(i: number) {
    if (!plan) return;
    setPlan({ ...plan, actions: plan.actions.filter((_, k) => k !== i) });
  }
  function addAction() {
    if (!plan) return;
    setPlan({ ...plan, actions: [...plan.actions, { date: '', kind: '外部', text: '' }] });
  }

  function readyPlan(): CoachPlan | null {
    if (!plan) return null;
    const actions = plan.actions.filter((a) => a.text.trim());
    if (!actions.length) { setNote(REASONS.no_actions); return null; }
    if (actions.some((a) => !a.date)) { setNote(REASONS.bad_date); return null; }
    return { ...plan, actions };
  }

  async function writePlan() {
    const p = readyPlan();
    if (!p || busy) return;
    if (!window.confirm(`秋～冬行動計画の「${school}」の行に、${p.actions.length}件の行動を「★」付きで書き足します。今ある文は消しません。よろしいですか？`)) return;
    setBusy(true); setNote('書き込んでいます…');
    try {
      const res = await fetch('/api/task-coach/write', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school, plan: p }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setNote(reasonText(j?.reason)); return; }
      setResults(j.results);
      const n = (j.results as WriteResult[]).filter((r) => r.status === 'written').length;
      setNote(`${n}件を書き込みました。`);
    } catch {
      setNote('通信エラーが発生しました。');
    } finally {
      setBusy(false);
    }
  }

  async function downloadPlan() {
    const p = readyPlan();
    if (!p || busy) return;
    setBusy(true); setNote('ファイルを作っています…');
    try {
      const res = await fetch('/api/task-coach/file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school, itemLabel, plan: p }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setNote(reasonText(j?.reason)); return; }
      const url = URL.createObjectURL(await res.blob());
      // リンクを画面に置いてから押さないと、ブラウザによってはファイル名が付かない
      const a = document.createElement('a');
      a.href = url; a.download = `行動計画の案_${school}.docx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setNote('Word ファイルを作りました。');
    } catch {
      setNote('通信エラーが発生しました。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="coach">
      <div className="page-head">
        <h1>AI壁打ち</h1>
        <p>{campus}／{name} さん。重要タスク評価をもとに、次の行動を AI と一緒に考えます。決まった行動は秋～冬行動計画に書き込めます。</p>
      </div>

      <div className="coach-body">
        {!allowed ? (
          <p className="coach-note">{COACH_DEPT}の職員が使う画面です。</p>
        ) : (
          <>
            <div className="coach-pick">
              <label>
                <span>校舎</span>
                <select value={school} onChange={(e) => void pickSchool(e.target.value)} disabled={busy}>
                  <option value="">選んでください</option>
                  {COACH_SCHOOLS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>
                <span>相談する項目</span>
                <select value={item} onChange={(e) => pickItem(e.target.value)} disabled={busy || !ev}>
                  {items.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </label>
            </div>
            {loadNote && <p className="coach-note">{loadNote}</p>}

            {ev && (
              <details className="coach-eval" open>
                <summary>
                  {focus ? `評価：段階${focus.level}（${focus.levelName}）` : `評価：合計 ${ev.total}点（進捗 ${ev.progressPoint}・行動 ${ev.actionPoint}）`}
                  <small>{ev.period}</small>
                </summary>
                {focus ? (
                  <dl>
                    <dt>判定の根拠</dt><dd>{focus.evidence}</dd>
                    <dt>行動のアドバイス</dt><dd>{focus.advice}</dd>
                  </dl>
                ) : (
                  <ul>
                    {ev.actions.map((a) => <li key={a.name}><b>段階{a.level}</b>　{a.name}</li>)}
                  </ul>
                )}
              </details>
            )}

            {ev && (
              <div className="coach-chat">
                {messages.length === 0 && (
                  <div className="coach-starters">
                    {STARTERS.map((s) => <button key={s} type="button" onClick={() => void send(s)} disabled={busy}>{s}</button>)}
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`msg ${m.role}`}><div className="bubble">{m.content || '…'}</div></div>
                ))}
                <div ref={endRef} />
              </div>
            )}

            {ev && (
              <div className="coach-input">
                <textarea
                  value={input} placeholder="ここに書いて送信（Ctrl＋Enter でも送れます）"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(input); } }}
                />
                <div className="coach-buttons">
                  <button type="button" className="primary-btn" onClick={() => void send(input)} disabled={busy || !input.trim()}>送信</button>
                  <button type="button" onClick={() => void makePlan()} disabled={busy || messages.length < 2}>行動計画の案を作る</button>
                  {messages.length > 0 && (
                    <button type="button" className="text-btn" onClick={() => { if (okToReset()) clearTalk(); }} disabled={busy}>最初からやり直す</button>
                  )}
                </div>
              </div>
            )}

            {plan && (
              <div className="coach-plan">
                <h2>行動計画の案（{school}）</h2>
                <label className="coach-goal">
                  <span>週間目標</span>
                  <input value={plan.goal} onChange={(e) => setPlan({ ...plan, goal: e.target.value })} />
                </label>
                {plan.summary && <p className="coach-summary">{plan.summary}</p>}
                <table>
                  <thead><tr><th>日付</th><th>区分</th><th>行動</th><th /></tr></thead>
                  <tbody>
                    {plan.actions.map((a, i) => (
                      <tr key={i}>
                        <td>
                          <select value={a.date} onChange={(e) => editAction(i, { date: e.target.value })}>
                            <option value="">選ぶ</option>
                            {dates.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                          </select>
                        </td>
                        <td>
                          <select value={a.kind} onChange={(e) => editAction(i, { kind: e.target.value as PlanKind })}>
                            {PLAN_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                          </select>
                        </td>
                        <td><input value={a.text} maxLength={120} onChange={(e) => editAction(i, { text: e.target.value })} /></td>
                        <td><button type="button" className="text-btn" onClick={() => removeAction(i)} aria-label="この行を消す">✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="text-btn" onClick={addAction}>＋ 行を足す</button>
                <div className="coach-buttons">
                  <button type="button" className="primary-btn" onClick={() => void writePlan()} disabled={busy}>秋～冬行動計画に書き込む</button>
                  <button type="button" onClick={() => void downloadPlan()} disabled={busy}>Word ファイルを作る</button>
                </div>
                {results.length > 0 && (
                  <ul className="coach-results">
                    {results.map((r, i) => (
                      <li key={i} className={r.status}>
                        {r.date}・{r.kind}：{r.status === 'written' ? `${r.cell} に書き込みました` : r.status === 'skipped' ? '同じ文がすでにあるので書いていません' : '行動計画にこの日付・区分のセルが見つかりませんでした'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {note && <p className="coach-note">{note}</p>}
          </>
        )}
      </div>
    </div>
  );
}
