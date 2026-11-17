'use client';

// 本番レベル模試：模試の設定（/moshi/settings）。回ごとに、模試名・実施日・教科ごとの大問の配点と分野・
// 受験票の時間割・持ち物・注意事項・会場を決める。新しい回は「前の回をもとに作る」と配点・分野・時間割を写せる。
// 成績表に使う「偏差値の換算（県全体の模試の平均点・標準偏差）」と「志望校の判定基準（B判定基準・判定教科・定員）」も
// 回ごとに入れる（どちらも任意）。県一斉模試などの資料は lib/moshi/reference.ts に入れてあり、ボタン1つで写せる。

import { useEffect, useMemo, useState } from 'react';
import {
  CAMPUS_NAMES, DEFAULT_JUDGE_OPTIONS, MAX_JUDGES, MAX_QUESTIONS, MAX_SCHEDULE_ROWS, STAT_KEYS, STAT_NAMES, SUBJECT_KEYS, SUBJECT_NAMES,
  campusInfo, choiceKey, cloneOutside, examMax, jpDate, newExamDraft, normalizeChoice, parseRule, ruleMax, subjectMax,
  type JudgeLine, type MoshiExam, type StatKey, type SubjectKey,
} from '@/lib/moshi/model';
import { SCHOOLS, schoolName, toKenCode } from '@/lib/moshi/schools';
import { REFERENCES, refSchoolFor, type Reference, type RefSchool } from '@/lib/moshi/reference';
import { PageHead, StateNote, examOptionLabel, reasonText, useMoshiData } from './MoshiShared';

type Draft = ReturnType<typeof newExamDraft> & { id?: string };

function draftOf(e: MoshiExam): Draft {
  return {
    id: e.id, name: e.name, grade: e.grade, date: e.date,
    subjects: e.subjects.map((s) => ({ key: s.key, questions: s.questions.map((q) => ({ ...q })) })),
    schedule: e.schedule.map((s) => ({ ...s })), belongings: e.belongings, notes: e.notes, venues: { ...e.venues },
    outside: cloneOutside(e.outside),
    judges: (e.judges ?? []).map((j) => ({ ...j })),
    judgeOptions: { ...DEFAULT_JUDGE_OPTIONS, ...(e.judgeOptions ?? {}) },
  };
}

function emptyJudge(code: string): JudgeLine {
  return { code, ref: '', refName: '', rule: '', bDev: null, bScore: null, capacity: null };
}

/** 参考データの学校の値を、判定基準の行に写す（定員はそのまま）。 */
function fromRef(j: JudgeLine, s: RefSchool): JudgeLine {
  return { ...j, ref: s.ref, refName: s.name, rule: s.rule, bDev: s.bDev, bScore: s.bScore };
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
  const [refId, setRefId] = useState(REFERENCES[0]?.id ?? '');
  const reference: Reference | undefined = REFERENCES.find((r) => r.id === refId);

  function setJudge(i: number, patch: Partial<JudgeLine>) {
    setDraft((d) => d && ({ ...d, judges: d.judges.map((j, n) => (n === i ? { ...j, ...patch } : j)) }));
  }
  /** 志望校コードに当たる参考データの学校（県一斉のコード。前の5桁のコードは対応表で読み替え）。 */
  function refFor(j: Pick<JudgeLine, 'code' | 'ref'>): RefSchool | undefined {
    if (!reference) return undefined;
    return reference.schools.find((x) => x.ref === j.code) ?? (j.ref ? reference.schools.find((x) => x.ref === j.ref) : undefined)
      ?? refSchoolFor(reference, j.code);
  }
  /** 志望校コードを入れたら、参考データに同じ学校があれば判定基準を写す（定員はそのまま）。 */
  function setJudgeCode(i: number, raw: string) {
    const code = normalizeChoice(raw, toKenCode);
    setDraft((d) => d && ({
      ...d,
      judges: d.judges.map((j, n) => {
        if (n !== i) return j;
        const s = refFor({ code, ref: '' });
        return s ? fromRef({ ...j, code }, s) : { ...j, code };
      }),
    }));
  }
  /** 志望校を足す。参考データに同じ学校があれば、B判定基準などを写しておく。 */
  function addJudges(codes: string[]) {
    setDraft((d) => {
      if (!d) return d;
      const have = new Set(d.judges.map((j) => choiceKey(j.code)));
      const add = codes.filter((c) => c === '' || !have.has(choiceKey(c))).map((code) => {
        const s = code ? refFor({ code, ref: '' }) : undefined;
        return s ? fromRef(emptyJudge(code), s) : emptyJudge(code);
      });
      return { ...d, judges: [...d.judges, ...add].slice(0, MAX_JUDGES) };
    });
  }
  /** 参考データを回の設定に写す：換算の平均点・標準偏差と、参考データにある学校の B判定基準・判定教科。 */
  function applyReference() {
    if (!reference || !draft) return;
    const filled = draft.judges.filter((j) => refFor(j)).length;
    if (!window.confirm(`${reference.label}の平均点・標準偏差と、判定基準（${filled}校）を写します。いま入っている値は置きかわります（定員はそのまま）。よろしいですか？`)) return;
    setDraft({
      ...draft,
      outside: { source: reference.label, n: draft.outside.n, mean: { ...reference.mean }, sd: { ...reference.sd } },
      judges: draft.judges.map((j) => {
        const s = refFor(j);
        return s ? fromRef(j, s) : j;
      }),
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
  // 判定基準が入っている、いちばん新しいほかの回
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

            <h2 className="ms-h2">成績表に使う参考データ（任意）</h2>
            <p className="ms-fine">
              本番レベル模試は智翔館の塾生だけが受けるので、県全体の模試の資料（得点ー偏差値 換算表・志望校別判定基準得点一覧）を借りて、
              偏差値・判定・入学後のおよその順位を出します。
            </p>
            {REFERENCES.length > 0 && (
              <div className="ms-ref-bar">
                <select value={refId} onChange={(e) => setRefId(e.target.value)} aria-label="参考データ">
                  {REFERENCES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <button type="button" className="ms-btn ms-btn-sub" onClick={applyReference}>この参考データを入れる</button>
                <span className="ms-fine">平均点・標準偏差と、下の判定基準（基準の学校が決まっている行）を写します</span>
              </div>
            )}

            <h3 className="ms-h3">偏差値の換算（平均点・標準偏差）</h3>
            <p className="ms-fine">
              入れた教科だけ、成績表の平均点をこの値で出し、偏差値をこの平均点と標準偏差で換算します（換算表と同じく 25.0〜75.0）。
              空欄なら、この回を受けた智翔館の受験者で計算します。順位はいつも智翔館の中での順位です。
            </p>
            <div className="ms-outside">
              <label className="ms-field ms-field-wide">
                <span>出典（成績表の下に出ます）</span>
                <input value={draft.outside.source} maxLength={60} placeholder="例）第2回 長崎県一斉模試 2026年10月"
                  onChange={(e) => setDraft({ ...draft, outside: { ...draft.outside, source: e.target.value } })} />
              </label>
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

            <h3 className="ms-h3">志望校の判定基準</h3>
            <p className="ms-fine">
              志望校コード（県一斉模試のコード。例 518-01）を入れると、参考データの B判定基準偏差値・判定教科・B判定基準得点が入ります。
              判定教科の倍率をかけた得点を B判定基準得点と比べ、偏差値 {draft.judgeOptions.step} ずつ上を A、下を C・D、それより下を E とします。
              定員を入れると、入学後のおよその順位（仮想順位：B判定基準偏差値を入学者の真ん中とみて、定員の中で何番目か）が出ます。
            </p>
            <div className="ms-field-row">
              <label className="ms-field">
                <span>判定のあいだの偏差値</span>
                <input type="number" step="0.5" min={0.5} max={20} value={draft.judgeOptions.step}
                  onChange={(e) => setDraft({ ...draft, judgeOptions: { ...draft.judgeOptions, step: Number(e.target.value) || DEFAULT_JUDGE_OPTIONS.step } })} />
              </label>
              <label className="ms-field">
                <span>入学者の偏差値のばらつき</span>
                <input type="number" step="0.5" min={0.5} max={30} value={draft.judgeOptions.spread}
                  onChange={(e) => setDraft({ ...draft, judgeOptions: { ...draft.judgeOptions, spread: Number(e.target.value) || DEFAULT_JUDGE_OPTIONS.spread } })} />
              </label>
            </div>
            <datalist id="ms-schools-settings">
              {SCHOOLS.map((sc) => <option key={sc.code} value={sc.code}>{sc.name}</option>)}
            </datalist>
            {draft.judges.length > 0 && (
              <div className="ms-judge-wrap">
                <table className="ms-qtable ms-judge-table">
                  <thead>
                    <tr>
                      <th>志望校コード</th><th>学校</th><th>判定教科</th>
                      <th>B判定<br />基準偏差値</th><th>B判定<br />基準得点</th><th>満点</th><th>定員</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.judges.map((j, i) => {
                      const w = j.rule ? parseRule(j.rule) : parseRule('5科合計');
                      return (
                        <tr key={i}>
                          <td><input list="ms-schools-settings" value={j.code} placeholder="例）518-01"
                            onChange={(e) => setJudge(i, { code: e.target.value })} onBlur={(e) => setJudgeCode(i, e.target.value)} /></td>
                          <td className="ms-judge-name">
                            {schoolName(j.code)}
                            {j.refName && j.ref !== j.code && <small className="ms-judge-ref">基準：{j.ref} {j.refName}</small>}
                          </td>
                          <td><input className={`ms-rule-in${j.rule && !w ? ' bad' : ''}`} value={j.rule} placeholder="5科合計" maxLength={30}
                            title="5科合計・3科合計・国数のみ・国数英1.5倍・英数2倍、国理1.5倍 など"
                            onChange={(e) => setJudge(i, { rule: e.target.value })} /></td>
                          <td><input type="number" step="1" min={0} className="num" value={j.bDev ?? ''}
                            onChange={(e) => setJudge(i, { bDev: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                          <td><input type="number" step="1" min={0} className="num" value={j.bScore ?? ''}
                            onChange={(e) => setJudge(i, { bScore: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                          <td className="num">{w ? ruleMax(draft as MoshiExam, w) : '—'}</td>
                          <td><input type="number" step="1" min={1} className="num" value={j.capacity ?? ''} placeholder="人"
                            onChange={(e) => setJudge(i, { capacity: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                          <td><button type="button" className="ms-x" onClick={() => setDraft({ ...draft, judges: draft.judges.filter((_, n) => n !== i) })}>消す</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="ms-toolbar">
              <button type="button" className="ms-link" onClick={() => addJudges([''])} disabled={draft.judges.length >= MAX_JUDGES}>＋ 学校を足す</button>
              {choiceCodes.length > 0 && (
                <button type="button" className="ms-link" onClick={() => addJudges(choiceCodes)}>＋ この回の受験者の志望校をまとめて足す（{choiceCodes.length}校）</button>
              )}
              {prevJudges && (
                <button type="button" className="ms-link" onClick={() => {
                  if (draft.judges.length && !window.confirm(`今の判定基準を消して、${prevJudges.name}の判定基準（定員も）を写します。よろしいですか？`)) return;
                  setDraft({ ...draft, judges: prevJudges.judges.map((j) => ({ ...j })), judgeOptions: { ...DEFAULT_JUDGE_OPTIONS, ...prevJudges.judgeOptions } });
                }}>{prevJudges.name}の判定基準を写す</button>
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
