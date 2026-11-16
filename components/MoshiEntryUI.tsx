'use client';

// 本番レベル模試：成績入力（/moshi）。入力シートと同じ「1人1行・大問ごとの列」の表で入れる。
//   - 「得点」と「名簿・志望校」の2つの表示。教科を1つに絞ると、その教科の列だけになる（採点した先生が自分の教科だけ入れる）
//   - Enter で下へ、Tab で右へ。スプレッドシートからコピーした得点は、セルに貼り付けると右下へ広げて入る
//   - 入れたら少し置いて自動で保存する（変えた教科・項目だけを送るので、同じ生徒の別の教科を別の先生が同時に入れても消えない）
//   - 名簿は「前の回から写す」か「貼り付けで取り込む」（入力シートの行をそのまま貼れる）
// 計算・読み取りの決まりは lib/moshi/model.ts。

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import {
  SUBJECT_KEYS, SUBJECT_NAMES, byExamNo, campusInfo, campusOfExamNo, emptyScores, examMax, inputSheetRows,
  isPartial, nameKey, nextExamNo, normalizeChoice, normalizeExamNo, normalizeName, parsePaste, parseScore, planPaste, subjectMax,
  subjectOf, subjectTotal, toCsv, toHalf,
  type Gender, type MoshiExam, type MoshiResult, type SubjectKey,
} from '@/lib/moshi/model';
import { SCHOOLS, schoolName, toKenCode } from '@/lib/moshi/schools';
import type { ResultField } from '@/lib/moshi/store';
import {
  ExamCampusBar, PageHead, StateNote, downloadCsv, newId, reasonText, useExamCampus, useMoshiData,
} from './MoshiShared';

type View = 'scores' | 'roster';
type Dirty = { fields: Set<ResultField>; isNew: boolean; ver: number };
type SaveState = { status: 'idle' | 'saving' | 'saved' | 'error'; at?: string; message?: string };

const SAVE_DELAY = 1200;

function cellKey(id: string, k: SubjectKey, i: number) {
  return `${id}|${k}|${i}`;
}

function timeNow() {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

export default function MoshiEntryUI({ name }: { name: string }) {
  const { state, reload, setResults } = useMoshiData();
  const exams = state.status === 'ready' ? state.exams : [];
  const results = state.status === 'ready' ? state.results : [];
  const { exam, examId, campus, pickExam, pickCampus } = useExamCampus(exams, { allowAll: false });

  const [view, setView] = useState<View>('scores');
  const [subj, setSubj] = useState<SubjectKey | 'all'>('all');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [cellText, setCellText] = useState<Record<string, string>>({});
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [pending, setPending] = useState(0);
  const [order, setOrder] = useState<string[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [notice, setNotice] = useState('');

  const resultsRef = useRef<MoshiResult[]>([]);
  const cellTextRef = useRef<Record<string, string>>({});
  const dirty = useRef(new Map<string, Dirty>());
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusAfter = useRef<string | null>(null);
  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { cellTextRef.current = cellText; }, [cellText]);

  // その回・その校舎の行。並びは開いたときの受験番号順を保つ（受験番号を直しても行が跳ねないように）
  const mine = useMemo(() => results.filter((r) => r.examId === examId && r.campus === campus), [results, examId, campus]);
  const fetchedAt = state.status === 'ready' ? state.fetchedAt : '';
  useEffect(() => {
    setOrder(byExamNo(resultsRef.current.filter((r) => r.examId === examId && r.campus === campus)).map((r) => r.id));
  }, [examId, campus, fetchedAt]);
  const rows = useMemo(() => {
    const byId = new Map(mine.map((r) => [r.id, r]));
    const out = order.map((id) => byId.get(id)).filter((r): r is MoshiResult => !!r);
    const seen = new Set(order);
    for (const r of mine) if (!seen.has(r.id)) out.push(r);
    return out;
  }, [mine, order]);

  const visibleKeys: SubjectKey[] = subj === 'all' ? [...SUBJECT_KEYS] : [subj];
  const shownRows = useMemo(() => {
    if (!onlyMissing || !exam) return rows;
    return rows.filter((r) => visibleKeys.some((k) => subjectTotal(r, k) == null || isPartial(exam, r, k)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, onlyMissing, exam, subj]);

  // ---- 保存 ----------------------------------------------------------------

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inFlight.current) return;
    const groups = new Map<string, { payload: { row: MoshiResult; fields: ResultField[] | null }[]; snap: { id: string; ver: number }[] }>();
    for (const [id, d] of dirty.current) {
      const r = resultsRef.current.find((x) => x.id === id);
      if (!r) { dirty.current.delete(id); continue; }
      const fields = [...d.fields];
      if (!d.isNew && !fields.length) continue;
      const g = groups.get(r.examId) ?? { payload: [], snap: [] };
      g.payload.push({ row: r, fields: d.isNew ? null : fields });
      g.snap.push({ id, ver: d.ver });
      groups.set(r.examId, g);
    }
    if (!groups.size) return;
    inFlight.current = true;
    setSave({ status: 'saving' });
    let failed = '';
    for (const [eid, g] of groups) {
      try {
        const res = await fetch('/api/moshi/results', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ examId: eid, rows: g.payload.map((p) => ({ row: toInput(p.row), fields: p.fields })) }),
        });
        const j = await res.json().catch(() => null);
        if (!j?.ok) { failed = reasonText(j?.reason, j?.detail); continue; }
        const meta = new Map((j.items as MoshiResult[]).map((it) => [it.id, it]));
        setResults((rs) => rs.map((r) => {
          const m = meta.get(r.id);
          return m ? { ...r, createdAt: m.createdAt, createdBy: m.createdBy, updatedAt: m.updatedAt, updatedBy: m.updatedBy } : r;
        }));
        for (const s of g.snap) {
          const d = dirty.current.get(s.id);
          if (!d) continue;
          if (d.ver === s.ver) dirty.current.delete(s.id);
          else d.isNew = false; // 送っている間にまた直した → 次の保存で送る
        }
      } catch {
        failed = reasonText('network_error');
      }
    }
    inFlight.current = false;
    setPending(dirty.current.size);
    if (failed) setSave({ status: 'error', message: failed });
    else setSave({ status: 'saved', at: timeNow() });
    if (!failed && dirty.current.size) schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setResults]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { flush(); }, SAVE_DELAY);
  }, [flush]);

  const markDirty = useCallback((id: string, fields: ResultField[], isNew = false) => {
    const d = dirty.current.get(id) ?? { fields: new Set<ResultField>(), isNew: false, ver: 0 };
    fields.forEach((f) => d.fields.add(f));
    d.isNew = d.isNew || isNew;
    d.ver++;
    dirty.current.set(id, d);
    setPending(dirty.current.size);
    schedule();
  }, [schedule]);

  // 保存していない入力があるまま閉じない
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty.current.size || inFlight.current || Object.keys(cellTextRef.current).length) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const updateRow = useCallback((id: string, fn: (r: MoshiResult) => MoshiResult, fields: ResultField[]) => {
    setResults((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));
    markDirty(id, fields);
  }, [setResults, markDirty]);

  // ---- 得点のセル ----------------------------------------------------------

  const examRef = useRef<MoshiExam | null>(null);
  examRef.current = exam;

  /** セルに値を入れる（読めない値・配点超えは赤く残し、保存しない）。 */
  const setCell = useCallback((id: string, k: SubjectKey, i: number, raw: string) => {
    const e = examRef.current;
    if (!e) return;
    const max = subjectOf(e, k).questions[i]?.max ?? 0;
    const p = parseScore(raw, max);
    const key = cellKey(id, k, i);
    if (!p.ok) {
      // 読めない値・配点超えは赤く残し、その大問は空欄として保存する
      //（途中まで打って先に保存された値（「40」の「4」）がシートに残らないように。間違った数字より空欄のほうが気づける）
      setCellText((t) => ({ ...t, [key]: raw }));
      const cur = resultsRef.current.find((r) => r.id === id);
      if (cur && cur.scores[k]?.[i] != null) {
        updateRow(id, (r) => {
          const qs = [...(r.scores[k] ?? [])];
          qs[i] = null;
          return { ...r, scores: { ...r.scores, [k]: qs } };
        }, [k]);
      }
      return;
    }
    setCellText((t) => { if (!(key in t)) return t; const n = { ...t }; delete n[key]; return n; });
    updateRow(id, (r) => {
      const qs = [...(r.scores[k] ?? [])];
      while (qs.length < subjectOf(e, k).questions.length) qs.push(null);
      qs[i] = p.value;
      return { ...r, scores: { ...r.scores, [k]: qs } };
    }, [k]);
  }, [updateRow]);

  const cols = useMemo(() => {
    if (!exam) return [] as { k: SubjectKey; i: number }[];
    return visibleKeys.flatMap((k) => subjectOf(exam, k).questions.map((_, i) => ({ k, i })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam, subj]);
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const shownRef = useRef(shownRows);
  shownRef.current = shownRows;

  const focusCell = useCallback((grid: string, r: number, c: number) => {
    const el = document.querySelector<HTMLElement>(`[data-grid="${grid}"] [data-r="${r}"][data-c="${c}"]`);
    if (el) { el.focus(); if (el instanceof HTMLInputElement) el.select(); return true; }
    return false;
  }, []);

  const onKey = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const t = e.currentTarget;
    const grid = t.closest('[data-grid]')?.getAttribute('data-grid') ?? '';
    const r = Number(t.dataset.r);
    const c = Number(t.dataset.c);
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      if (t instanceof HTMLSelectElement && e.key === 'ArrowDown') return;
      e.preventDefault();
      focusCell(grid, e.shiftKey && e.key === 'Enter' ? r - 1 : r + 1, c);
    } else if (e.key === 'ArrowUp') {
      if (t instanceof HTMLSelectElement) return;
      e.preventDefault();
      focusCell(grid, r - 1, c);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && t instanceof HTMLInputElement) {
      const atEnd = t.selectionStart === t.value.length && t.selectionEnd === t.value.length;
      const atStart = t.selectionStart === 0 && t.selectionEnd === 0;
      const all = t.selectionStart === 0 && t.selectionEnd === t.value.length;
      if (e.key === 'ArrowRight' && (atEnd || all)) { if (focusCell(grid, r, c + 1)) e.preventDefault(); }
      if (e.key === 'ArrowLeft' && (atStart || all)) { if (focusCell(grid, r, c - 1)) e.preventDefault(); }
    }
  }, [focusCell]);

  /** スプレッドシートからコピーした範囲を、貼ったセルから右下へ広げて入れる。 */
  const onPasteCell = useCallback((e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.replace(/\n$/, ''))) return; // 1つの値ならふつうに貼る
    e.preventDefault();
    const r0 = Number(e.currentTarget.dataset.r);
    const c0 = Number(e.currentTarget.dataset.c);
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    let bad = 0;
    lines.forEach((line, dr) => {
      const row = shownRef.current[r0 + dr];
      if (!row) return;
      line.split('\t').forEach((v, dc) => {
        const col = colsRef.current[c0 + dc];
        if (!col) return;
        const max = subjectOf(examRef.current!, col.k).questions[col.i]?.max ?? 0;
        if (!parseScore(v.trim(), max).ok) bad++;
        setCell(row.id, col.k, col.i, v.trim());
      });
    });
    setNotice(bad ? `貼り付けました。読めない値・配点を超える値が ${bad} か所あります（赤いセル）。` : `貼り付けました（${lines.length}行）。`);
  }, [setCell]);

  // ---- 名簿 ----------------------------------------------------------------

  // 受験番号は校舎ごと（県一斉模試と同じ）なので、その校舎の番号だけを見る
  const usedNos = useMemo(() => results.filter((r) => r.examId === examId && r.campus === campus).map((r) => r.examNo), [results, examId, campus]);

  function addRows(list: Omit<MoshiResult, 'id' | 'examId' | 'campus' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>[]): string[] {
    if (!exam) return [];
    const nos = [...usedNos];
    const made: MoshiResult[] = list.map((x) => {
      const examNo = x.examNo || nextExamNo(campus, nos);
      nos.push(examNo);
      return { ...x, examNo, id: newId(), examId: exam.id, campus, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' };
    });
    setResults((rs) => [...rs, ...made]);
    setOrder((o) => [...o, ...made.map((m) => m.id)]);
    made.forEach((m) => markDirty(m.id, [], true));
    return made.map((m) => m.id);
  }

  function addStudent() {
    if (!exam) return;
    const [id] = addRows([{ examNo: '', name: '', gender: '', choices: ['', '', '', ''], scores: emptyScores(exam), comment: '' }]);
    setView('roster');
    setOnlyMissing(false);
    focusAfter.current = id;
  }
  useEffect(() => {
    if (!focusAfter.current) return;
    const el = document.querySelector<HTMLInputElement>(`[data-grid="roster"] [data-id="${focusAfter.current}"] input[data-c="1"]`);
    if (el) { el.focus(); focusAfter.current = null; }
  });

  // 前の回（この校舎の名簿がある、いちばん新しい回）から、受験番号・氏名・性別・志望校を写す
  const prev = useMemo(() => {
    if (!exam) return null;
    const idx = exams.findIndex((e) => e.id === exam.id);
    for (const e of exams.slice(idx + 1)) {
      const rs = results.filter((r) => r.examId === e.id && r.campus === campus && r.name);
      if (rs.length) return { exam: e, rows: rs };
    }
    return null;
  }, [exams, exam, results, campus]);

  function copyPrev() {
    if (!exam || !prev) return;
    const have = new Set(mine.map((r) => nameKey(r.name)).filter(Boolean));
    const haveNo = new Set(mine.map((r) => r.examNo).filter(Boolean));
    const list = byExamNo(prev.rows).filter((r) => !have.has(nameKey(r.name)));
    if (!list.length) { setNotice(`${prev.exam.name}の名簿の人は、もう全員入っています。`); return; }
    if (!window.confirm(`${prev.exam.name}の${campusInfo(campus)?.label ?? campus}の名簿から ${list.length}人を写します（受験番号・氏名・性別・志望校）。よろしいですか？`)) return;
    addRows(list.map((r) => ({
      examNo: haveNo.has(r.examNo) ? '' : r.examNo, name: r.name, gender: r.gender, choices: [...r.choices],
      scores: emptyScores(exam), comment: '',
    })));
    setNotice(`${list.length}人を写しました。転出した人は「名簿・志望校」の表示で消してください。`);
  }

  async function removeRow(r: MoshiResult) {
    const label = `${r.name || '（氏名なし）'}${r.examNo ? `（${r.examNo}）` : ''}`;
    if (!window.confirm(`${label} の行を消します。入れた得点も見えなくなります。よろしいですか？`)) return;
    const d = dirty.current.get(r.id);
    if (!(d?.isNew && !r.createdAt)) {
      const res = await fetch('/api/moshi/results', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [r.id] }) });
      const j = await res.json().catch(() => null);
      if (!j?.ok) { setNotice(`消せませんでした。${reasonText(j?.reason)}`); return; }
    }
    dirty.current.delete(r.id);
    setPending(dirty.current.size);
    setResults((rs) => rs.filter((x) => x.id !== r.id));
    setOrder((o) => o.filter((x) => x !== r.id));
  }

  function exportCsv() {
    if (!exam) return;
    const csv = toCsv(inputSheetRows(exam, mine, schoolName));
    downloadCsv(`${exam.name}_${campus}.csv`, csv);
  }

  // ---- 表示 ----------------------------------------------------------------

  if (state.status !== 'ready' || !exams.length || !exam) {
    return (
      <div className="ms">
        <PageHead title="本番レベル模試｜成績入力" desc="大問ごとの得点を入れます。入れると自動で保存します。" name={name} />
        <div className="ms-body"><StateNote state={state} onRetry={reload} /></div>
      </div>
    );
  }

  const progress = SUBJECT_KEYS.map((k) => ({
    k,
    done: rows.filter((r) => subjectTotal(r, k) != null && !isPartial(exam, r, k)).length,
    partial: rows.filter((r) => isPartial(exam, r, k)).length,
  }));
  const badCount = Object.keys(cellText).filter((k) => mine.some((r) => k.startsWith(`${r.id}|`))).length;

  return (
    <div className="ms">
      <PageHead title="本番レベル模試｜成績入力" desc="大問ごとの得点を入れます。Enter で下へ、Tab で右へ進みます。入れると自動で保存します。" name={name} />
      <div className="ms-body">
        <ExamCampusBar exams={exams} examId={examId} campus={campus} onExam={pickExam} onCampus={pickCampus} allowAll={false}>
          <SaveBadge save={save} pending={pending} onRetry={flush} />
        </ExamCampusBar>

        <div className="ms-toolbar ms-noprint">
          <div className="ms-seg" role="tablist" aria-label="表示">
            <button type="button" className={view === 'scores' ? 'on' : ''} onClick={() => setView('scores')}>得点</button>
            <button type="button" className={view === 'roster' ? 'on' : ''} onClick={() => setView('roster')}>名簿・志望校</button>
          </div>
          {view === 'scores' && (
            <div className="ms-seg" aria-label="教科">
              <button type="button" className={subj === 'all' ? 'on' : ''} onClick={() => setSubj('all')}>5教科</button>
              {SUBJECT_KEYS.map((k) => (
                <button key={k} type="button" className={subj === k ? 'on' : ''} onClick={() => setSubj(k)}>{SUBJECT_NAMES[k]}</button>
              ))}
            </div>
          )}
          {view === 'scores' && (
            <label className="ms-check"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />未入力がある人だけ</label>
          )}
          <span className="ms-spacer" />
          <button type="button" className="ms-btn" onClick={addStudent}>＋ 生徒を追加</button>
          {prev && <button type="button" className="ms-btn ms-btn-sub" onClick={copyPrev}>前の回から名簿を写す</button>}
          <button type="button" className="ms-btn ms-btn-sub" onClick={() => setPasteOpen(true)}>貼り付けで取り込む</button>
          <button type="button" className="ms-btn ms-btn-sub" onClick={exportCsv} disabled={!mine.length}>入力シートの形で書き出す</button>
        </div>

        <div className="ms-progress ms-noprint">
          <span>{campusInfo(campus)?.label}：{rows.length}人</span>
          {progress.map((p) => (
            <span key={p.k} className={p.done === rows.length && rows.length ? 'ok' : ''}>
              {SUBJECT_NAMES[p.k]} {p.done}/{rows.length}{p.partial ? <em>（途中 {p.partial}）</em> : null}
            </span>
          ))}
          {badCount > 0 && <span className="bad">赤いセル {badCount}か所（空欄として保存しています。直してください）</span>}
        </div>
        {notice && <p className="ms-notice ms-noprint" onClick={() => setNotice('')}>{notice}<small>（押すと消えます）</small></p>}

        {!rows.length ? (
          <div className="ms-note">
            <p>この回の{campusInfo(campus)?.label}の名簿がまだありません。</p>
            <p>「前の回から名簿を写す」か「貼り付けで取り込む」（入力シートの行をそのまま貼れます）、「＋ 生徒を追加」で始めてください。</p>
          </div>
        ) : view === 'scores' ? (
          <div className="ms-grid-wrap">
            <table className="ms-grid" data-grid="scores">
              <thead>
                <tr>
                  <th rowSpan={2} className="ms-sticky ms-c-no">受験番号</th>
                  <th rowSpan={2} className="ms-sticky ms-c-name">氏名</th>
                  {visibleKeys.map((k) => (
                    <th key={k} colSpan={subjectOf(exam, k).questions.length + 1} className={`ms-subj-h ms-s-${k}`}>{SUBJECT_NAMES[k]}</th>
                  ))}
                  {subj === 'all' && <th rowSpan={2} className="ms-c-total">合計<small>／{examMax(exam)}</small></th>}
                </tr>
                <tr>
                  {visibleKeys.map((k) => [
                    ...subjectOf(exam, k).questions.map((q, i) => (
                      <th key={`${k}${i}`} className="ms-q-h" title={q.topic}>
                        {i + 1}<small>{q.max}点</small>
                        {subj !== 'all' && <span className="ms-q-topic">{q.topic}</span>}
                      </th>
                    )),
                    <th key={`${k}t`} className="ms-q-h ms-q-sum">計<small>{subjectMax(exam, k)}</small></th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {shownRows.map((r, ri) => (
                  <ScoreRow
                    key={r.id} r={r} ri={ri} exam={exam} keys={visibleKeys} showTotal={subj === 'all'}
                    texts={cellText} sig={rowSig(cellText, r.id)} cols={cols}
                    onCell={setCell} onKey={onKey} onPaste={onPasteCell}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ms-grid-wrap">
            <datalist id="ms-schools">
              {SCHOOLS.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </datalist>
            <table className="ms-grid ms-roster" data-grid="roster">
              <thead>
                <tr>
                  <th className="ms-c-no">受験番号</th><th className="ms-c-name">氏名</th><th>性別</th>
                  <th>第一志望</th><th>第二志望</th><th>第三志望</th><th>第四志望</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <RosterRow key={r.id} r={r} ri={ri} onUpdate={updateRow} onKey={onKey} onRemove={removeRow} />
                ))}
              </tbody>
            </table>
            <p className="ms-fine">受験番号は県一斉模試と同じ4桁（校舎ごと）。志望校は県一斉模試のコード（例 518-01）か学校名を入れます（学校名の一部を打つと候補が出ます）。前の入力シートの5桁のコードは、分かるものは県一斉のコードに読み替えます。氏名の名字と名前の間は全角の空白にそろえます。</p>
          </div>
        )}

        {pasteOpen && (
          <PasteDialog
            exam={exam} campus={campus} current={mine}
            onClose={() => setPasteOpen(false)}
            onApply={(plan) => {
              const changed: string[] = [];
              for (const u of plan.update) {
                const fields: ResultField[] = [];
                updateRowSilently(u.target.id, (r) => {
                  const next = { ...r, scores: { ...r.scores } };
                  if (u.row.examNo && u.row.examNo !== r.examNo) { next.examNo = u.row.examNo; fields.push('examNo'); }
                  if (u.row.name && u.row.name !== r.name) { next.name = u.row.name; fields.push('name'); }
                  if (u.row.gender && u.row.gender !== r.gender) { next.gender = u.row.gender; fields.push('gender'); }
                  if (u.row.choices.some(Boolean)) { next.choices = u.row.choices.map((c, i) => c || r.choices[i] || ''); fields.push('choices'); }
                  if (u.row.scores) {
                    for (const k of SUBJECT_KEYS) {
                      if (u.row.scores[k].some((v) => v != null)) { next.scores[k] = u.row.scores[k]; fields.push(k); }
                    }
                  }
                  return next;
                });
                if (fields.length) { markDirty(u.target.id, fields); changed.push(u.target.id); }
              }
              addRows(plan.add.map((p) => ({
                examNo: p.examNo, name: p.name, gender: p.gender, choices: [0, 1, 2, 3].map((i) => p.choices[i] ?? ''),
                scores: p.scores ?? emptyScores(exam), comment: '',
              })));
              setPasteOpen(false);
              setNotice(`取り込みました（追加 ${plan.add.length}人・更新 ${changed.length}人）。`);
            }}
          />
        )}
      </div>
    </div>
  );

  function updateRowSilently(id: string, fn: (r: MoshiResult) => MoshiResult) {
    setResults((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));
  }
}

function toInput(r: MoshiResult) {
  return { id: r.id, campus: r.campus, examNo: r.examNo, name: r.name, gender: r.gender, choices: r.choices, scores: r.scores, comment: r.comment };
}

function rowSig(texts: Record<string, string>, id: string): string {
  let s = '';
  for (const k in texts) if (k.startsWith(`${id}|`)) s += `${k}=${texts[k]};`;
  return s;
}

function SaveBadge({ save, pending, onRetry }: { save: SaveState; pending: number; onRetry: () => void }) {
  if (save.status === 'error') return (
    <span className="ms-save err">保存できませんでした：{save.message} <button type="button" onClick={onRetry}>もう一度保存</button></span>
  );
  if (save.status === 'saving') return <span className="ms-save">保存中…</span>;
  if (pending) return <span className="ms-save">入力中（まもなく保存）</span>;
  if (save.status === 'saved') return <span className="ms-save ok">保存しました（{save.at}）</span>;
  return <span className="ms-save muted">入れると自動で保存します</span>;
}

// ---- 得点の1行 -------------------------------------------------------------

type ScoreRowProps = {
  r: MoshiResult; ri: number; exam: MoshiExam; keys: SubjectKey[]; showTotal: boolean;
  texts: Record<string, string>; sig: string; cols: { k: SubjectKey; i: number }[];
  onCell: (id: string, k: SubjectKey, i: number, raw: string) => void;
  onKey: (e: KeyboardEvent<HTMLElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void;
};

const ScoreRow = memo(function ScoreRow({ r, ri, exam, keys, showTotal, texts, cols, onCell, onKey, onPaste }: ScoreRowProps) {
  let all = 0;
  let complete = true;
  return (
    <tr>
      <td className="ms-sticky ms-c-no">{r.examNo || '—'}</td>
      <td className="ms-sticky ms-c-name">{r.name || <span className="ms-muted">（氏名なし）</span>}</td>
      {keys.map((k) => {
        const qs = subjectOf(exam, k).questions;
        const partial = isPartial(exam, r, k);
        const total = subjectTotal(r, k);
        if (total == null) complete = false; else all += total;
        return [
          ...qs.map((q, i) => {
            const key = cellKey(r.id, k, i);
            const raw = texts[key];
            const v = r.scores[k]?.[i];
            const c = cols.findIndex((x) => x.k === k && x.i === i);
            return (
              <td key={key} className={`ms-cell-td ms-s-${k}${i === 0 ? ' ms-first' : ''}`}>
                <input
                  className={`ms-cell${raw != null ? ' bad' : ''}${partial && v == null && raw == null ? ' gap' : ''}`}
                  inputMode="numeric" autoComplete="off" data-r={ri} data-c={c}
                  aria-label={`${r.name} ${SUBJECT_NAMES[k]}${i + 1}（${q.max}点）`}
                  title={raw != null ? `0〜${q.max} の整数で入れてください` : `${SUBJECT_NAMES[k]}${i + 1} ${q.topic}（${q.max}点）`}
                  value={raw ?? (v == null ? '' : String(v))}
                  onChange={(e) => onCell(r.id, k, i, e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={onKey} onPaste={onPaste}
                />
              </td>
            );
          }),
          <td key={`${k}t`} className={`ms-sum-td ms-s-${k}`}>{total ?? ''}</td>,
        ];
      })}
      {showTotal && <td className="ms-sum-td ms-c-total">{complete ? all : ''}</td>}
    </tr>
  );
}, (a, b) => a.r === b.r && a.ri === b.ri && a.exam === b.exam && a.keys.join() === b.keys.join() && a.showTotal === b.showTotal
  && a.sig === b.sig && a.cols === b.cols && a.onCell === b.onCell && a.onKey === b.onKey && a.onPaste === b.onPaste);

// ---- 名簿の1行 -------------------------------------------------------------

type RosterRowProps = {
  r: MoshiResult; ri: number;
  onUpdate: (id: string, fn: (r: MoshiResult) => MoshiResult, fields: ResultField[]) => void;
  onKey: (e: KeyboardEvent<HTMLElement>) => void;
  onRemove: (r: MoshiResult) => void;
};

const RosterRow = memo(function RosterRow({ r, ri, onUpdate, onKey, onRemove }: RosterRowProps) {
  const other = r.examNo && campusOfExamNo(r.examNo) && campusOfExamNo(r.examNo) !== r.campus;
  return (
    <tr data-id={r.id}>
      <td className="ms-c-no">
        <input
          className={`ms-in ms-in-no${other ? ' warn' : ''}`} inputMode="numeric" data-r={ri} data-c={0} value={r.examNo}
          title={other ? `${campusOfExamNo(r.examNo)}の受験番号です` : '受験番号'}
          onChange={(e) => { const v = toHalf(e.target.value).replace(/\D/g, '').slice(0, 10); onUpdate(r.id, (x) => ({ ...x, examNo: v }), ['examNo']); }}
          onBlur={(e) => { const v = normalizeExamNo(e.target.value); if (v !== r.examNo) onUpdate(r.id, (x) => ({ ...x, examNo: v }), ['examNo']); }}
          onKeyDown={onKey}
        />
      </td>
      <td className="ms-c-name">
        <input
          className="ms-in" data-r={ri} data-c={1} value={r.name} placeholder="名字　名前" maxLength={40}
          onChange={(e) => { const v = e.target.value; onUpdate(r.id, (x) => ({ ...x, name: v }), ['name']); }}
          onBlur={(e) => { const v = normalizeName(e.target.value); if (v !== r.name) onUpdate(r.id, (x) => ({ ...x, name: v }), ['name']); }}
          onKeyDown={onKey}
        />
      </td>
      <td>
        <select
          className="ms-in ms-in-g" data-r={ri} data-c={2} value={r.gender}
          onChange={(e) => { const v = e.target.value as Gender; onUpdate(r.id, (x) => ({ ...x, gender: v }), ['gender']); }}
          onKeyDown={onKey}
        >
          <option value="">—</option><option value="男">男</option><option value="女">女</option>
        </select>
      </td>
      {[0, 1, 2, 3].map((i) => {
        const v = r.choices[i] ?? '';
        const label = /^\d{3}-\d{2}$|^\d{5}$/.test(v) ? schoolName(v) : '';
        return (
          <td key={i} className="ms-c-choice">
            <input
              className="ms-in" list="ms-schools" data-r={ri} data-c={3 + i} value={v} placeholder="コードか学校名"
              onChange={(e) => {
                const val = e.target.value;
                onUpdate(r.id, (x) => { const c = [...x.choices]; c[i] = val; return { ...x, choices: c }; }, ['choices']);
              }}
              onBlur={(e) => {
                const val = normalizeChoice(e.target.value, toKenCode);
                if (val !== v) onUpdate(r.id, (x) => { const c = [...x.choices]; c[i] = val; return { ...x, choices: c }; }, ['choices']);
              }}
              onKeyDown={onKey}
            />
            {label && <small className={/一覧に無い|前のコード/.test(label) ? 'warn' : ''}>{label}</small>}
          </td>
        );
      })}
      <td><button type="button" className="ms-x" onClick={() => onRemove(r)} title="この行を消す">消す</button></td>
    </tr>
  );
});

// ---- 貼り付けで取り込む -----------------------------------------------------

function PasteDialog({ exam, campus, current, onClose, onApply }: {
  exam: MoshiExam; campus: string; current: MoshiResult[];
  onClose: () => void; onApply: (plan: ReturnType<typeof planPaste>) => void;
}) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => parsePaste(text, exam, toKenCode), [text, exam]);
  const plan = useMemo(() => planPaste(parsed.rows, current), [parsed, current]);
  const others = parsed.rows.filter((p) => p.examNo && campusOfExamNo(p.examNo) && campusOfExamNo(p.examNo) !== campus);
  const withScores = parsed.rows.filter((p) => p.scores).length;
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="ms-modal" role="dialog" aria-modal="true" aria-label="貼り付けで取り込む" onClick={onClose}>
      <div className="ms-modal-box" onClick={(e) => e.stopPropagation()}>
        <h2>貼り付けで取り込む（{campusInfo(campus)?.label}）</h2>
        <p className="ms-fine">
          スプレッドシートで行を選んでコピーし、下に貼り付けます。次のどちらの形でも読めます。<br />
          ・名簿：受験番号（県一斉模試の4桁）・氏名・性別（0/1 か 男/女）・第一〜第四志望（県一斉のコードか学校名）<br />
          ・入力シートの行：B列（受験番号）〜AT列（合計）。A列から選んでも、非表示の列を含んでいても読めます。大問の得点も入ります
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="ここに貼り付け" autoFocus />
        {text.trim() && (
          <div className="ms-paste-sum">
            <p>読めた行：{parsed.rows.length}人（得点あり {withScores}人）→ 追加 {plan.add.length}人・名簿にある人の更新 {plan.update.length}人</p>
            {others.length > 0 && <p className="warn">{others.length}人は受験番号が{[...new Set(others.map((o) => campusOfExamNo(o.examNo)))].join('・')}の番号です。校舎の選び間違いがないか確かめてください。</p>}
            {parsed.warnings.slice(0, 6).map((w) => <p key={w} className="warn">{w}</p>)}
            {parsed.warnings.length > 6 && <p className="warn">ほか {parsed.warnings.length - 6} 件</p>}
            <p className="ms-fine">空欄の項目は、いまの名簿の値を残します。得点は、貼った行に得点が入っている教科だけを置きかえます。</p>
          </div>
        )}
        <div className="ms-modal-actions">
          <button type="button" className="ms-btn ms-btn-sub" onClick={onClose}>やめる</button>
          <button type="button" className="ms-btn" disabled={!parsed.rows.length} onClick={() => onApply(plan)}>取り込む</button>
        </div>
      </div>
    </div>
  );
}
