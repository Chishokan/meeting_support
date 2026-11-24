'use client';

// イベント申込管理（/event）。イベントの声掛け名簿と申込状況を、教室担当と管理担当が同じ画面で見る。
//   校舎ごとの進み具合 … 管理部門だけに出るタブ。校舎ごとの チラシ配布・声掛け・申込・重点（薬剤師・医療系）の進み具合
//   声掛け名簿         … 教室担当向け。生徒ごとの「次にすること」。チラシ・声掛け・反応・保護者への案内をその場で記録する
//   名簿外の申込       … フォームの回答のうち、名簿の誰とも結び付かなかったもの（RED個別・高校生・外部生・氏名の書き方が違う人）
//   部門               … 小中等部・RED個別・高等部の職員には、自分の部門の生徒だけが届く（API で絞る）。管理部門は全部門を見て、上の切り替えで部門を選べる
//   一括で記録         … 声掛け名簿の［一括で記録］。表示中の生徒をチェックボックスで選び、チラシ配布済み・声掛け済みなどをまとめて記録する
//   生徒の追加         … 名簿に無い生徒を足す（声掛け名簿の［＋ 生徒を追加］、名簿外の申込の［名簿に足す］）。足した生徒は直す・外すができる
// 申込は Google フォームの回答を氏名で名簿に結び付けて出すだけ（画面からは申込を入れない。申込の状況を見る）。
// 決まりと計算は lib/eventList/model.ts、イベントの中身は lib/eventList/event.ts、読み書きは lib/eventList/store.ts。

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CAMPUS_ORDER, DEFAULT_DEPT, DEPTS, EVENT, NO_CAMPUS, PRIORITY_WORDS } from '@/lib/eventList/event';
import {
  DAY_FIELDS, GRADES, PRIORITY_LABEL, REACTIONS, STAGE_LABEL, TRACK_FIELDS, appLabel, bulkChanges, mergeSaved, revertFields, autoPriority, buildRows, campusList, daysUntil, emptyTrack, linkIds, normCampus,
  normGrade, normName, pct, sameNameStudents, shortDay, sortRowsBy, summarize, todayJp, SORTS,
  type Application, type BulkAction, type DayField, type Reaction, type SortKey, type Student, type StudentInput, type StudentRow, type Summary, type Track, type TrackField,
} from '@/lib/eventList/model';

const REASONS: Record<string, string> = {
  not_configured: 'イベント申込管理の保存先（名簿のスプレッドシートに付けた Apps Script。環境変数 EVENT_SCRIPT_URL）が未設定です。管理者に伝えてください。',
  not_deployed: '保存先のスクリプトが古いか、別のスクリプトを指しています。管理者に、Apps Script（apps_script/event.gs）の出し直しと EVENT_SCRIPT_URL を確かめてもらってください。',
  invalid_token: '保存先の合言葉（EVENT_SCRIPT_TOKEN）が、Apps Script の TOKEN と合っていません。管理者に伝えてください。',
  forbidden: 'この画面を使える部門ではありません。',
  unauthorized: 'ログインが切れました。ページを読み込み直して、ログインし直してください。',
  upstream_error: 'スプレッドシートの読み書きに失敗しました。少し待ってからもう一度試してください。',
  script_error: 'スプレッドシートの読み書きの途中でエラーが起きました。管理者に伝えてください。',
  network_error: '通信エラーが起きました。もう一度試してください。',
  timeout: 'スプレッドシートの応答が遅く、途中で止まりました。もう一度試してください。',
  bad_request: '送った内容を読めませんでした。ページを読み込み直してください。',
  no_name: '校舎と氏名を入れてください。',
  not_found: '見つかりませんでした（他の人が外したかもしれません）。［最新にする］を押してください。',
};
const reasonText = (r: unknown) => REASONS[String(r ?? '')] ?? `うまくいきませんでした（${String(r || '不明')}）。`;

type Loaded = { students: Student[]; applications: Application[]; formStatus: 'ok' | 'not_set' | 'error'; fetchedAt: string; backend: string };
type State = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & Loaded);
type View = 'overview' | 'list' | 'outside';
type Filter = 'todo' | 'urgent' | 'none' | 'thinking' | 'applied' | 'declined' | 'all';
type Change = { row: StudentRow; fields: Partial<Record<TrackField, string>> };
// 項目ごとの保存の様子（「生徒の鍵|項目」で引く）：saving＝保存の途中、saved＝保存できたばかり（少しのあいだ ✓ を出す）
type SaveMarks = { pending: ReadonlyMap<string, number>; saved: ReadonlySet<string> };
const markId = (key: string, f: string) => `${key}|${f}`;
// 生徒を足す・直す窓：student＝直す生徒（足すときは無し）、app＝名簿外の申込から足すとき、init＝最初に入れておく値
// dept＝足す生徒の部門（管理部門だけが選べる。ほかの職員はログインした部門になる）
type Editing = { student?: Student; app?: Application; init: StudentInput; dept: string };

// 最初は「全員」（申込済の生徒も出る）。「することがある」を最初にしていたときは、申込済の生徒が出ず、申込が見えなかった
const FILTERS: { key: Filter; label: string; test: (r: StudentRow) => boolean }[] = [
  { key: 'all', label: '全員', test: () => true },
  { key: 'todo', label: 'することがある', test: (r) => r.todo !== '' },
  { key: 'urgent', label: '重点で未決', test: (r) => r.urgent },
  { key: 'none', label: '未着手', test: (r) => r.stage === 'none' },
  { key: 'thinking', label: '参加したい・検討中', test: (r) => r.stage === 'wants' || r.stage === 'considering' },
  { key: 'applied', label: '申込済', test: (r) => r.stage === 'applied' },
  { key: 'declined', label: '不参加', test: (r) => r.stage === 'declined' },
];

export default function EventListUI({ admin, rooms }: { admin: boolean; rooms: string[] }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [tracks, setTracks] = useState<Map<string, Track>>(new Map());
  const [view, setView] = useState<View>(admin ? 'overview' : 'list');
  const [campus, setCampus] = useState<string | null>(null); // null＝まだ選んでいない、''＝すべて
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortKey>('todo');
  const [grade, setGrade] = useState('');
  const [q, setQ] = useState('');
  // 保存の途中の項目（数）。ref は保存の返事を入れるときにその場の値を読むため、state は画面に出すため
  const pendingRef = useRef(new Map<string, number>());
  const [pending, setPending] = useState<ReadonlyMap<string, number>>(new Map());
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [flash, setFlash] = useState<'' | 'saved' | 'error'>(''); // 保存が終わった直後の知らせ（下の帯）
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<{ app: Application; row: StudentRow | null } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deptView, setDeptView] = useState(''); // 管理部門だけ：見る部門（''＝全部門）
  const [rev, setRev] = useState(0); // 生徒を足す・直す・外すたびに増やす（名簿の並びを決め直す）

  const [refreshing, setRefreshing] = useState(false); // ［最新にする］で読み直している間（画面はそのまま、上に細い帯を出す）
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/event', { cache: 'no-store' });
      const j = await res.json().catch(() => null);
      if (!j?.ok) { setState({ status: 'error', message: reasonText(j?.reason) }); return; }
      setTracks(new Map((j.tracks as Track[]).map((t) => [t.key, t])));
      setState({ status: 'ready', students: j.students, applications: j.applications, formStatus: j.formStatus, fetchedAt: j.fetchedAt, backend: j.backend });
    } catch {
      setState({ status: 'error', message: reasonText('network_error') });
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const students = state.status === 'ready' ? state.students : null;
  const applications = state.status === 'ready' ? state.applications : null;
  const built = useMemo(
    () => (students && applications ? buildRows(students, [...tracks.values()], applications, PRIORITY_WORDS) : { rows: [], unmatched: [] }),
    [students, applications, tracks],
  );
  const campuses = useMemo(
    () => campusList((students ?? []).filter((st) => !deptView || st.dept === deptView), CAMPUS_ORDER, NO_CAMPUS),
    [students, deptView],
  );

  // 教室担当は、最初に自分の校舎を開く（共通ログインの「教室」と名簿の校舎の名前が合うとき）
  const activeCampus = useMemo(() => {
    if (campus !== null) return campus;
    if (admin) return '';
    const mine = campuses.find((c) => rooms.some((r) => normCampus(r) !== '' && normCampus(r) === normCampus(c)));
    return mine ?? '';
  }, [campus, admin, campuses, rooms]);

  // 記録を保存する。画面は先に書き換え、失敗したら元に戻す
  // 記録を保存する。画面は先に書き換え、保存の途中の項目に印を付ける（押した所に「保存中」が出る）。
  //   - 同じ項目の保存の途中は、もう一度押しても受け付けない（行の側で止める）
  //   - 返事は、まだ保存の途中のほかの項目を上書きしないように入れる（mergeSaved）
  //   - 失敗したら、その保存で変えた項目だけを元に戻す（revertFields）
  const save = useCallback(async (changes: Change[]) => {
    if (!changes.length) return;
    const ids = changes.flatMap((c) => Object.keys(c.fields).map((f) => markId(c.row.student.key, f)));
    const bump = (d: number) => {
      const m = pendingRef.current;
      for (const id of ids) { const n = (m.get(id) ?? 0) + d; if (n > 0) m.set(id, n); else m.delete(id); }
      setPending(new Map(m));
    };
    const pendingOf = (key: string) => new Set(TRACK_FIELDS.filter((f) => pendingRef.current.has(markId(key, f))));
    const notify = (kind: 'saved' | 'error') => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      setFlash(kind);
      flashTimer.current = setTimeout(() => setFlash(''), kind === 'saved' ? 1800 : 5000);
    };
    setTracks((m) => {
      const n = new Map(m);
      for (const c of changes) n.set(c.row.student.key, { ...(n.get(c.row.student.key) ?? emptyTrack(c.row.student.key)), ...c.fields } as Track);
      return n;
    });
    bump(1);
    setError('');
    try {
      const res = await fetch('/api/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: changes.map((c) => ({ key: c.row.student.key, campus: c.row.student.campus, name: c.row.student.name, fields: c.fields })) }),
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) throw new Error(reasonText(j?.reason));
      bump(-1);
      setTracks((m) => {
        const n = new Map(m);
        for (const t of j.tracks as Track[]) n.set(t.key, mergeSaved(n.get(t.key), t, pendingOf(t.key)));
        return n;
      });
      setSaved((s) => new Set([...s, ...ids]));
      setTimeout(() => setSaved((s) => new Set([...s].filter((id) => !ids.includes(id)))), 1600);
      notify('saved');
    } catch (e) {
      bump(-1);
      setTracks((m) => {
        const n = new Map(m);
        for (const c of changes) {
          const k = c.row.student.key;
          n.set(k, revertFields(n.get(k) ?? emptyTrack(k), c.row.track, Object.keys(c.fields) as TrackField[], pendingOf(k)));
        }
        return n;
      });
      setError(`保存できませんでした。${e instanceof Error && e.message ? e.message : reasonText('network_error')}`);
      notify('error');
    }
  }, []);

  // 生徒を足す（student なし）・足した生徒を直す。失敗したら理由の文を返す（窓に出す）
  const saveStudent = useCallback(async (ed: Editing, input: StudentInput, dept: string): Promise<string> => {
    try {
      const res = await fetch('/api/event/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ed.student?.key ?? '', dept, ...input }),
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) return reasonText(j?.reason);
      const st = j.student as Student;
      setState((s) => (s.status === 'ready' ? { ...s, students: [...s.students.filter((x) => x.key !== st.key), st] } : s));
      setRev((n) => n + 1);
      // 名簿外の申込から足したのに氏名を変えたときは、氏名では結び付かないので、その申込を結び付けておく
      if (ed.app && normName(st.name) !== normName(ed.app.name)) {
        const row = { student: st, track: emptyTrack(st.key) } as StudentRow;
        await save([{ row, fields: { link: ed.app.id } }]);
      }
      return '';
    } catch {
      return reasonText('network_error');
    }
  }, [save]);

  const removeStudent = useCallback(async (st: Student): Promise<string> => {
    try {
      const res = await fetch('/api/event/students', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: st.key }),
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) return reasonText(j?.reason);
      setState((s) => (s.status === 'ready' ? { ...s, students: s.students.filter((x) => x.key !== st.key) } : s));
      setRev((n) => n + 1);
      return '';
    } catch {
      return reasonText('network_error');
    }
  }, []);

  // 最初の読み込み（スプレッドシートを読むので数秒かかる）：これから出る画面の形を、灰色の枠で先に出す
  if (state.status === 'loading') return <div className="ev"><EventHead /><Skeleton view={view} admin={admin} /></div>;
  if (state.status === 'error') {
    return (
      <div className="ev">
        <EventHead />
        <p className="ev-alert">{state.message}</p>
        <button type="button" className="ev-btn" onClick={() => { setState({ status: 'loading' }); load(); }}>もう一度読み込む</button>
      </div>
    );
  }

  const { unmatched } = built;
  const rows = deptView ? built.rows.filter((r) => r.student.dept === deptView) : built.rows;
  // 足す生徒の部門の初めの値：同じ校舎の生徒がいればその部門、いなければ見ている部門
  const deptFor = (c: string) => state.students.find((st) => st.campus === c)?.dept ?? (deptView || DEFAULT_DEPT);
  const inCampus = activeCampus ? rows.filter((r) => r.student.campus === activeCampus) : rows;
  const openCampus = (c: string) => { setCampus(c); setView('list'); setFilter('all'); setGrade(''); setQ(''); };
  // 管理部門だけ：見る部門のプルダウン
  const deptField = admin ? (
    <Field label="部門">
      <select value={deptView} onChange={(e) => { setDeptView(e.target.value); setCampus(''); }}>
        {['', ...DEPTS].map((d) => (
          <option key={d} value={d}>{d || 'すべての部門'}（{built.rows.filter((r) => !d || r.student.dept === d).length}）</option>
        ))}
      </select>
    </Field>
  ) : null;
  const blank = (c: string): StudentInput => ({ campus: c, school: '', grade: '', name: '', dream: '', hope: '' });
  const fromApp = (a: Application): Editing => ({
    app: a, dept: deptFor(a.campus),
    init: { campus: a.campus, school: a.school, grade: GRADES.includes(a.grade) ? a.grade : '', name: a.name, dream: a.interest, hope: '' },
  });
  const edit = (st: Student): Editing => ({ student: st, dept: st.dept, init: { campus: st.campus, school: st.school, grade: st.grade, name: st.name, dream: st.dream, hope: st.hope } });

  return (
    <div className="ev">
      <EventHead />
      <div className="ev-bar">
        <div className="ev-tabs">
          {/* 校舎ごとの進み具合は管理部門だけ。ほかの部門は声掛け名簿から始まる */}
          {admin && <button type="button" className={view === 'overview' ? 'on' : ''} onClick={() => setView('overview')}>校舎ごとの進み具合</button>}
          <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>声掛け名簿</button>
          <button type="button" className={view === 'outside' ? 'on' : ''} onClick={() => setView('outside')}>
            名簿外の申込{unmatched.length > 0 && <span className="ev-count">{unmatched.length}</span>}
          </button>
        </div>
        <div className="ev-fetched">
          {pending.size > 0
            ? <span className="ev-saving"><span className="ev-spin" aria-hidden="true" />保存中…</span>
            : flash === 'saved' ? <span className="ev-saved">✓ 保存しました</span> : `${state.fetchedAt} 時点`}
          <button type="button" className="ev-btn ev-btn-sub" disabled={refreshing} onClick={load}>{refreshing ? '読み込み中…' : '最新にする'}</button>
        </div>
      </div>
      {refreshing && <div className="ev-loadbar" role="status" aria-label="最新の名簿と申込状況を読み込んでいます" />}

      {admin && view !== 'list' && <div className="ev-toolbar">{deptField}</div>}

      {error && <p className="ev-alert" role="alert">{error}</p>}
      {state.formStatus !== 'ok' && (
        <p className="ev-warn">
          {state.formStatus === 'not_set'
            ? '申込フォームの回答はまだつながっていません（Apps Script の FORM_BOOK_ID が未設定）。申込の状況はまだ出ません。'
            : '申込フォームの回答のスプレッドシートを開けませんでした。申込の状況が出ていません。管理者に伝えてください。'}
        </p>
      )}
      {state.backend === 'local' && <p className="ev-warn">手元の開発用データ（架空の名簿）を表示しています。</p>}

      {view === 'overview' && <Overview rows={rows} campuses={campuses} unmatched={unmatched.length} onOpen={openCampus} />}

      {view === 'list' && (
        <CampusList
          rows={inCampus} allRows={rows} campuses={campuses} campus={activeCampus} onCampus={setCampus} lead={deptField}
          scope={`${activeCampus}|${state.fetchedAt}|${rev}`} showCampus={activeCampus === ''} filter={filter} onFilter={setFilter}
          sort={sort} onSort={setSort} grade={grade} onGrade={setGrade} q={q} onQ={setQ}
          onSave={save} marks={{ pending, saved }} onDetail={(app, row) => setDetail({ app, row })}
          onAdd={() => setEditing({ init: blank(activeCampus), dept: deptFor(activeCampus) })} onEdit={(st) => setEditing(edit(st))}
        />
      )}

      {view === 'outside' && (
        <Outside apps={unmatched} rows={rows} campuses={campuses} onLink={(app, row) => save([{ row, fields: { link: [...linkIds(row.track.link), app.id].join('\n') } }])} onDetail={(app) => setDetail({ app, row: null })} onAdd={(app) => setEditing(fromApp(app))} />
      )}

      {/* 保存の様子：表を下まで送っていても見えるよう、画面の下にも出す */}
      {(pending.size > 0 || flash) && (
        <div className={`ev-toast ${pending.size > 0 ? 'saving' : flash}`} role="status" aria-live="polite">
          {pending.size > 0
            ? <><span className="ev-spin" aria-hidden="true" />保存中…</>
            : flash === 'saved' ? '✓ 保存しました' : '保存できませんでした。もう一度押してください'}
        </div>
      )}

      {editing && (
        <StudentDialog
          editing={editing} admin={admin} campuses={campuses} students={state.students} onClose={() => setEditing(null)}
          onSave={(input, dept) => saveStudent(editing, input, dept)} onRemove={editing.student ? () => removeStudent(editing.student!) : undefined}
        />
      )}

      {detail && (
        <AppDetail
          app={detail.app} row={detail.row} onClose={() => setDetail(null)}
          onUnlink={(row, app) => { save([{ row, fields: { link: linkIds(row.track.link).filter((id) => id !== app.id).join('\n') } }]); setDetail(null); }}
        />
      )}
    </div>
  );
}

// ---- 読み込み中の枠（スケルトン） -----------------------------------------------

// 幅をばらつかせて、文字の行らしく見せる（決まった並びなので、描き直しても形が変わらない）
const SK_WIDTHS = [72, 54, 88, 63, 80, 46, 92, 58, 76, 66];
const Sk = ({ w, h = 14 }: { w: number | string; h?: number }) => (
  <span className="ev-sk" style={{ width: typeof w === 'number' ? `${w}px` : w, height: `${h}px` }} />
);

function Skeleton({ view, admin }: { view: View; admin: boolean }) {
  const cols = view === 'overview' ? [70, 40, 150, 150, 150, 110, 150, 50, 60] : [44, 130, 170, 54, 54, 108, 54, 70, 210, 150];
  const rows = view === 'overview' ? 6 : 10;
  return (
    <div className="ev-skeleton" role="status" aria-busy="true" aria-label="名簿と申込状況を読み込んでいます">
      <div className="ev-bar">
        <div className="ev-tabs">
          {admin && <button type="button" className={view === 'overview' ? 'on' : ''} disabled>校舎ごとの進み具合</button>}
          <button type="button" className={view === 'list' ? 'on' : ''} disabled>声掛け名簿</button>
          <button type="button" disabled>名簿外の申込</button>
        </div>
        <div className="ev-fetched">名簿と申込状況を読み込んでいます…</div>
      </div>
      {admin && view !== 'list' && <div className="ev-toolbar"><span className="ev-fld"><Sk w={34} h={12} /><Sk w={170} h={44} /></span></div>}
      {view === 'overview' ? (
        <div className="ev-cards">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="ev-card"><Sk w={`${SK_WIDTHS[i]}%`} h={12} /><Sk w={70} h={30} /><Sk w={`${SK_WIDTHS[i + 3]}%`} h={11} /></div>
          ))}
        </div>
      ) : (
        <>
          <div className="ev-toolbar">
            {[170, 210, 140, 220, 240].map((w, i) => <span key={i} className="ev-fld"><Sk w={56} h={12} /><Sk w={w} h={44} /></span>)}
          </div>
          <div className="ev-actions"><Sk w={220} h={16} /><span className="ev-spacer" /><Sk w={240} h={44} /><Sk w={130} h={44} /></div>
        </>
      )}
      <div className="ev-scroll">
        <table className="ev-table">
          <thead><tr>{cols.map((w, i) => <th key={i}><Sk w={Math.round(w * 0.5)} h={11} /></th>)}</tr></thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {cols.map((w, i) => <td key={i}><Sk w={Math.round((w * SK_WIDTHS[(r + i) % SK_WIDTHS.length]) / 92)} h={view === 'list' && [3, 4, 5, 6].includes(i) ? 28 : 14} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- 見出し ---------------------------------------------------------------

function EventHead() {
  const today = todayJp();
  const d = daysUntil(EVENT.date, today);
  const dl = EVENT.deadline ? daysUntil(EVENT.deadline, today) : null;
  return (
    <header className="ev-head">
      <div>
        <div className="ev-head-partner">{EVENT.partner}</div>
        <h1>{EVENT.name}</h1>
        <p className="ev-head-meta">{EVENT.dateLabel}　／　{EVENT.place}</p>
        <p className="ev-head-pitch">{EVENT.pitch}</p>
      </div>
      <div className="ev-head-days">
        {d != null && (d > 0 ? <>開催まで<b>{d}</b>日</> : d === 0 ? <b>本日開催</b> : <>開催済み</>)}
        {dl != null && dl >= 0 && <span>申込締切まで {dl} 日（{shortDay(EVENT.deadline)}）</span>}
      </div>
    </header>
  );
}

// ---- 校舎ごとの進み具合（管理担当） -------------------------------------------

function Bar({ n, total, tone = '' }: { n: number; total: number; tone?: string }) {
  const p = pct(n, total);
  return (
    <div className="ev-barcell">
      <div className="ev-track"><div className={`ev-fill ${tone}`} style={{ width: `${p}%` }} /></div>
      <span className="ev-barnum"><b>{n}</b>/{total}<small>{p}%</small></span>
    </div>
  );
}

function Overview({ rows, campuses, unmatched, onOpen }: { rows: StudentRow[]; campuses: string[]; unmatched: number; onOpen: (c: string) => void }) {
  const all = summarize('全体', rows);
  const list = campuses.map((c) => summarize(c, rows.filter((r) => r.student.campus === c)));
  const line = (s: Summary, total = false) => (
    <tr key={s.campus} className={total ? 'ev-total' : ''}>
      <th scope="row">{total ? s.campus : <button type="button" className="ev-link" onClick={() => onOpen(s.campus)}>{s.campus}</button>}</th>
      <td className="num">{s.total}</td>
      <td><Bar n={s.flyer} total={s.total} /></td>
      <td><Bar n={s.talked} total={s.total} /></td>
      <td><Bar n={s.applied} total={s.total} tone="ok" /></td>
      <td className="num">{s.studentApplied}<small>／同伴 {s.companions}人</small></td>
      <td><Bar n={s.priorityApplied} total={s.priority} tone="ok" /></td>
      <td className={`num ${s.priorityOpen > 0 ? 'ev-hot' : ''}`}>{s.priorityOpen}</td>
      <td className="num">{s.wants + s.considering}</td>
      <td className="num">{s.declined}</td>
      <td className={`num ${s.untouched > 0 ? 'ev-dim-hot' : ''}`}>{s.untouched}</td>
      <td className="ev-updated">{s.lastUpdated ? s.lastUpdated.slice(5) : '—'}</td>
    </tr>
  );
  return (
    <section>
      <div className="ev-cards">
        <div className="ev-card"><span>対象の生徒</span><b>{all.total}</b><small>うち重点 {all.priority} 名</small></div>
        <div className="ev-card"><span>チラシ配布</span><b>{pct(all.flyer, all.total)}<i>%</i></b><small>{all.flyer} / {all.total} 名</small></div>
        <div className="ev-card"><span>声掛け</span><b>{pct(all.talked, all.total)}<i>%</i></b><small>{all.talked} / {all.total} 名</small></div>
        <div className="ev-card ok"><span>申込（名簿の生徒）</span><b>{all.applied}</b><small>生徒 {all.studentApplied}・同伴 {all.companions}人／名簿外 {unmatched} 件</small></div>
        <div className="ev-card ok"><span>重点の申込</span><b>{all.priorityApplied}<i> / {all.priority}</i></b><small>薬剤師・医療系を目指す生徒</small></div>
        <div className={`ev-card ${all.priorityOpen > 0 ? 'hot' : ''}`}><span>重点で未決</span><b>{all.priorityOpen}</b><small>申込も不参加も決まっていない</small></div>
      </div>
      <div className="ev-scroll">
        <table className="ev-table ev-overview">
          <thead>
            <tr>
              <th>校舎</th><th>対象</th><th>チラシ配布</th><th>声掛け</th><th>申込</th><th>申込の内訳（生徒／同伴の方）</th>
              <th>重点の申込</th><th>重点で未決</th><th>参加したい・検討中</th><th>不参加</th><th>未着手</th><th>最終更新</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => line(s))}
            {line(all, true)}
          </tbody>
        </table>
      </div>
      <p className="ev-hint">
        校舎名を押すと、その校舎の声掛け名簿が開きます。「声掛け」は、声を掛けた日・反応・申込のどれかが入っている生徒の数です。
        「重点」は、夢・志や志望校に薬剤師・医療系の言葉がある生徒と、教室担当が ★ を付けた生徒です。
      </p>
    </section>
  );
}

// ---- 声掛け名簿（教室担当） --------------------------------------------------

// ラベル付きの入力（プルダウン・検索欄）。絞り込みの並びに横に並べ、狭い幅では折り返す
function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={`ev-fld ${wide ? 'wide' : ''}`}><span>{label}</span>{children}</label>;
}

function CampusList({
  rows, allRows, campuses, campus, onCampus, lead, scope, showCampus, filter, onFilter, sort, onSort, grade, onGrade, q, onQ, onSave, marks, onDetail, onAdd, onEdit,
}: {
  rows: StudentRow[]; allRows: StudentRow[]; campuses: string[]; campus: string; onCampus: (c: string) => void; lead: ReactNode;
  scope: string; showCampus: boolean; filter: Filter; onFilter: (f: Filter) => void; sort: SortKey; onSort: (s: SortKey) => void;
  grade: string; onGrade: (g: string) => void;
  q: string; onQ: (v: string) => void; onSave: (c: Change[]) => void; marks: SaveMarks; onDetail: (app: Application, row: StudentRow) => void;
  onAdd: () => void; onEdit: (st: Student) => void;
}) {
  // 学年の選択肢：小1〜高3 の順。それ以外の書き方（高等部の「本科」など）は後ろに足す
  const grades = useMemo(() => {
    const have = new Set(rows.map((r) => r.student.grade).filter(Boolean));
    return [...GRADES.filter((g) => have.has(g)), ...[...have].filter((g) => !GRADES.includes(g))];
  }, [rows]);
  const scoped = rows.filter((r) => !grade || r.student.grade === grade);
  const test = FILTERS.find((f) => f.key === filter)!.test;
  const key = q.replace(/\s/g, '');
  // 並びと顔ぶれは、校舎・絞り込み・学年・並び順・検索を変えたとき（と読み込み直したとき）にだけ決め直す。
  // 記録を付けるたびに並べ直すと、押した行が動いたり消えたりして続けて入力できないため
  const [tick, setTick] = useState(0);
  const sig = `${scope}|${filter}|${sort}|${grade}|${key}|${tick}`;
  const frozen = useRef<{ sig: string; keys: string[] }>({ sig: '', keys: [] });
  if (frozen.current.sig !== sig) {
    // 氏名で探すときは「表示する生徒」の絞り込みを外す（申込済の生徒は「することがある」に出ないので、探しても見つからず、
    // 申込が反映されていないように見えるため）。校舎と学年はそのまま効かせる
    const list = sortRowsBy(key ? scoped.filter((r) => r.student.name.replace(/\s/g, '').includes(key)) : scoped.filter(test), sort, campuses);
    frozen.current = { sig, keys: list.map((r) => r.student.key) };
  }
  const byKey = new Map(rows.map((r) => [r.student.key, r]));
  const shown = frozen.current.keys.map((k) => byKey.get(k)).filter((r): r is StudentRow => !!r);
  const today = todayJp();
  const [bulk, setBulk] = useState(false); // ［一括で記録］の窓

  return (
    <section>
      {/* 絞り込みの並び：どれもラベル付きのプルダウン。校舎 → 表示する生徒 → 学年 → 並び順 → 氏名 */}
      <div className="ev-toolbar">
        {lead}
        <Field label="校舎">
          <select value={campus} onChange={(e) => onCampus(e.target.value)}>
            <option value="">すべての校舎（{allRows.length}）</option>
            {campuses.map((c) => <option key={c} value={c}>{c}（{allRows.filter((r) => r.student.campus === c).length}）</option>)}
          </select>
        </Field>
        <Field label="表示する生徒">
          <select value={filter} onChange={(e) => { onFilter(e.target.value as Filter); setTick((n) => n + 1); }}>
            {FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}（{scoped.filter(f.test).length}）</option>)}
          </select>
        </Field>
        <Field label="学年">
          <select value={grade} onChange={(e) => onGrade(e.target.value)}>
            <option value="">すべての学年</option>
            {grades.map((g) => <option key={g} value={g}>{g}（{rows.filter((r) => r.student.grade === g).length}）</option>)}
          </select>
        </Field>
        <Field label="並び順">
          <select value={sort} onChange={(e) => { onSort(e.target.value as SortKey); setTick((n) => n + 1); }}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="氏名で絞り込み" wide>
          <input type="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder="例：山田" />
        </Field>
      </div>
      <div className="ev-actions">
        <span className="ev-result" role="status">
          <b>{shown.length}</b>名を表示（{campus || 'すべての校舎'}：{rows.length}名）
          {scoped.filter((r) => r.urgent).length > 0 && <em>重点で未決 {scoped.filter((r) => r.urgent).length}名</em>}
          {key && filter !== 'all' && <span className="ev-result-note">氏名で探すあいだは「表示する生徒」に関係なく、全員から探します</span>}
        </span>
        <span className="ev-spacer" />
        <button type="button" className="ev-btn ev-btn-sub" disabled={!shown.length || marks.pending.size > 0} onClick={() => setBulk(true)}>
          一括で記録
        </button>
        <button type="button" className="ev-btn" onClick={onAdd}>＋ 生徒を追加</button>
      </div>
      <div className="ev-scroll">
        <table className="ev-table ev-list">
          <thead>
            <tr>
              <th>重点</th><th>生徒</th><th>夢・志／志望校</th><th>チラシ</th><th>声掛け</th><th>反応</th><th>保護者へ案内</th><th>申込（フォーム）</th>
              <th>次にすること</th><th>メモ</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => <Row key={r.student.key} row={r} showCampus={showCampus} today={today} onSave={onSave} marks={marks} onDetail={onDetail} onEdit={onEdit} />)}
            {!shown.length && <tr><td colSpan={10} className="ev-empty">この条件の生徒はいません。</td></tr>}
          </tbody>
        </table>
      </div>
      {bulk && <BulkDialog rows={shown} showCampus={showCampus} today={today} onRun={onSave} onClose={() => setBulk(false)} />}
      <p className="ev-hint">
        チラシ・声掛け・保護者へ案内は、スイッチを押すとオンになり今日の日付が入ります（もう一度押すとオフ）。押した所に「保存中」が出て、保存できると ✓ が出ます。
        クラスで配ったあとなど、何人もまとめて付けるときは［一括で記録］を使ってください。
        申込は、チラシの QR コードのフォームから申し込まれると自動で「申込済」になります（画面からは入れません）。★ を押すと、重点の付け外しができます。
        記録を付けても行の並びはそのままです（上の「表示する生徒」「並び順」を選び直すか［最新にする］で並べ直します）。
      </p>
    </section>
  );
}

// 一括で記録：表示中の生徒をチェックボックスで選び、チラシ配布済み・声掛け済みなどをまとめて記録する
function BulkDialog({ rows, showCampus, today, onRun, onClose }: {
  rows: StudentRow[]; showCampus: boolean; today: string; onRun: (c: Change[]) => void; onClose: () => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<BulkAction['mode']>('on');
  const [items, setItems] = useState<DayField[]>([]);
  const [reaction, setReaction] = useState<Reaction | null>(null); // null＝変えない
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const toggle = (key: string) => setPicked((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleItem = (f: DayField) => setItems((a) => (a.includes(f) ? a.filter((x) => x !== f) : [...a, f]));
  const chosen = rows.filter((r) => picked.has(r.student.key));
  const action: BulkAction = { mode, items, reaction: mode === 'on' ? reaction : null };
  const changes = bulkChanges(chosen, action, today);
  const hasAction = items.length > 0 || (mode === 'on' && reaction != null);
  const what = [
    ...DAY_FIELDS.filter((d) => items.includes(d.key)).map((d) => (mode === 'on' ? d.done : `${d.label}を未に戻す`)),
    ...(mode === 'on' && reaction != null ? [`反応を「${reaction || '未記入'}」に`] : []),
  ].join('・');
  return (
    <div className="ev-modal" role="dialog" aria-modal="true" aria-label="一括で記録" onClick={onClose}>
      <div className="ev-modal-body ev-bulk" onClick={(e) => e.stopPropagation()}>
        <h2>一括で記録<small>（名簿に表示中の {rows.length}名から選ぶ）</small></h2>
        <div className="ev-bulk-head">
          <button type="button" className="ev-btn ev-btn-sub" onClick={() => setPicked(new Set(rows.map((r) => r.student.key)))}>すべて選ぶ</button>
          <button type="button" className="ev-btn ev-btn-sub" disabled={!picked.size} onClick={() => setPicked(new Set())}>すべて外す</button>
          <span className="ev-spacer" />
          <span className="ev-result" role="status"><b>{chosen.length}</b>名を選択中</span>
        </div>
        <ul className="ev-bulk-list">
          {rows.map((r) => {
            const st = r.student;
            return (
              <li key={st.key}>
                <label className={picked.has(st.key) ? 'on' : ''}>
                  <input type="checkbox" checked={picked.has(st.key)} onChange={() => toggle(st.key)} />
                  <span className="ev-bulk-name">{st.name}<small>{showCampus ? `${st.campus}・` : ''}{st.grade}</small></span>
                  <span className="ev-bulk-now">
                    {DAY_FIELDS.map((d) => (
                      <span key={d.key} className={r.track[d.key] ? 'on' : ''}>{d.label}{r.track[d.key] ? `済 ${shortDay(r.track[d.key])}` : '未'}</span>
                    ))}
                    {r.stage === 'applied' && <span className="on">申込済</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <fieldset className="ev-bulk-action">
          <legend>選んだ生徒に記録する内容</legend>
          <div className="ev-seg" role="radiogroup" aria-label="済みにする・未に戻す">
            <label className={mode === 'on' ? 'on' : ''}><input type="radio" name="ev-bulk-mode" checked={mode === 'on'} onChange={() => setMode('on')} />済みにする（今日の日付）</label>
            <label className={mode === 'off' ? 'on' : ''}><input type="radio" name="ev-bulk-mode" checked={mode === 'off'} onChange={() => setMode('off')} />未に戻す（取り消し）</label>
          </div>
          <div className="ev-bulk-items">
            {DAY_FIELDS.map((d) => (
              <label key={d.key} className={items.includes(d.key) ? 'on' : ''}>
                <input type="checkbox" checked={items.includes(d.key)} onChange={() => toggleItem(d.key)} />
                {mode === 'on' ? `${d.done}にする` : `${d.label}を未に戻す`}
              </label>
            ))}
          </div>
          {mode === 'on' && (
            <Field label="反応（まとめて入れるとき）">
              <select value={reaction == null ? '__keep' : reaction} onChange={(e) => setReaction(e.target.value === '__keep' ? null : (e.target.value as Reaction))}>
                <option value="__keep">変えない</option>
                {REACTIONS.filter((x) => x).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
          )}
        </fieldset>
        <p className="ev-bulk-summary" role="status">
          {!chosen.length ? '生徒を選んでください。'
            : !hasAction ? '記録する内容を選んでください。'
              : changes.length ? `${changes.length}名に記録します：${what}。${changes.length < chosen.length ? `（選んだ ${chosen.length}名のうち、${chosen.length - changes.length}名はすでにその状態なので変えません）` : ''}`
                : `選んだ ${chosen.length}名は、すでにその状態です（変えるところがありません）。`}
        </p>
        <div className="ev-modal-foot">
          <span className="ev-spacer" />
          <button type="button" className="ev-btn ev-btn-sub" onClick={onClose}>やめる</button>
          <button type="button" className="ev-btn" disabled={!changes.length} onClick={() => { onRun(changes); onClose(); }}>
            {changes.length ? `${changes.length}名に記録する` : '記録する'}
          </button>
        </div>
      </div>
    </div>
  );
}

// オン／オフのスイッチ。オン＝右・色つき＋「済 11/18」、オフ＝左・灰色＋「未」。保存の途中は「保存中」を出し、押しても受け付けない
function Toggle({ on, label, onText, offText = '未', state, onToggle }: {
  on: boolean; label: string; onText: ReactNode; offText?: string; state: '' | 'saving' | 'saved'; onToggle: () => void;
}) {
  const saving = state === 'saving';
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} aria-busy={saving} aria-disabled={saving}
      className={`ev-toggle ${on ? 'on' : ''} ${state}`} onClick={() => { if (!saving) onToggle(); }}
    >
      <span className="ev-toggle-track" aria-hidden="true"><span className="ev-toggle-knob">{saving && <span className="ev-spin" />}</span></span>
      <span className="ev-toggle-text">
        {saving ? '保存中…' : on ? onText : offText}
        {state === 'saved' && <span className="ev-tick" aria-label="保存しました">✓</span>}
      </span>
    </button>
  );
}

function Row({ row, showCampus, today, onSave, marks, onDetail, onEdit }: {
  row: StudentRow; showCampus: boolean; today: string; onSave: (c: Change[]) => void; marks: SaveMarks;
  onDetail: (app: Application, row: StudentRow) => void; onEdit: (st: Student) => void;
}) {
  const { student: st, track: t } = row;
  const stateOf = (f: TrackField): '' | 'saving' | 'saved' =>
    marks.pending.has(markId(st.key, f)) ? 'saving' : marks.saved.has(markId(st.key, f)) ? 'saved' : '';
  // 同じ項目の保存の途中は受け付けない（続けて押して、オン・オフが行ったり来たりしないように）
  const set = (fields: Partial<Record<TrackField, string>>) => {
    if (Object.keys(fields).some((f) => marks.pending.has(markId(st.key, f)))) return;
    onSave([{ row, fields }]);
  };
  const dayToggle = (f: 'flyer' | 'talk' | 'parent', label: string) => (
    <Toggle
      on={!!t[f]} label={label} state={stateOf(f)} onText={<>済<small>{shortDay(t[f])}</small></>}
      onToggle={() => set({ [f]: t[f] ? '' : today })}
    />
  );
  // ★：自動で付いた重点は「外す（0）」⇄「自動に戻す」、付いていない生徒は「付ける（1）」⇄「外す」
  const auto = autoPriority(st, PRIORITY_WORDS);
  const togglePriority = () => set({ priority: auto ? (t.priority === '0' ? '' : '0') : (t.priority === '1' ? '' : '1') });
  const reactionState = stateOf('reaction');
  return (
    <tr className={`${row.urgent ? 'ev-urgent' : ''} ${row.todo === '' ? 'ev-done' : ''}`}>
      <td>
        <button
          type="button" className={`ev-star ${row.priority} ${stateOf('priority')}`} onClick={togglePriority}
          title={row.priority ? `重点（${PRIORITY_LABEL[row.priority]}）。押すと外します` : '押すと重点にします'}
          aria-label={row.priority ? '重点から外す' : '重点にする'} aria-pressed={row.priority !== ''} aria-busy={stateOf('priority') === 'saving'}
        >
          {stateOf('priority') === 'saving' ? <span className="ev-spin" aria-hidden="true" /> : row.priority === 'pharma' ? '★薬' : row.priority === 'medical' ? '★医' : row.priority === 'manual' ? '★' : '☆'}
        </button>
      </td>
      <td className="ev-name">
        <b>
          {st.name}
          {st.added && <button type="button" className="ev-added" onClick={() => onEdit(st)} title="アプリで足した生徒です。押すと直す・外すができます">追加 ✎</button>}
        </b>
        <small>{showCampus ? `${st.campus}・` : ''}{st.grade}{st.school ? `・${st.school}` : ''}</small>
        {/* スマホでは「次にすること」の列が右に隠れるので、氏名の下にも出す */}
        {row.todo && <em className="ev-name-todo">{row.todo}</em>}
      </td>
      <td className="ev-dream">{st.dream || <i>未記入</i>}{st.hope && <small>志望校：{st.hope}</small>}</td>
      <td>{dayToggle('flyer', 'チラシを渡した')}</td>
      <td>{dayToggle('talk', '声を掛けた')}</td>
      <td>
        <span className={`ev-field ${reactionState}`}>
          <select
            className={`ev-reaction r-${REACTIONS.indexOf(t.reaction)}`} value={t.reaction} aria-label="反応" disabled={reactionState === 'saving'}
            onChange={(e) => {
              const reaction = e.target.value as Reaction;
              // 反応を聞けたなら、声は掛けている
              set(reaction && !t.talk ? { reaction, talk: today } : { reaction });
            }}
          >
            {REACTIONS.map((x) => <option key={x} value={x}>{x || '—'}</option>)}
          </select>
          <SaveNote state={reactionState} />
        </span>
      </td>
      <td>{dayToggle('parent', '保護者へ案内した')}</td>
      <td>
        <div className="ev-apply">
          {row.apps.map((a) => (
            <button key={a.id} type="button" className="ev-badge ok" onClick={() => onDetail(a, row)} title="フォームの回答を見る">
              申込済<small>{appLabel(a)}</small>
            </button>
          ))}
          {!row.apps.length && <span className="ev-noapply">未申込</span>}
        </div>
      </td>
      <td className="ev-todo">{row.todo || <span className={`ev-stage ${row.stage}`}>{STAGE_LABEL[row.stage]}</span>}</td>
      <td><Memo value={t.memo} state={stateOf('memo')} onSave={(memo) => set({ memo })} /></td>
    </tr>
  );
}

// 入力欄の下に出す、保存の様子（保存中…／✓ 保存しました）
function SaveNote({ state }: { state: '' | 'saving' | 'saved' }) {
  if (!state) return null;
  return (
    <span className={`ev-savenote ${state}`} role="status">
      {state === 'saving' ? <><span className="ev-spin" aria-hidden="true" />保存中…</> : '✓ 保存しました'}
    </span>
  );
}

function Memo({ value, state, onSave }: { value: string; state: '' | 'saving' | 'saved'; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <span className={`ev-field ${state}`}>
      <input
        className="ev-memo" value={v} maxLength={500} placeholder="メモ" aria-label="メモ" readOnly={state === 'saving'}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (v.trim() !== value) onSave(v.trim()); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }}
      />
      <SaveNote state={state} />
    </span>
  );
}

// ---- 名簿外の申込 -----------------------------------------------------------

function Outside({ apps, rows, campuses, onLink, onDetail, onAdd }: {
  apps: Application[]; rows: StudentRow[]; campuses: string[]; onLink: (app: Application, row: StudentRow) => void; onDetail: (app: Application) => void;
  onAdd: (app: Application) => void;
}) {
  const [pick, setPick] = useState<Record<string, string>>({});
  if (!apps.length) return <p className="ev-note">名簿の誰とも結び付いていない申込はありません。</p>;
  return (
    <section>
      <p className="ev-hint">
        フォームの回答のうち、名簿の生徒と氏名が合わなかったものです（RED個別・高校生・小学生・外部の方、氏名の書き方が違う方、同姓同名で決められなかった方）。
        名簿の生徒の申込なら、生徒を選んで［結び付ける］を押すと、その生徒の「申込」に入ります。
        名簿にいない生徒は［名簿に足す］で声掛け名簿に足せます（申込済として入ります）。
      </p>
      <div className="ev-scroll">
        <table className="ev-table">
          <thead><tr><th>回答日時</th><th>氏名</th><th>学年</th><th>学校</th><th>校舎</th><th>参加</th><th>名簿の生徒に結び付ける</th><th /></tr></thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id}>
                <td className="ev-updated">{a.at}</td>
                <td className="ev-name"><b>{a.name}</b>{a.parentName && a.parentName !== a.name && <small>保護者：{a.parentName}</small>}</td>
                <td>{a.grade}</td>
                <td>{a.school}</td>
                <td>{a.campus}</td>
                <td>{appLabel(a)}</td>
                <td>
                  <div className="ev-linker">
                  <select value={pick[a.id] ?? ''} onChange={(e) => setPick((p) => ({ ...p, [a.id]: e.target.value }))} aria-label="名簿の生徒">
                    <option value="">生徒を選ぶ</option>
                    {campuses.map((c) => (
                      <optgroup key={c} label={c}>
                        {rows.filter((r) => r.student.campus === c).map((r) => (
                          <option key={r.student.key} value={r.student.key}>{r.student.grade} {r.student.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    type="button" className="ev-btn" disabled={!pick[a.id]}
                    onClick={() => { const row = rows.find((r) => r.student.key === pick[a.id]); if (row) onLink(a, row); }}
                  >結び付ける</button>
                  </div>
                </td>
                <td>
                  {/* 表のマスそのものを横並び（flex）にすると表の形が崩れるので、中に入れ物を置く */}
                  <div className="ev-linker">
                    <button type="button" className="ev-btn" onClick={() => onAdd(a)}>名簿に足す</button>
                    <button type="button" className="ev-btn ev-btn-sub" onClick={() => onDetail(a)}>回答を見る</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- フォームの回答の詳細 ----------------------------------------------------

function AppDetail({ app, row, onClose, onUnlink }: {
  app: Application; row: StudentRow | null; onClose: () => void; onUnlink: (row: StudentRow, app: Application) => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const linked = !!row && linkIds(row.track.link).includes(app.id);
  return (
    <div className="ev-modal" role="dialog" aria-modal="true" aria-label="フォームの回答" onClick={onClose}>
      <div className="ev-modal-body" onClick={(e) => e.stopPropagation()}>
        <h2>フォームの回答{row && <small>（{row.student.campus}・{row.student.grade} {row.student.name}）</small>}</h2>
        <dl>
          {app.answers.map(([h, v], i) => (
            <div key={i}><dt>{h}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        <div className="ev-modal-foot">
          {linked && row && <button type="button" className="ev-btn ev-btn-sub" onClick={() => onUnlink(row, app)}>この生徒との結び付けを外す</button>}
          <span className="ev-spacer" />
          <button type="button" className="ev-btn" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

// ---- 生徒を足す・直す --------------------------------------------------------

function StudentDialog({ editing, admin, campuses, students, onClose, onSave, onRemove }: {
  editing: Editing; admin: boolean; campuses: string[]; students: Student[]; onClose: () => void;
  onSave: (input: StudentInput, dept: string) => Promise<string>; onRemove?: () => Promise<string>;
}) {
  const [v, setV] = useState<StudentInput>(editing.init);
  const [dept, setDept] = useState(editing.dept);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, busy]);
  const set = (k: keyof StudentInput) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const same = sameNameStudents(students, v.name, editing.student?.key);
  const ready = v.campus.trim() !== '' && v.name.trim() !== '';
  const run = async (f: () => Promise<string>) => {
    setBusy(true);
    setErr('');
    const msg = await f();
    setBusy(false);
    if (msg) setErr(msg); else onClose();
  };
  const grades = v.grade && !GRADES.includes(normGrade(v.grade)) ? [...GRADES, v.grade] : GRADES;
  return (
    <div className="ev-modal" role="dialog" aria-modal="true" aria-label={editing.student ? '生徒を直す' : '生徒を追加'} onClick={() => { if (!busy) onClose(); }}>
      <form className="ev-modal-body ev-form" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (ready && !busy) run(() => onSave(v, dept)); }}>
        <h2>{editing.student ? '足した生徒を直す' : '生徒を追加'}{editing.app && <small>（フォームの回答から）</small>}</h2>
        <p className="ev-hint">
          名簿のスプレッドシートに無い生徒（RED個別・高校生・外部の生徒など）を、このイベントの声掛け名簿に足します。
          名簿のスプレッドシートには書き込みません。
        </p>
        <div className="ev-form-grid">
          {admin && !editing.student && (
            <label className="wide">部門（この部門の職員の名簿に入ります）
              <select value={dept} onChange={(e) => setDept(e.target.value)}>
                {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          )}
          <label>校舎（必須）
            <input value={v.campus} onChange={set('campus')} list="ev-campus-list" maxLength={30} placeholder="例：駅前校、RED広田" required />
            <datalist id="ev-campus-list">{campuses.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label>学年
            <select value={v.grade} onChange={set('grade')}>
              <option value="">—</option>
              {grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label>氏名（必須）
            <input value={v.name} onChange={set('name')} maxLength={40} placeholder="例：智翔 花子" required autoFocus={!editing.student && !editing.app} />
          </label>
          <label>学校
            <input value={v.school} onChange={set('school')} maxLength={40} placeholder="例：広田中" />
          </label>
          <label className="wide">夢・志（薬剤師・医療系の言葉があると重点になります）
            <input value={v.dream} onChange={set('dream')} maxLength={200} placeholder="例：薬剤師" />
          </label>
          <label className="wide">志望校
            <input value={v.hope} onChange={set('hope')} maxLength={200} />
          </label>
        </div>
        {same.length > 0 && (
          <p className="ev-warn">
            同じ氏名の生徒がすでに名簿にいます：{same.map((st) => `${st.campus} ${st.grade} ${st.name}`).join('、')}。
            同じ生徒なら足さずに、名簿外の申込の［結び付ける］を使ってください。
          </p>
        )}
        {err && <p className="ev-alert" role="alert">{err}</p>}
        <div className="ev-modal-foot">
          {onRemove && (
            <button
              type="button" className="ev-btn ev-btn-danger" disabled={busy}
              onClick={() => { if (window.confirm(`${editing.student?.name} さんを声掛け名簿から外します。よろしいですか？`)) run(onRemove); }}
            >名簿から外す</button>
          )}
          <span className="ev-spacer" />
          <button type="button" className="ev-btn ev-btn-sub" disabled={busy} onClick={onClose}>やめる</button>
          <button type="submit" className="ev-btn" disabled={!ready || busy}>{busy ? '保存中…' : editing.student ? '保存する' : '追加する'}</button>
        </div>
      </form>
    </div>
  );
}
