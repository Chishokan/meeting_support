'use client';

// 本番レベル模試（/moshi）の画面で共通に使う部品：データの読み込み、回と校舎の選択、表示の小物。
// 個人成績表（A4 横の帳票）は components/MoshiReportSheet.tsx。
// 計算は lib/moshi/model.ts、志望校の名前は lib/moshi/schools.ts。

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CAMPUS_NAMES, SUBJECT_KEYS, campusInfo, round1, sortExams, type KenitsuExam, type KenitsuResult, type MoshiExam, type MoshiResult } from '@/lib/moshi/model';
import { MOSHI_DEPTS } from '@/lib/moshi/access';

// ---- 失敗の理由 ------------------------------------------------------------

const REASONS: Record<string, string> = {
  not_configured: '成績管理の保存先（成績管理DB の Apps Script。環境変数 SEISEKI_SCRIPT_URL）が未設定です。管理者に伝えてください。',
  not_deployed: '成績管理の保存先のスクリプトが古いか、別のスクリプトを指しています。管理者に、成績管理DB の Apps Script（apps_script/seiseki.gs）の出し直しと SEISEKI_SCRIPT_URL を確かめてもらってください。',
  invalid_token: '成績管理の保存先の合言葉（SEISEKI_SCRIPT_TOKEN）が、Apps Script の TOKEN と合っていません。管理者に伝えてください。',
  forbidden: `${MOSHI_DEPTS.join('・')}の職員だけが使えます。`,
  unauthorized: 'ログインが切れました。ページを読み込み直して、ログインし直してください。',
  upstream_error: 'スプレッドシートの読み書きに失敗しました。少し待ってからもう一度試してください。',
  network_error: '通信エラーが起きました。もう一度試してください。',
  timeout: 'スプレッドシートの応答が遅く、途中で止まりました。もう一度試してください。',
  exam_not_found: 'この回が見つかりません（他の人が消したかもしれません）。ページを読み込み直してください。',
  bad_score: '配点を超える得点か、数字でない得点があります。',
  bad_exam_no: '受験番号は数字で入れてください。',
  bad_campus: '校舎を選び直してください。',
  no_name: '模試名を入れてください。',
  bad_date: '実施日を選び直してください。',
  bad_questions: '大問は1つ以上・10まで入れてください。',
  bad_max: '配点は1〜100の整数で入れてください。',
  bad_outside: '偏差値の換算（母数・平均点・標準偏差）に読めない数があります。',
  bad_judge: '判定基準（B判定基準偏差値・B判定基準得点・定員）に読めない数があります。',
  bad_rule: '判定教科が読めません（例：5科合計・3科合計・国数のみ・国数英1.5倍・英数2倍、国理1.5倍）。',
  bad_judge_options: '判定のあいだの偏差値・入学者の偏差値のばらつきに読めない数があります。',
  has_results: 'この回には成績が入っています。',
  not_found: '見つかりませんでした（他の人が消したかもしれません）。',
};

export function reasonText(reason: unknown, detail?: unknown): string {
  const r = String(reason ?? '');
  const base = REASONS[r] ?? (r.startsWith('db_open_failed') ? 'スプレッドシートを開けませんでした。管理者に伝えてください。' : `うまくいきませんでした（${r || '不明'}）。`);
  return detail ? `${base}（${String(detail)}）` : base;
}

// ---- データの読み込み -------------------------------------------------------

export type MoshiState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; exams: MoshiExam[]; results: MoshiResult[]; kenitsu: KenitsuResult[]; backend: string; fetchedAt: string };

export function useMoshiData() {
  const [state, setState] = useState<MoshiState>({ status: 'loading' });
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/moshi', { cache: 'no-store' });
      const j = await res.json().catch(() => null);
      if (!j?.ok) { setState({ status: 'error', message: reasonText(j?.reason) }); return false; }
      setState({ status: 'ready', exams: sortExams(j.exams), results: j.results, kenitsu: j.kenitsu ?? [], backend: j.backend, fetchedAt: j.fetchedAt });
      return true;
    } catch {
      setState({ status: 'error', message: reasonText('network_error') });
      return false;
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const setResults = useCallback((fn: (rs: MoshiResult[]) => MoshiResult[]) => {
    setState((s) => (s.status === 'ready' ? { ...s, results: fn(s.results) } : s));
  }, []);
  const setExams = useCallback((fn: (es: MoshiExam[]) => MoshiExam[]) => {
    setState((s) => (s.status === 'ready' ? { ...s, exams: sortExams(fn(s.exams)) } : s));
  }, []);
  return { state, reload: load, setResults, setExams };
}

/** 県一斉模試の成績がまだ無いとき（再描画のたびに新しい配列を作らないよう、1つを使い回す）。 */
export const NO_KEN: KenitsuResult[] = [];

export function newId(): string {
  try { return crypto.randomUUID(); } catch { return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; }
}

// ---- 回と校舎の選択（端末ごとに覚える） ---------------------------------------

const EXAM_KEY = 'moshi.exam';
const CAMPUS_KEY = 'moshi.campus';
export const ALL_CAMPUSES = '';

/**
 * 回と校舎の選択。前に選んだ回（端末ごと）があればそれ、無ければ新しい回から。
 * withData を渡すと、成績が入っている回の中でいちばん新しい回を先に選ぶ（成績表・面談で、まだ空の次の回が出ないように）。
 */
export function useExamCampus(exams: MoshiExam[], { allowAll, withData }: { allowAll: boolean; withData?: MoshiResult[] }) {
  const [examId, setExamId] = useState('');
  const [campus, setCampus] = useState<string>(allowAll ? ALL_CAMPUSES : CAMPUS_NAMES[0]);
  useEffect(() => {
    try {
      const c = localStorage.getItem(CAMPUS_KEY);
      if (c && CAMPUS_NAMES.includes(c)) setCampus(c);
      else if (c === ALL_CAMPUSES && allowAll) setCampus(ALL_CAMPUSES);
    } catch {}
  }, [allowAll]);
  useEffect(() => {
    if (!exams.length) return;
    if (examId && exams.some((e) => e.id === examId)) return;
    let saved = '';
    try { saved = localStorage.getItem(EXAM_KEY) ?? ''; } catch {}
    const filled = withData ? exams.find((e) => withData.some((r) => r.examId === e.id)) : undefined;
    setExamId(exams.some((e) => e.id === saved) ? saved : (filled ?? exams[0]).id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exams, examId]);
  const pickExam = (id: string) => { setExamId(id); try { localStorage.setItem(EXAM_KEY, id); } catch {} };
  const pickCampus = (c: string) => { setCampus(c); try { localStorage.setItem(CAMPUS_KEY, c); } catch {} };
  const exam = exams.find((e) => e.id === examId) ?? null;
  return { exam, examId, campus, pickExam, pickCampus };
}

// ---- 本番レベル模試／県一斉模試の切り替え（成績表・面談） ----------------------------

export type MoshiKind = 'honban' | 'ken';
const KIND_KEY = 'moshi.kind';
const KEN_KEY = 'moshi.ken';

/** 本番レベル模試の得点が1つでも入っているか（無ければ、成績表・面談は県一斉模試から開く）。 */
export function hasHonbanScores(results: MoshiResult[]): boolean {
  return results.some((r) => SUBJECT_KEYS.some((k) => (r.scores[k] ?? []).some((v) => v != null)));
}

/**
 * 成績表・面談で見る模試の種類と、県一斉模試の回（端末ごとに覚える）。
 * まだ選んでいなければ、本番レベル模試の得点が無く県一斉模試があるときは県一斉模試から開く。
 */
export function useKind(hasHonban: boolean, kenList: KenitsuExam[]) {
  const [kind, setKind] = useState<MoshiKind | ''>('');
  const [kenId, setKenId] = useState('');
  useEffect(() => {
    try {
      const k = localStorage.getItem(KIND_KEY);
      if (k === 'honban' || k === 'ken') setKind(k);
      setKenId(localStorage.getItem(KEN_KEY) ?? '');
    } catch {}
  }, []);
  const now: MoshiKind = kind || (!hasHonban && kenList.length ? 'ken' : 'honban');
  const kenExam = kenList.find((e) => e.id === kenId) ?? kenList[0] ?? null;
  const pickKind = (k: MoshiKind) => { setKind(k); try { localStorage.setItem(KIND_KEY, k); } catch {} };
  const pickKen = (id: string) => { setKenId(id); try { localStorage.setItem(KEN_KEY, id); } catch {} };
  return { kind: now, pickKind, kenExam, pickKen };
}

export function KindSwitch({ kind, onKind, kenCount }: { kind: MoshiKind; onKind: (k: MoshiKind) => void; kenCount: number }) {
  return (
    <div className="ms-kind ms-noprint">
      <span className="ms-kind-label">見る模試</span>
      <div className="ms-seg" role="tablist">
        <button type="button" className={kind === 'honban' ? 'on' : ''} onClick={() => onKind('honban')}>本番レベル模試</button>
        <button type="button" className={kind === 'ken' ? 'on' : ''} onClick={() => onKind('ken')}>県一斉模試{kenCount ? `（${kenCount}回）` : ''}</button>
      </div>
    </div>
  );
}

/** 県一斉模試の回と校舎の選択。 */
export function KenBar({ kenList, kenId, campus, onKen, onCampus, children }: {
  kenList: KenitsuExam[]; kenId: string; campus: string; onKen: (id: string) => void; onCampus: (c: string) => void; children?: ReactNode;
}) {
  return (
    <div className="ms-bar ms-noprint">
      <label>
        <span>回</span>
        <select value={kenId} onChange={(e) => onKen(e.target.value)}>
          {kenList.map((e) => <option key={e.id} value={e.id}>{e.name}（{e.date.slice(5).replace('-', '/')}）</option>)}
        </select>
      </label>
      <label>
        <span>校舎</span>
        <select value={campus} onChange={(e) => onCampus(e.target.value)}>
          <option value={ALL_CAMPUSES}>すべての校舎</option>
          {CAMPUS_NAMES.map((c) => <option key={c} value={c}>{campusInfo(c)?.label ?? c}</option>)}
        </select>
      </label>
      {children}
      <Link className="ms-bar-link" href="/moshi/import">県一斉模試の取り込み</Link>
    </div>
  );
}

/** 県一斉模試がまだ取り込まれていないとき。 */
export function NoKenNote() {
  return (
    <div className="ms-note">
      <p>県一斉模試の成績がまだありません。「県一斉模試の取り込み」で、集計結果の成績と名簿を取り込んでください。</p>
      <Link className="ms-btn" href="/moshi/import">県一斉模試の取り込みを開く</Link>
    </div>
  );
}

export function examOptionLabel(e: MoshiExam): string {
  return e.date ? `${e.name}（${e.date.slice(5).replace('-', '/')}）` : e.name;
}

export function ExamCampusBar({
  exams, examId, campus, onExam, onCampus, allowAll, children,
}: {
  exams: MoshiExam[]; examId: string; campus: string;
  onExam: (id: string) => void; onCampus: (c: string) => void; allowAll: boolean; children?: ReactNode;
}) {
  return (
    <div className="ms-bar ms-noprint">
      <label>
        <span>回</span>
        <select value={examId} onChange={(e) => onExam(e.target.value)}>
          {exams.map((e) => <option key={e.id} value={e.id}>{examOptionLabel(e)}</option>)}
        </select>
      </label>
      <label>
        <span>校舎</span>
        <select value={campus} onChange={(e) => onCampus(e.target.value)}>
          {allowAll && <option value={ALL_CAMPUSES}>すべての校舎</option>}
          {CAMPUS_NAMES.map((c) => <option key={c} value={c}>{campusInfo(c)?.label ?? c}</option>)}
        </select>
      </label>
      {children}
      <Link className="ms-bar-link" href="/moshi/settings">模試の設定</Link>
    </div>
  );
}

/** 回がまだ無い・読み込み中・失敗のときの表示。ready なら null。 */
export function StateNote({ state, onRetry }: { state: MoshiState; onRetry: () => void }) {
  if (state.status === 'loading') return <p className="ms-note">読み込み中…（スプレッドシートから読むので数秒かかります）</p>;
  if (state.status === 'error') return (
    <div className="ms-note ms-note-err">
      <p>{state.message}</p>
      <button type="button" onClick={onRetry}>もう一度読み込む</button>
    </div>
  );
  if (!state.exams.length) return (
    <div className="ms-note">
      <p>まだ模試の回がありません。はじめに「模試の設定」で回（模試名・実施日・配点）を作ってください。</p>
      <Link className="ms-btn" href="/moshi/settings">模試の設定を開く</Link>
    </div>
  );
  return null;
}

export function PageHead({ title, desc, name }: { title: string; desc: string; name: string }) {
  return (
    <div className="page-head ms-noprint">
      <h1>{title}</h1>
      <p>{desc}<span className="ms-who">（{name} さん）</span></p>
    </div>
  );
}

export function NotAllowed({ title }: { title: string }) {
  return (
    <div className="ms">
      <div className="page-head"><h1>{title}</h1></div>
      <p className="ms-note">{MOSHI_DEPTS.join('・')}の職員が使う画面です（生徒の氏名と成績を扱うため）。</p>
    </div>
  );
}

// ---- 表示の小物 ------------------------------------------------------------

export function fmt1(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : round1(n).toFixed(1);
}

export function fmtInt(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : String(Math.round(n));
}

export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 印刷する中身を差し替えてから印刷する（描き終わるのを待つ）。 */
export function printAfterRender(prepare: () => void) {
  prepare();
  setTimeout(() => window.print(), 150);
}

/**
 * 個人成績表（A4 横）を印刷する。用紙の向きは文書に1つしか決められないので、印刷のあいだだけ
 * 「A4 横」の指定を足し、終わったら外す（順位表・受験票は A4 縦のまま）。
 */
const LANDSCAPE_ID = 'ms-page-landscape';

export function printLandscape(prepare: () => void) {
  document.getElementById(LANDSCAPE_ID)?.remove();
  const style = document.createElement('style');
  style.id = LANDSCAPE_ID;
  style.textContent = '@page { size: A4 landscape; margin: 8mm; }';
  document.head.appendChild(style);
  // 外すのは印刷が終わってから（印刷の画面を待たずに戻るブラウザもあるので、時間では外さない）。
  // 合図が来なかったときのために、縦の印刷（printPortrait）でも外す
  const done = () => { style.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  prepare();
  setTimeout(() => window.print(), 200);
}

/** 順位表・平均点・受験票（A4 縦）の印刷。個人成績表の「A4 横」の指定が残っていれば外してから印刷する。 */
export function printPortrait() {
  document.getElementById(LANDSCAPE_ID)?.remove();
  window.print();
}

export function campusLabel(c: string): string {
  return c ? campusInfo(c)?.label ?? c : 'すべての校舎';
}

/** 「2026 本番レベル模試 11月」→「11月」、日付があれば「11/22」。 */
export function shortExamName(e: MoshiExam): string {
  const m = /(\d{1,2}月)/.exec(e.name);
  if (m) return m[1];
  return e.date ? e.date.slice(5).replace('-', '/') : e.name.slice(0, 6);
}
