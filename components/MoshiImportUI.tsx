'use client';

// 本番レベル模試：県一斉模試の取り込み（/moshi/import）。
// 長崎県一斉模試の集計結果 CSV を、智翔館の中等部の生徒の分だけ取り込む。
// ★氏名と成績は一緒に扱わない。2つのボタンは別々で、それぞれ必要な列だけを読む。
//   1) 成績（校舎・受験番号・成績）：成績の CSV から読む。氏名の列があっても読まない（lib/moshi/model.ts の kenScores）。
//      受験番号の無いファイル（成績表_氏名なし）は、氏名対応表から ID → 受験番号だけを引く（kenIdMap。氏名は読まない）
//   2) 名簿（校舎・受験番号・氏名）：氏名対応表（か集計結果）から読む。成績の列は読まない（kenRoster）。
//      本番レベル模試の回の名簿（成績入力の行）に入れる
// 2つは「校舎＋受験番号」で結び付く（受験番号は県一斉模試の会場ごとの4桁）。

import { useMemo, useState } from 'react';
import {
  CAMPUS_NAMES, campusInfo, emptyScores, jpDate, kenExams, kenGuessFromFileName, kenIdMap, kenRoster, kenScores, kenTable,
  nameKey,
  type KenRosterRow, type KenScoresResult, type KenitsuResult, type MoshiExam, type MoshiResult,
} from '@/lib/moshi/model';
import { ExamCampusBar, NO_KEN, PageHead, StateNote, newId, readCsvFile, reasonText, useExamCampus, useMoshiData } from './MoshiShared';

/** CSV ファイルを文字にする（UTF-8 で読めなければ Shift_JIS。県一斉模試の集計結果は Shift_JIS）。 */
function countBy<T>(items: T[], key: (x: T) => string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of items) m[key(x)] = (m[key(x)] ?? 0) + 1;
  return m;
}

function byCampusText(m: Record<string, number>): string {
  return CAMPUS_NAMES.filter((c) => m[c]).map((c) => `${campusInfo(c)?.label ?? c} ${m[c]}人`).join('・') || '0人';
}

export default function MoshiImportUI({ name }: { name: string }) {
  const { state, reload, setResults } = useMoshiData();
  const exams = state.status === 'ready' ? state.exams : [];
  const results = state.status === 'ready' ? state.results : [];
  const kenitsu = state.status === 'ready' ? state.kenitsu : NO_KEN;
  const kenList = useMemo(() => kenExams(kenitsu), [kenitsu]);
  const { exam, examId, campus, pickExam, pickCampus } = useExamCampus(exams, { allowAll: true });

  if (state.status !== 'ready') {
    return (
      <div className="ms">
        <PageHead title="本番レベル模試｜県一斉模試の取り込み" desc="県一斉模試の成績と名簿を、別々に取り込みます。" name={name} />
        <div className="ms-body"><StateNote state={state} onRetry={reload} /></div>
      </div>
    );
  }

  return (
    <div className="ms">
      <PageHead
        title="本番レベル模試｜県一斉模試の取り込み"
        desc="長崎県一斉模試の集計結果から、智翔館の中等部の生徒の分を取り込みます。成績と名簿は別々に取り込み、校舎＋受験番号で結び付けます。"
        name={name}
      />
      <div className="ms-body ms-import">
        <p className="ms-notice warn">
          成績の取り込みは、ファイルに氏名の列があっても氏名を読みません（校舎・受験番号・成績だけ）。
          名簿の取り込みは、成績の列を読みません（校舎・受験番号・氏名だけ）。RED・ネクスタの教室の行は取り込みません。
        </p>
        <ScoresSection kenList={kenList} onDone={reload} />
        {exams.length > 0 && exam ? (
          <>
            <ExamCampusBar exams={exams} examId={examId} campus={campus} onExam={pickExam} onCampus={pickCampus} allowAll />
            <RosterSection exam={exam} campus={campus} results={results} kenitsu={kenitsu} kenList={kenList}
              onSaved={(items) => setResults((rs) => {
                const byId = new Map(items.map((x) => [x.id, x]));
                const merged = rs.map((r) => byId.get(r.id) ?? r);
                const have = new Set(rs.map((r) => r.id));
                return [...merged, ...items.filter((x) => !have.has(x.id))];
              })} />
          </>
        ) : (
          <section className="ms-import-sec"><h2 className="ms-h2">2. 名簿（受験番号と氏名）</h2><p className="ms-note">名簿を入れる本番レベル模試の回がまだありません。「模試の設定」で回を作ってください。</p></section>
        )}
        <section className="ms-import-sec">
          <h2 className="ms-h2">取り込んだ県一斉模試</h2>
          {!kenList.length ? <p className="ms-muted ms-fine">まだありません。</p> : (
            <table className="ms-table">
              <thead><tr><th>回</th><th>実施日</th><th>人数</th><th></th></tr></thead>
              <tbody>
                {kenList.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td>{jpDate(k.date) || k.date}</td>
                    <td>{byCampusText(k.byCampus)}（計 {k.count}人）</td>
                    <td>
                      <button type="button" className="ms-x" onClick={async () => {
                        if (!window.confirm(`「${k.name}」の取り込んだ成績（${k.count}人）を消します。よろしいですか？`)) return;
                        const res = await fetch(`/api/moshi/kenitsu?id=${encodeURIComponent(k.id)}`, { method: 'DELETE' });
                        const j = await res.json().catch(() => null);
                        if (!j?.ok) { window.alert(reasonText(j?.reason)); return; }
                        await reload();
                      }}>消す</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

// ---- 1. 成績 ----------------------------------------------------------------

function ScoresSection({ kenList, onDone }: { kenList: ReturnType<typeof kenExams>; onDone: () => Promise<boolean> }) {
  const [scoresText, setScoresText] = useState<{ name: string; text: string } | null>(null);
  const [mapText, setMapText] = useState<{ name: string; text: string } | null>(null);
  const [examName, setExamName] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [inputKey, setInputKey] = useState(0); // 取り込んだら、ファイルの欄を空に戻す

  const parsed: KenScoresResult | null = useMemo(() => {
    if (!scoresText) return null;
    const idMap = mapText ? kenIdMap(kenTable(mapText.text)) : undefined;
    return kenScores(kenTable(scoresText.text), { examId: '', examName, date }, idMap);
  }, [scoresText, mapText, examName, date]);
  const examId = date ? `ken-${date}` : '';
  const replacing = kenList.find((k) => k.id === examId);

  async function onFile(f: File | undefined, kind: 'scores' | 'map') {
    setMsg('');
    if (!f) return;
    const text = await readCsvFile(f);
    if (kind === 'scores') {
      setScoresText({ name: f.name, text });
      const g = kenGuessFromFileName(f.name);
      if (!examName) setExamName(g.name);
      if (!date && g.date) setDate(g.date);
    } else setMapText({ name: f.name, text });
  }

  async function submit() {
    if (!parsed || !parsed.items.length || busy) return;
    if (!examName.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { setMsg('回名と実施日を入れてください。'); return; }
    if (replacing && !window.confirm(`「${replacing.name}」（${replacing.count}人）を、このファイルの ${parsed.items.length}人で置きかえます。よろしいですか？`)) return;
    setBusy(true);
    setMsg('取り込み中…');
    try {
      const res = await fetch('/api/moshi/kenitsu', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examId, examName, date, items: parsed.items }),
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) { setMsg(reasonText(j?.reason, j?.detail)); return; }
      setMsg(`${j.count}人分の成績を取り込みました。`);
      setScoresText(null);
      setMapText(null);
      setInputKey((k) => k + 1);
      await onDone();
    } catch {
      setMsg(reasonText('network_error'));
    } finally {
      setBusy(false);
    }
  }

  const byCampus = parsed ? countBy(parsed.items, (x) => x.campus) : {};

  return (
    <section className="ms-import-sec">
      <h2 className="ms-h2">1. 成績（受験番号と成績）</h2>
      <p className="ms-fine">
        集計結果の CSV（または「成績表_氏名なし」の CSV）を選びます。受験番号の列が無いファイル（ID だけのもの）は、
        同じ回の「氏名対応表」も選んでください（ID と受験番号を結ぶのに使い、氏名は読みません）。
      </p>
      <div className="ms-field-row">
        <label className="ms-field grow">
          <span>成績の CSV</span>
          <input key={`s${inputKey}`} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0], 'scores')} />
        </label>
        <label className="ms-field grow">
          <span>氏名対応表（受験番号の列が無いときだけ）</span>
          <input key={`m${inputKey}`} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0], 'map')} />
        </label>
      </div>
      <div className="ms-field-row">
        <label className="ms-field grow">
          <span>回名</span>
          <input value={examName} maxLength={60} placeholder="例）長崎県一斉模試 2026年10月" onChange={(e) => setExamName(e.target.value)} />
        </label>
        <label className="ms-field">
          <span>実施日</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {parsed && (
        <div className="ms-import-preview">
          {parsed.missing.length > 0 ? (
            <p className="warn">
              このファイルには {parsed.missing.join('・')} の列がありません。
              {parsed.needMap && '受験番号は、同じ回の「氏名対応表」を右の欄で選ぶと引けます。'}
            </p>
          ) : (
            <>
              <p>取り込む生徒：<b>{parsed.items.length}人</b>（{byCampusText(byCampus)}）</p>
              {parsed.other > 0 && <p className="ms-fine">中等部の校舎ではない行（RED・ネクスタなど）{parsed.other}行は取り込みません。</p>}
              {parsed.noNumber > 0 && <p className="warn">受験番号が分からない行が {parsed.noNumber}行あります（取り込みません）。</p>}
              {replacing && <p className="warn">同じ実施日の「{replacing.name}」（{replacing.count}人）を置きかえます。</p>}
              <p className="ms-fine">偏差値・順位・判定・合格確率は、ファイルの値（県全体）をそのまま使います。成績表の「教科別偏差値推移」に「{examName.match(/\d+月/)?.[0] ?? ''}県」として並びます。</p>
            </>
          )}
        </div>
      )}
      <div className="ms-actions">
        <button type="button" className="ms-btn" disabled={busy || !parsed || !parsed.items.length || !!parsed.missing.length} onClick={submit}>成績を取り込む</button>
        {msg && <span className="ms-msg">{msg}</span>}
      </div>
    </section>
  );
}

// ---- 2. 名簿 ----------------------------------------------------------------

type RosterPlan = {
  add: KenRosterRow[];
  update: { target: MoshiResult; row: KenRosterRow; fields: ('name' | 'examNo')[] }[];
  same: number;
};

function planRoster(rows: KenRosterRow[], current: MoshiResult[]): RosterPlan {
  const plan: RosterPlan = { add: [], update: [], same: 0 };
  const taken = new Set<string>();
  for (const row of rows) {
    const mine = current.filter((r) => r.campus === row.campus && !taken.has(r.id));
    const byNo = mine.find((r) => r.examNo === row.examNo);
    const byName = byNo ? null : mine.find((r) => nameKey(r.name) && nameKey(r.name) === nameKey(row.name));
    const t = byNo ?? byName;
    if (!t) { plan.add.push(row); continue; }
    taken.add(t.id);
    const fields: ('name' | 'examNo')[] = [];
    if (t.examNo !== row.examNo) fields.push('examNo');
    if (t.name !== row.name) fields.push('name');
    if (fields.length) plan.update.push({ target: t, row, fields }); else plan.same++;
  }
  return plan;
}

function RosterSection({ exam, campus, results, kenitsu, kenList, onSaved }: {
  exam: MoshiExam; campus: string; results: MoshiResult[];
  kenitsu: KenitsuResult[];
  kenList: ReturnType<typeof kenExams>;
  onSaved: (items: MoshiResult[]) => void;
}) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [kenId, setKenId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [inputKey, setInputKey] = useState(0);

  const parsed = useMemo(() => (file ? kenRoster(kenTable(file.text)) : null), [file]);
  const rows = useMemo(() => (parsed ? parsed.rows.filter((r) => !campus || r.campus === campus) : []), [parsed, campus]);
  const current = useMemo(() => results.filter((r) => r.examId === exam.id), [results, exam.id]);
  const plan = useMemo(() => planRoster(rows, current), [rows, current]);
  // 志望校は、選んだ県一斉模試の成績（校舎＋受験番号）から入れる（公立第1・第2 → 第1・第2志望、国私立第1・第2 → 第3・第4志望）
  const choicesOf = (row: { campus: string; examNo: string }) => {
    if (!kenId) return null;
    const k = kenitsu.find((x) => x.examId === kenId && x.campus === row.campus && x.examNo === row.examNo);
    return k ? k.choices.map((c) => c.code) : null;
  };

  async function submit() {
    if (busy || (!plan.add.length && !plan.update.length && !kenId)) return;
    setBusy(true);
    setMsg('名簿に入れています…');
    const payload: { row: Record<string, unknown>; fields: string[] | null }[] = [];
    for (const a of plan.add) {
      payload.push({
        row: { id: newId(), campus: a.campus, examNo: a.examNo, name: a.name, gender: '', choices: choicesOf(a) ?? ['', '', '', ''], scores: emptyScores(exam), comment: '' },
        fields: null,
      });
    }
    const touched = new Set<string>();
    for (const u of plan.update) {
      touched.add(u.target.id);
      const ch = choicesOf(u.row);
      const fillChoices = !!ch && u.target.choices.every((c) => !c);
      payload.push({
        row: { ...u.target, examNo: u.row.examNo, name: u.row.name, choices: fillChoices ? ch : u.target.choices },
        fields: [...u.fields, ...(fillChoices ? ['choices'] : [])],
      });
    }
    // 名簿は変わらないが、志望校が空の人にだけ県一斉の志望校を入れる
    if (kenId) {
      for (const t of current.filter((r) => !touched.has(r.id) && (!campus || r.campus === campus))) {
        const ch = choicesOf(t);
        if (ch && t.choices.every((c) => !c) && ch.some(Boolean)) payload.push({ row: { ...t, choices: ch }, fields: ['choices'] });
      }
    }
    if (!payload.length) { setMsg('入れるものがありません。'); setBusy(false); return; }
    try {
      const saved: MoshiResult[] = [];
      for (let i = 0; i < payload.length; i += 150) {
        const res = await fetch('/api/moshi/results', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ examId: exam.id, rows: payload.slice(i, i + 150) }),
        });
        const j = await res.json().catch(() => null);
        if (!j?.ok) { setMsg(reasonText(j?.reason, j?.detail)); return; }
        saved.push(...(j.items as MoshiResult[]));
      }
      onSaved(saved);
      setMsg(`名簿に入れました（追加 ${plan.add.length}人・直した ${plan.update.length}人${kenId ? '。志望校が空の人には県一斉模試の志望校' : ''}）。`);
      setFile(null);
      setInputKey((k) => k + 1);
    } catch {
      setMsg(reasonText('network_error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ms-import-sec">
      <h2 className="ms-h2">2. 名簿（受験番号と氏名）を「{exam.name}」に入れる</h2>
      <p className="ms-fine">
        氏名対応表（または集計結果）の CSV を選ぶと、校舎・受験番号・氏名だけを読み、上で選んだ回の成績入力の名簿に入れます（成績の列は読みません）。
        同じ校舎・受験番号の人がいれば氏名を直し、いなければ足します。前の番号で入っている人は、同じ氏名なら受験番号を直します。
      </p>
      <div className="ms-field-row">
        <label className="ms-field grow">
          <span>氏名対応表の CSV</span>
          <input key={inputKey} type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; setMsg(''); setFile(f ? { name: f.name, text: await readCsvFile(f) } : null); }} />
        </label>
        <label className="ms-field grow">
          <span>志望校も入れる（空欄の人だけ）</span>
          <select value={kenId} onChange={(e) => setKenId(e.target.value)}>
            <option value="">入れない</option>
            {kenList.map((k) => <option key={k.id} value={k.id}>{k.name} の志望校</option>)}
          </select>
        </label>
      </div>
      {parsed && (
        <div className="ms-import-preview">
          {parsed.missing.length > 0 ? <p className="warn">このファイルには {parsed.missing.join('・')} の列がありません。</p> : (
            <>
              <p>
                {campus ? `${campusInfo(campus)?.label}：` : ''}読めた生徒 {rows.length}人 → 追加 <b>{plan.add.length}人</b>・直す <b>{plan.update.length}人</b>・そのまま {plan.same}人
              </p>
              {plan.update.some((u) => u.fields.includes('examNo')) && (
                <p className="ms-fine">受験番号を直す人：{plan.update.filter((u) => u.fields.includes('examNo')).map((u) => `${u.target.examNo || '（なし）'} → ${u.row.examNo}`).join('、')}</p>
              )}
              {parsed.other > 0 && <p className="ms-fine">中等部の校舎ではない行 {parsed.other}行は入れません。</p>}
            </>
          )}
        </div>
      )}
      {kenId && !file && <p className="ms-fine">名簿のファイルを選ばずに［名簿に入れる］を押すと、いまの名簿で志望校が空の人にだけ、{kenList.find((k) => k.id === kenId)?.name}の志望校（県一斉模試のコード）を入れます。</p>}
      <div className="ms-actions">
        <button type="button" className="ms-btn" disabled={busy || (!!parsed && !!parsed.missing.length) || (!file && !kenId)} onClick={submit}>名簿に入れる</button>
        {msg && <span className="ms-msg">{msg}</span>}
      </div>
    </section>
  );
}

