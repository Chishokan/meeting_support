'use client';

// 本番レベル模試：模試の設定（/moshi/settings）。回ごとに、模試名・実施日・教科ごとの大問の配点と分野・
// 受験票の時間割・持ち物・注意事項・会場を決める。新しい回は「前の回をもとに作る」と配点・分野・時間割を写せる。
// 成績表に使う「業者の全体集計（母数・平均点・標準偏差）」と「志望校の判定ライン」も回ごとに入れる（どちらも任意）。

import { useEffect, useMemo, useState } from 'react';
import {
  CAMPUS_NAMES, JUDGE_GRADES, MAX_JUDGES, MAX_QUESTIONS, MAX_SCHEDULE_ROWS, STAT_KEYS, STAT_NAMES, SUBJECT_KEYS, SUBJECT_NAMES,
  campusInfo, choiceKey, examMax, jpDate, newExamDraft, normalizeChoice, subjectMax,
  type JudgeLine, type MoshiExam, type StatKey, type SubjectKey,
} from '@/lib/moshi/model';
import { SCHOOLS, schoolName } from '@/lib/moshi/schools';
import { PageHead, StateNote, examOptionLabel, reasonText, useMoshiData } from './MoshiShared';

type Draft = ReturnType<typeof newExamDraft> & { id?: string };

function draftOf(e: MoshiExam): Draft {
  return {
    id: e.id, name: e.name, grade: e.grade, date: e.date,
    subjects: e.subjects.map((s) => ({ key: s.key, questions: s.questions.map((q) => ({ ...q })) })),
    schedule: e.schedule.map((s) => ({ ...s })), belongings: e.belongings, notes: e.notes, venues: { ...e.venues },
    outside: { n: e.outside?.n ?? null, mean: { ...(e.outside?.mean ?? {}) }, sd: { ...(e.outside?.sd ?? {}) } },
    judges: (e.judges ?? []).map((j) => ({ ...j })),
  };
}

export default function MoshiSettingsUI({ name }: { name: string }) {
  const { state, reload, setExams } = useMoshiData();
  const exams = state.status === 'ready' ? state.exams : [];
  const results = state.status === 'ready' ? state.results : [];
  const [selected, setSelected] = useState<string>('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [base, setBase] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (state.status !== 'ready' || draft) return;
    if (exams.length) { setSelected(exams[0].id); setDraft(draftOf(exams[0])); }
    else { setSelected('new'); setDraft(newExamDraft(null)); }
  }, [state.status, exams, draft]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of results) m.set(r.examId, (m.get(r.examId) ?? 0) + 1);
    return m;
  }, [results]);
  const current = exams.find((e) => e.id === selected) ?? null;
  const resultCount = current ? counts.get(current.id) ?? 0 : 0;

  function open(id: string) {
    setMsg('');
    setSelected(id);
    if (id === 'new') {
      const b = exams[0] ?? null;
      setBase(b?.id ?? '');
      setDraft(newExamDraft(b));
    } else {
      const e = exams.find((x) => x.id === id);
      if (e) setDraft(draftOf(e));
    }
  }

  function setQ(k: SubjectKey, i: number, patch: Partial<{ max: number; topic: string }>) {
    setDraft((d) => d && ({
      ...d,
      subjects: d.subjects.map((s) => (s.key !== k ? s : { ...s, questions: s.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) })),
    }));
  }
  function addQ(k: SubjectKey) {
    setDraft((d) => d && ({ ...d, subjects: d.subjects.map((s) => (s.key !== k ? s : { ...s, questions: [...s.questions, { max: 10, topic: '' }] })) }));
  }
  function removeQ(k: SubjectKey, i: number) {
    setDraft((d) => d && ({ ...d, subjects: d.subjects.map((s) => (s.key !== k ? s : { ...s, questions: s.questions.filter((_, j) => j !== i) })) }));
  }

  function setOutside(kind: 'mean' | 'sd', k: StatKey, v: string) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d.outside, [kind]: { ...d.outside[kind] } };
      if (v === '') delete next[kind][k]; else next[kind][k] = Number(v);
      return { ...d, outside: next };
    });
  }
  function setJudge(i: number, patch: Partial<JudgeLine>) {
    setDraft((d) => d && ({ ...d, judges: d.judges.map((j, n) => (n === i ? { ...j, ...patch } : j)) }));
  }
  function addJudges(codes: string[]) {
    setDraft((d) => {
      if (!d) return d;
      const have = new Set(d.judges.map((j) => choiceKey(j.code)));
      const add = codes.filter((c) => c && !have.has(choiceKey(c))).map((code) => ({ code, A: null, B: null, C: null, D: null }));
      return { ...d, judges: [...d.judges, ...add].slice(0, MAX_JUDGES) };
    });
  }
  // この回の受験者が志望校に書いた学校（多い順）
  const choiceCodes = useMemo(() => {
    if (!current) return [] as string[];
    const n = new Map<string, number>();
    for (const r of results) {
      if (r.examId !== current.id) continue;
      for (const c of r.choices) if (c) n.set(c, (n.get(c) ?? 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [results, current]);
  // 判定ラインが入っている、いちばん新しいほかの回
  const prevJudges = exams.find((e) => e.id !== current?.id && (e.judges ?? []).length) ?? null;

  async function submit() {
    if (!draft || busy) return;
    if (!draft.name.trim()) { setMsg('模試名を入れてください。'); return; }
    if (current && resultCount) {
      const changed = SUBJECT_KEYS.filter((k) => (current.subjects.find((s) => s.key === k)?.questions.length ?? 0) !== (draft.subjects.find((s) => s.key === k)?.questions.length ?? 0));
      if (changed.length && !window.confirm(`${changed.map((k) => SUBJECT_NAMES[k]).join('・')}の大問の数が変わります。すでに入っている得点は、前から順に新しい大問に当てはめます（後ろの大問の得点は見えなくなります）。よろしいですか？`)) return;
    }
    setBusy(true);
    setMsg('保存中…');
    try {
      const res = await fetch('/api/moshi/exams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const j = await res.json().catch(() => null);
      if (!j?.ok) { setMsg(reasonText(j?.reason, j?.detail)); return; }
      const saved = j.exam as MoshiExam;
      setExams((es) => [...es.filter((e) => e.id !== saved.id), saved]);
      setSelected(saved.id);
      setDraft(draftOf(saved));
      setMsg('保存しました。');
    } catch {
      setMsg(reasonText('network_error'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!current || busy) return;
    if (!window.confirm(`「${current.name}」を消します。よろしいですか？`)) return;
    let force = '';
    if (resultCount) {
      if (!window.confirm(`この回には ${resultCount}人分の成績が入っています。成績ごと見えなくなります（スプレッドシートには残ります）。本当に消しますか？`)) return;
      force = '&force=1';
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/moshi/exams?id=${encodeURIComponent(current.id)}${force}`, { method: 'DELETE' });
      const j = await res.json().catch(() => null);
      if (!j?.ok) { setMsg(reasonText(j?.reason)); return; }
      setExams((es) => es.filter((e) => e.id !== current.id));
      setDraft(null);
      setSelected('');
      setMsg('消しました。');
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (state.status !== 'ready') {
    return (
      <div className="ms">
        <PageHead title="本番レベル模試｜模試の設定" desc="回ごとの配点・分野・受験票の時間割を決めます。" name={name} />
        <div className="ms-body"><StateNote state={state} onRetry={reload} /></div>
      </div>
    );
  }

  const total = draft ? draft.subjects.reduce((a, s) => a + s.questions.reduce((b, q) => b + (Number(q.max) || 0), 0), 0) : 0;

  return (
    <div className="ms">
      <PageHead title="本番レベル模試｜模試の設定" desc="回ごとの配点・分野・受験票の時間割を決めます。新しい回は前の回をもとに作れます。" name={name} />
      <div className="ms-body ms-settings">
        <aside className="ms-exam-list">
          <button type="button" className={`ms-exam-item new${selected === 'new' ? ' on' : ''}`} onClick={() => open('new')}>＋ 新しい回を作る</button>
          {exams.map((e) => (
            <button key={e.id} type="button" className={`ms-exam-item${selected === e.id ? ' on' : ''}`} onClick={() => open(e.id)}>
              <b>{e.name}</b>
              <small>{e.date ? jpDate(e.date) : '実施日 未定'}・成績 {counts.get(e.id) ?? 0}人</small>
            </button>
          ))}
        </aside>

        {draft && (
          <div className="ms-form">
            {selected === 'new' && exams.length > 0 && (
              <label className="ms-field">
                <span>もとにする回（配点・分野・時間割・持ち物を写す）</span>
                <select value={base} onChange={(e) => {
                  const b = exams.find((x) => x.id === e.target.value) ?? null;
                  setBase(e.target.value);
                  setDraft((d) => ({ ...newExamDraft(b), name: d?.name ?? '', date: d?.date ?? '' }));
                }}>
                  {exams.map((e) => <option key={e.id} value={e.id}>{examOptionLabel(e)}</option>)}
                  <option value="">使わない（2026年11月の配点から始める）</option>
                </select>
              </label>
            )}
            <div className="ms-field-row">
              <label className="ms-field grow">
                <span>模試名</span>
                <input value={draft.name} maxLength={60} placeholder="例）2026 本番レベル模試 12月" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="ms-field">
                <span>学年</span>
                <input value={draft.grade} maxLength={10} onChange={(e) => setDraft({ ...draft, grade: e.target.value })} />
              </label>
              <label className="ms-field">
                <span>実施日</span>
                <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
              </label>
            </div>

            <h2 className="ms-h2">配点と出題分野 <small>合計 {total}点</small></h2>
            <p className="ms-fine">大問ごとに配点と分野を入れます。分野は成績表の「大問別の得点」と面談の「得意・伸ばしたい分野」に出ます。</p>
            <div className="ms-subj-grid">
              {draft.subjects.map((s) => {
                const sum = s.questions.reduce((a, q) => a + (Number(q.max) || 0), 0);
                return (
                  <section key={s.key} className="ms-subj-card">
                    <h3>{SUBJECT_NAMES[s.key]} <small className={sum === 100 ? '' : 'warn'}>{sum}点{sum !== 100 && '（100点ではありません）'}</small></h3>
                    <table className="ms-qtable">
                      <thead><tr><th>大問</th><th>分野</th><th>配点</th><th></th></tr></thead>
                      <tbody>
                        {s.questions.map((q, i) => (
                          <tr key={i}>
                            <td className="num">{i + 1}</td>
                            <td><input value={q.topic} maxLength={30} placeholder="例）小説" onChange={(e) => setQ(s.key, i, { topic: e.target.value })} /></td>
                            <td><input className="num" inputMode="numeric" value={String(q.max)} onChange={(e) => setQ(s.key, i, { max: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></td>
                            <td><button type="button" className="ms-x" disabled={s.questions.length <= 1} onClick={() => removeQ(s.key, i)}>消す</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {s.questions.length < MAX_QUESTIONS && <button type="button" className="ms-link" onClick={() => addQ(s.key)}>＋ 大問を足す</button>}
                  </section>
                );
              })}
            </div>

            <h2 className="ms-h2">受験票</h2>
            <div className="ms-two">
              <div>
                <h3 className="ms-h3">時間割</h3>
                <table className="ms-qtable">
                  <thead><tr><th>内容</th><th>時刻</th><th></th></tr></thead>
                  <tbody>
                    {draft.schedule.map((row, i) => (
                      <tr key={i}>
                        <td><input value={row.label} maxLength={20} placeholder="例）国語" onChange={(e) => setDraft({ ...draft, schedule: draft.schedule.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></td>
                        <td><input value={row.time} maxLength={30} placeholder="例）9:00〜9:50" onChange={(e) => setDraft({ ...draft, schedule: draft.schedule.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)) })} /></td>
                        <td><button type="button" className="ms-x" onClick={() => setDraft({ ...draft, schedule: draft.schedule.filter((_, j) => j !== i) })}>消す</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {draft.schedule.length < MAX_SCHEDULE_ROWS && (
                  <button type="button" className="ms-link" onClick={() => setDraft({ ...draft, schedule: [...draft.schedule, { label: '', time: '' }] })}>＋ 行を足す（受付・休憩など）</button>
                )}
              </div>
              <div>
                <label className="ms-field">
                  <span>持ち物</span>
                  <textarea value={draft.belongings} maxLength={600} rows={3} onChange={(e) => setDraft({ ...draft, belongings: e.target.value })} />
                </label>
                <label className="ms-field">
                  <span>注意事項</span>
                  <textarea value={draft.notes} maxLength={600} rows={4} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                </label>
              </div>
            </div>
            <h3 className="ms-h3">会場（空欄なら「智翔館 ○○校」）</h3>
            <div className="ms-venues">
              {CAMPUS_NAMES.map((c) => (
                <label key={c} className="ms-field">
                  <span>{campusInfo(c)?.label}</span>
                  <input
                    value={draft.venues[c] ?? ''} maxLength={40}
                    placeholder={`智翔館 ${campusInfo(c)?.label ?? c}`}
                    onChange={(e) => setDraft({ ...draft, venues: { ...draft.venues, [c]: e.target.value } })}
                  />
                </label>
              ))}
            </div>

            <h2 className="ms-h2">成績表に使う数字（任意）</h2>
            <h3 className="ms-h3">模試業者の全体の集計</h3>
            <p className="ms-fine">
              入れた教科だけ、成績表の平均点・母数をこの値で出します。偏差値は平均点と標準偏差の両方があるときにこの値で計算します。
              空欄なら、この回を受けた智翔館の受験者で計算します（順位はいつも智翔館の中での順位）。
            </p>
            <div className="ms-outside">
              <label className="ms-field">
                <span>母数（受験者数）</span>
                <input type="number" min={0} inputMode="numeric" value={draft.outside.n ?? ''}
                  onChange={(e) => setDraft({ ...draft, outside: { ...draft.outside, n: e.target.value === '' ? null : Number(e.target.value) } })} />
              </label>
              <table className="ms-qtable ms-outside-table">
                <thead><tr><th></th>{STAT_KEYS.map((k) => <th key={k}>{STAT_NAMES[k]}</th>)}</tr></thead>
                <tbody>
                  {(['mean', 'sd'] as const).map((kind) => (
                    <tr key={kind}>
                      <th>{kind === 'mean' ? '平均点' : '標準偏差'}</th>
                      {STAT_KEYS.map((k) => (
                        <td key={k}>
                          <input type="number" step="0.1" min={0} className="num" value={draft.outside[kind][k] ?? ''}
                            onChange={(e) => setOutside(kind, k, e.target.value)} aria-label={`${STAT_NAMES[k]}の${kind === 'mean' ? '平均点' : '標準偏差'}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="ms-h3">志望校の判定ライン（五教科の点）</h3>
            <p className="ms-fine">A の点以上で A 判定、B の点以上で B 判定 … D の点より下は E 判定。成績表の志望校判定に「判定」と「あと何点で次の判定か」が出ます。ラインの無い学校は空欄のまま出ます。</p>
            <datalist id="ms-schools-settings">
              {SCHOOLS.map((sc) => <option key={sc.code} value={sc.code}>{sc.name}</option>)}
            </datalist>
            {draft.judges.length > 0 && (
              <table className="ms-qtable ms-judge-table">
                <thead><tr><th>志望校コード</th><th>学校</th>{JUDGE_GRADES.map((g) => <th key={g}>{g}</th>)}<th></th></tr></thead>
                <tbody>
                  {draft.judges.map((j, i) => (
                    <tr key={i}>
                      <td><input list="ms-schools-settings" value={j.code} placeholder="コードか学校名"
                        onChange={(e) => setJudge(i, { code: e.target.value })} onBlur={(e) => setJudge(i, { code: normalizeChoice(e.target.value) })} /></td>
                      <td className="ms-judge-name">{schoolName(j.code)}</td>
                      {JUDGE_GRADES.map((g) => (
                        <td key={g}><input type="number" min={0} className="num" value={j[g] ?? ''} aria-label={`${schoolName(j.code)} ${g}`}
                          onChange={(e) => setJudge(i, { [g]: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                      ))}
                      <td><button type="button" className="ms-x" onClick={() => setDraft({ ...draft, judges: draft.judges.filter((_, n) => n !== i) })}>消す</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="ms-toolbar">
              <button type="button" className="ms-link" onClick={() => addJudges([''])} disabled={draft.judges.length >= MAX_JUDGES}>＋ 学校を足す</button>
              {choiceCodes.length > 0 && (
                <button type="button" className="ms-link" onClick={() => addJudges(choiceCodes)}>＋ この回の受験者の志望校をまとめて足す（{choiceCodes.length}校）</button>
              )}
              {prevJudges && (
                <button type="button" className="ms-link" onClick={() => {
                  if (draft.judges.length && !window.confirm(`今のラインを消して、${prevJudges.name}の判定ラインを写します。よろしいですか？`)) return;
                  setDraft({ ...draft, judges: prevJudges.judges.map((j) => ({ ...j })) });
                }}>{prevJudges.name}の判定ラインを写す</button>
              )}
            </div>

            <div className="ms-actions">
              <button type="button" className="ms-btn" disabled={busy} onClick={submit}>{selected === 'new' ? 'この回を作る' : '保存する'}</button>
              {current && <button type="button" className="ms-btn ms-btn-danger" disabled={busy} onClick={remove}>この回を消す</button>}
              {msg && <span className="ms-msg">{msg}</span>}
            </div>
            {current && (
              <p className="ms-fine">5教科 {examMax(current)}点満点（{SUBJECT_KEYS.map((k) => `${SUBJECT_NAMES[k]}${subjectMax(current, k)}`).join('・')}）。最後に直した人：{current.updatedBy || '—'}（{current.updatedAt || '—'}）</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
