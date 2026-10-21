'use client';

// 問合せ管理（/inquiry-board）の画面。
// スプレッドシート「2026小中等部問合せ管理」の校舎タブを、校舎タブ＋一覧＋登録フォームに置き換える。
//
// - 校舎タブで切り替え、一覧の行を押すとその件の編集パネルが開く（PC は右側に開き、一覧を見ながら［前へ］［次へ］で順に直せる）
// - スマホの一覧は「氏名・結果・経過日数・電話」だけの短いカード。PC の一覧は横にずらしても氏名までの列が残る
// - DM（発送する〇／しない✕）は一覧上の切り替えで即保存。「一覧で編集」を押すと各セルが入力欄になり、
//   変えた項目はその場で保存される（セルを離れたとき／選び直したとき）
// - 「結果」が空＝追客中。「検討中」も決着していないので追客の一種として扱う（期限超過・注意点の対象）。
//   連絡も結果も無い行（未着手）とクローズ予定日を過ぎた行（期限超過）は色を付ける
// - 画面上部の「今日の注意点」は /api/inquiry-board/alerts が返す（ルールで数えた事実＋AIの一言）。
//   チップを押すと、その注意に数えた行だけに一覧を絞り込む（件数と一覧が一致する）
// - 保存は「編集を始めた時点の行（base）」も送り、変えた項目だけを書く。他の人が同じ項目を
//   別の値に直していたら保存せず、どちらにするか選んでもらう（lib/inquiryRecords.ts の「同時編集」）
// - 集計（学年別の問合・面談・体験・入塾）は元シート右側の表を再現したもの
// - 保存先は Apps Script 経由のスプレッドシート「問合せ台帳」（lib/inquiryStore.ts）

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BOARD_CAMPUSES, GRADES, SOURCES, TERMS, CONTACTS, MARKS, RESULTS,
  addDays, applyLog, daysSince, emptyInput, findDuplicates, isFollowing, isOverdue, isUntouched, labelOf,
  normalizeGrade, normalizePhone, parseIso, pct, phoneDigits, rebaseDraft, shortDate,
  statsByGrade, statusOf, STATUS_LABEL, toCsv, ymOf, RECORD_FIELDS,
  type InquiryInput, type InquiryRecord, type LogKind, type RecordStatus,
} from '@/lib/inquiryRecords';
import type { Alert, KpiLine } from '@/lib/inquiryAlerts';
import { mergePreview } from '@/lib/inquiryMerge';

type ListRes =
  | { ok: true; items: InquiryRecord[]; fetchedAt: string; backend: 'sheet' | 'local' }
  | { ok: false; reason: string; items?: InquiryRecord[] };

const REASON_TEXT: Record<string, string> = {
  not_configured: 'スプレッドシート連携（APPS_SCRIPT_URL）が未設定です。管理部門にご連絡ください。',
  db_open_failed: '台帳スプレッドシートを開けませんでした。Apps Script の INQUIRY_DB_ID と権限を確認してください。',
  upstream_error: '台帳の読み込みに失敗しました。',
  network_error: '台帳に接続できませんでした。',
  forbidden: '問合せ管理は小中等部と管理部門のみ利用できます。',
  unauthorized: 'ログインし直してください。',
  not_found: 'その件は見つかりませんでした（他の人が削除した可能性があります）。',
  invalid: '入力内容を確認してください。',
  conflict: '他の人が先に同じ項目を変更していたため、保存できませんでした。',
};

/** 衝突（他の人が同じ項目を別の値に直していた）を知らせる文。 */
function conflictText(cur: InquiryRecord, keys: (keyof InquiryRecord)[]): string {
  const who = cur.updatedBy ? `${cur.updatedBy}さん` : '他の人';
  const what = keys.length ? `（${keys.map(labelOf).join('・')}）` : '';
  return `保存できませんでした：${who}が ${fmtTs(cur.updatedAt)} に同じ項目${what}を変更していました。最新の内容を表示しています。`;
}

const STORAGE_KEY = 'ib_campus';
const INLINE_KEY = 'ib_inline';
const VIEW_KEY = 'ib_view';

// 表示区分。問い合わせ管理の画面なので、入塾した人は既定で一覧から外す（「入塾済み」で見る）。
type View = 'active' | 'joined' | 'all';
const VIEWS: { key: View; label: string; desc: string }[] = [
  { key: 'active', label: '追客', desc: '入塾した人を除く' },
  { key: 'joined', label: '入塾済み', desc: '結果が入塾の人だけ' },
  { key: 'all', label: 'すべて', desc: '区分なし' },
];
const ALL = 'すべて';

// 件数カードの区分（結果の区分＋未着手・期限超過）。'' は絞り込みなし
type StatusFilter = '' | RecordStatus | 'untouched' | 'overdue';

type SortDir = 'asc' | 'desc';

// 一覧の列。簡易表示（simple）はふだんの追客に要る列だけ、詳細表示は全列。
// filter: 見出しの下の絞り込み行に何を出すか（select＝選択肢、text＝含む文字）。
type ColKey = 'campus' | 'no' | 'dm' | 'date' | 'studentName' | 'phone' | 'grade' | 'school' | 'source' | 'term'
  | 'contacted' | 'trial' | 'meetingDate' | 'agreed' | 'closeDate' | 'result' | 'enrollDate' | 'note';
// freeze：横にずらしても残す列（元のスプレッドシートの「固定」と同じく、生徒氏名までを左に固定する）
type ColDef = { key: ColKey; label: string; simple: boolean; filter: 'none' | 'select' | 'text'; sortable: boolean; th?: string; freeze?: boolean };
const COLUMNS: ColDef[] = [
  { key: 'campus', label: '校舎', simple: true, filter: 'select', sortable: true, freeze: true },
  { key: 'no', label: 'No.', simple: true, filter: 'none', sortable: true, freeze: true },
  { key: 'dm', label: 'DM', simple: true, filter: 'select', sortable: true, freeze: true },
  { key: 'date', label: '日付', simple: true, filter: 'none', sortable: true, freeze: true },
  { key: 'studentName', label: '生徒氏名', simple: true, filter: 'text', sortable: true, freeze: true },
  { key: 'phone', label: '電話番号', simple: true, filter: 'text', sortable: false },
  { key: 'grade', label: '学年', simple: true, filter: 'select', sortable: true },
  { key: 'school', label: '学校', simple: true, filter: 'text', sortable: true },
  { key: 'source', label: '媒体', simple: false, filter: 'select', sortable: true },
  { key: 'term', label: '受講期', simple: true, filter: 'select', sortable: true },
  { key: 'contacted', label: '連絡', simple: true, filter: 'select', sortable: true },
  { key: 'trial', label: '体験', simple: false, filter: 'select', sortable: true },
  { key: 'meetingDate', label: '面談', simple: false, filter: 'none', sortable: true },
  { key: 'agreed', label: '本人OK', simple: false, filter: 'select', sortable: true },
  { key: 'closeDate', label: 'クローズ予定', simple: false, filter: 'none', sortable: true },
  { key: 'result', label: '結果', simple: true, filter: 'select', sortable: true },
  { key: 'enrollDate', label: '入塾日', simple: false, filter: 'none', sortable: true },
  { key: 'note', label: '備考', simple: true, filter: 'text', sortable: false, th: 'ib-th-note' },
];
const EMPTY = '__empty__'; // 絞り込みで「未記入」を選ぶときの値
type ColFilters = Partial<Record<ColKey, string>>;
type ColShow = Record<ColKey, boolean>;
const DENSE_KEY = 'ib_dense';
const FONT_KEY = 'ib_font';
const FILTERS_KEY = 'ib_filters';

/** 並び替え用の値。空は null（昇順・降順どちらでも末尾に回す）。 */
function sortValue(r: InquiryRecord, key: ColKey): string | number | null {
  switch (key) {
    case 'no': return r.no || null;
    case 'grade': { const g = normalizeGrade(r.grade); if (!g) return null; const i = (GRADES as readonly string[]).indexOf(g); return i === -1 ? 99 : i; }
    case 'studentName': return (r.kana || r.studentName) || null;
    case 'date': case 'meetingDate': case 'closeDate': case 'enrollDate': return r[key] || null;
    case 'trial': return r.trial ? `${r.trial} ${r.trialDate}` : (r.trialDate || null);
    case 'result': return r.result || null;
    default: { const v = r[key]; return v === '' || v == null ? null : (v as string); }
  }
}
function compareRows(a: InquiryRecord, b: InquiryRecord, key: ColKey, dir: SortDir): number {
  const va = sortValue(a, key); const vb = sortValue(b, key);
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  let c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ja');
  if (dir === 'desc') c = -c;
  if (c !== 0) return c;
  // 同じ値のときは日付が新しい順 → No.
  const da = parseIso(a.date) ? a.date : ''; const db = parseIso(b.date) ? b.date : '';
  const d = db.localeCompare(da);
  return d !== 0 ? d : (b.no || 0) - (a.no || 0);
}
/** 絞り込み行の条件に合うか。select は完全一致（EMPTY＝未記入）、text は含む。 */
function matchesColFilters(r: InquiryRecord, f: ColFilters): boolean {
  for (const c of COLUMNS) {
    const want = f[c.key];
    if (!want) continue;
    const raw = c.key === 'grade' ? normalizeGrade(r.grade) : String(r[c.key] ?? '');
    if (c.filter === 'select') {
      if (want === EMPTY ? raw !== '' : raw !== want) return false;
    } else if (c.filter === 'text') {
      const hay = c.key === 'studentName' ? `${r.studentName} ${r.kana}` : c.key === 'phone' ? `${r.phone} ${r.guardianName}` : raw;
      if (!hay.toLowerCase().includes(want.toLowerCase())) return false;
    }
  }
  return true;
}

function todayIso(): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function ymLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
}

function fmtTs(s: string): string {
  const m = s.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}` : s;
}

/** 固定する列のクラス。left は一覧の見出しの幅を測って --frz-<列> に入れる（固定列の幅は中身で変わるため）。 */
function frz(key: ColKey | 'act'): string {
  return key === 'studentName' ? 'frz frz-studentName frz-last' : `frz frz-${key}`;
}
const FREEZE_KEYS: (ColKey | 'act')[] = ['act', ...COLUMNS.filter((c) => c.freeze).map((c) => c.key)];

/** 選択肢に無い値（旧データの移行値など）も選べるように、現在値を選択肢に足す。 */
function withCurrent(options: readonly string[], current: string): string[] {
  return current && !options.includes(current) ? [...options, current] : [...options];
}

export default function InquiryBoardUI({ name }: { name: string }) {
  const [items, setItems] = useState<InquiryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [fetchedAt, setFetchedAt] = useState('');
  const [backend, setBackend] = useState<'sheet' | 'local' | ''>('');

  const [campus, setCampus] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  // 今日の注意点のチップで絞り込んだ行（その注意に数えた行の ID）。校舎・表示区分より優先して出す
  const [alertSel, setAlertSel] = useState<{ label: string; ids: Set<string> } | null>(null);
  const [month, setMonth] = useState('');
  const [sortKey, setSortKey] = useState<ColKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [colF, setColF] = useState<ColFilters>({});
  const [dense, setDense] = useState<'simple' | 'detail'>('simple');
  const [bigFont, setBigFont] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [inlineEdit, setInlineEdit] = useState(false);
  const [view, setView] = useState<View>('active');
  const [flash, setFlash] = useState('');
  const [okMsg, setOkMsg] = useState(''); // 統合など、成功を短く知らせる（数秒で消える）
  useEffect(() => { if (!okMsg) return; const t = setTimeout(() => setOkMsg(''), 6000); return () => clearTimeout(t); }, [okMsg]);
  // 台帳が変わるたびに増やす。アラートの再取得のきっかけ
  const [version, setVersion] = useState(0);

  const [editing, setEditing] = useState<InquiryRecord | 'new' | null>(null);
  // ［前へ］［次へ］の順番。一覧から開いたときの並び（ID）をそのまま持つ（保存で一覧から外れる人がいても崩れない）
  const [queue, setQueue] = useState<string[]>([]);
  // パネルに保存していない入力があるか（一覧の別の行を押して切り替えるときに確かめる）
  const dirtyRef = useRef(false);
  const setDirty = useCallback((d: boolean) => { dirtyRef.current = d; }, []);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const today = useMemo(() => todayIso(), []);

  // 前回見ていた校舎を覚えておく（毎回タブを押し直さなくて済むように）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && (saved === ALL || (BOARD_CAMPUSES as readonly string[]).includes(saved))) setCampus(saved);
      if (localStorage.getItem(INLINE_KEY) === '1') setInlineEdit(true);
      const v = localStorage.getItem(VIEW_KEY);
      if (v === 'active' || v === 'joined' || v === 'all') setView(v);
      if (localStorage.getItem(DENSE_KEY) === 'detail') setDense('detail');
      if (localStorage.getItem(FONT_KEY) === 'big') setBigFont(true);
      if (localStorage.getItem(FILTERS_KEY) === '0') setShowFilters(false);
    } catch {}
  }, []);
  function changeView(v: View) {
    setView(v);
    if (v !== 'joined' && status === 'joined') setStatus('');
    try { localStorage.setItem(VIEW_KEY, v); } catch {}
  }
  function toggleInline() {
    setInlineEdit((v) => {
      try { localStorage.setItem(INLINE_KEY, v ? '0' : '1'); } catch {}
      return !v;
    });
  }
  function changeCampus(c: string) {
    setCampus(c);
    setAlertSel(null); // 注意点は校舎ごとに数えているので、校舎を変えたら外す
    try { localStorage.setItem(STORAGE_KEY, c); } catch {}
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/inquiry-board', { cache: 'no-store' });
      const j = (await res.json().catch(() => ({ ok: false, reason: 'upstream_error' }))) as ListRes;
      if (j.ok) {
        setItems(j.items);
        setFetchedAt(j.fetchedAt);
        setBackend(j.backend);
        setNote('');
        setVersion((v) => v + 1);
      } else {
        setItems([]);
        setNote(REASON_TEXT[j.reason] ?? `台帳を読み込めませんでした（${j.reason}）。`);
      }
    } catch {
      setNote(REASON_TEXT.network_error);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ---- 絞り込み -----------------------------------------------------------

  const campusRows = useMemo(
    () => (campus === ALL ? items : items.filter((r) => r.campus === campus)),
    [items, campus],
  );

  // 表示区分を掛けた行。件数カードと一覧はこれを元にする（集計だけは区分を掛けない）
  const viewRows = useMemo(() => {
    if (view === 'all') return campusRows;
    if (view === 'joined') return campusRows.filter((r) => statusOf(r.result) === 'joined');
    return campusRows.filter((r) => statusOf(r.result) !== 'joined');
  }, [campusRows, view]);

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const r of campusRows) {
      const ym = ymOf(r.date);
      if (ym) set.add(ym);
    }
    return [...set].sort().reverse();
  }, [campusRows]);

  // 区分を掛ける前の絞り込み結果（学年別集計に使う。入塾を除いた集計では入塾率が出せないため）
  const statsRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = campusRows.filter((r) => {
      if (alertSel && !alertSel.ids.has(r.id)) return false;
      if (status) {
        if (status === 'untouched') { if (!isUntouched(r)) return false; }
        else if (status === 'overdue') { if (!isOverdue(r, today)) return false; }
        else if (statusOf(r.result) !== status) return false;
      }
      if (month && ymOf(r.date) !== month) return false;
      if (!matchesColFilters(r, colF)) return false;
      if (q) {
        const hay = [r.studentName, r.kana, r.school, r.guardianName, r.phone, r.note, r.result, r.source, r.referrer, r.campus, String(r.no)]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows.sort((a, b) => compareRows(a, b, sortKey, sortDir));
    return rows;
  }, [campusRows, alertSel, query, status, month, colF, sortKey, sortDir, today]);

  // 見出しを押すと、その列で昇順 → 降順 → 昇順… と切り替わる（別の列を押すと昇順から）
  const toggleSort = useCallback((key: ColKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }, [sortKey]);

  // 表示する列（簡易／詳細）。校舎の列は「すべて」タブのときだけ
  const show = useMemo(() => {
    const out = {} as ColShow;
    for (const c of COLUMNS) out[c.key] = (dense === 'detail' || c.simple) && (c.key !== 'campus' || campus === ALL);
    return out;
  }, [dense, campus]);
  const cols = useMemo(() => COLUMNS.filter((c) => show[c.key]), [show]);

  // 絞り込み行の選択肢：決まった選択肢＋台帳にある値（旧データの表記も選べるように）
  const filterOptions = useMemo(() => {
    const known: Partial<Record<ColKey, readonly string[]>> = {
      campus: BOARD_CAMPUSES, dm: MARKS, grade: GRADES, source: SOURCES, term: TERMS, contacted: CONTACTS, trial: MARKS, agreed: MARKS, result: RESULTS,
    };
    const out: Partial<Record<ColKey, string[]>> = {};
    for (const c of COLUMNS) {
      if (c.filter !== 'select') continue;
      const set = new Set<string>(known[c.key] ?? []);
      for (const r of campusRows) { const v = c.key === 'grade' ? normalizeGrade(r.grade) : String(r[c.key] ?? ''); if (v) set.add(v); }
      out[c.key] = [...set];
    }
    return out;
  }, [campusRows]);

  const shown = useMemo(() => {
    // 注意点で絞り込んだときは表示区分を掛けない（入塾日が空の入塾者など、区分の外の行も数えているため）
    if (view === 'all' || alertSel) return statsRows;
    if (view === 'joined') return statsRows.filter((r) => statusOf(r.result) === 'joined');
    return statsRows.filter((r) => statusOf(r.result) !== 'joined');
  }, [statsRows, view, alertSel]);

  // 件数カード。結果の区分（追客中・検討中・入塾・申込・見送り・その他）の合計が「問合せ」と一致する
  const counts = useMemo(() => {
    const c = { total: viewRows.length, open: 0, considering: 0, joined: 0, applied: 0, declined: 0, other: 0, untouched: 0, overdue: 0 };
    for (const r of viewRows) {
      c[statusOf(r.result)]++;
      if (isUntouched(r)) c.untouched++;
      if (isOverdue(r, today)) c.overdue++;
    }
    return c;
  }, [viewRows, today]);

  const stats = useMemo(() => statsByGrade(statsRows), [statsRows]);

  // ---- 保存後の反映 ------------------------------------------------------

  function applySaved(item: InquiryRecord) {
    setItems((prev) => {
      const i = prev.findIndex((r) => r.id === item.id);
      if (i === -1) return [item, ...prev];
      const next = [...prev];
      next[i] = item;
      return next;
    });
    setVersion((v) => v + 1);
  }
  function applyDeleted(id: string) {
    setItems((prev) => prev.filter((r) => r.id !== id));
    setVersion((v) => v + 1);
  }

  // 一覧上の直接編集（DM の切り替え・「一覧で編集」の各セル）。base（変える前の行）と一緒に PUT し、
  // 変えた項目だけを書く。返ってきた値（他の人の変更も入った最新の行）で置き換える。
  const saveInline = useCallback(async (next: InquiryRecord, base: InquiryRecord): Promise<boolean> => {
    try {
      const res = await fetch('/api/inquiry-board', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...next, base }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok && j.item) {
        applySaved(j.item as InquiryRecord);
        setFlash('');
        return true;
      }
      if (j?.reason === 'conflict' && j.item) {
        applySaved(j.item as InquiryRecord);
        setFlash(conflictText(j.item as InquiryRecord, j.conflicts ?? []));
        return false;
      }
      setFlash(
        Array.isArray(j?.errors) && j.errors.length
          ? j.errors.join(' ')
          : REASON_TEXT[j?.reason] ?? `保存に失敗しました（${j?.reason ?? '不明'}）。`,
      );
      return false;
    } catch {
      setFlash(REASON_TEXT.network_error);
      return false;
    }
  }, []);

  function downloadCsv() {
    const blob = new Blob([toCsv(shown)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `問合せ台帳_${campus === ALL ? '全校舎' : campus}_${today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---- 編集パネル ----------------------------------------------------------
  function leaveOk(): boolean {
    return !dirtyRef.current || window.confirm('入力した内容はまだ保存されていません。保存せずに移ってよいですか？');
  }
  function openRecord(r: InquiryRecord) {
    if (editing && editing !== 'new' && editing.id === r.id) return;
    if (!leaveOk()) return;
    setQueue(shown.map((x) => x.id));
    setEditing(r);
  }
  function openNew() {
    if (editing === 'new' || !leaveOk()) return;
    setEditing('new');
  }
  // パネルの中から別の人へ（前へ・次へ・保存して次へ・重複のお知らせ）。未保存の確認はパネル側で済んでいる
  const gotoId = useCallback((id: string) => {
    const r = itemsRef.current.find((x) => x.id === id);
    if (r) setEditing(r);
  }, []);
  const editingId = editing && editing !== 'new' ? editing.id : '';
  const nav = useMemo(() => {
    if (!editingId) return null;
    const i = queue.indexOf(editingId);
    if (i === -1) return null;
    const alive = new Set(items.map((r) => r.id));
    let prevId: string | null = null;
    for (let j = i - 1; j >= 0; j--) if (alive.has(queue[j])) { prevId = queue[j]; break; }
    let nextId: string | null = null;
    for (let j = i + 1; j < queue.length; j++) if (alive.has(queue[j])) { nextId = queue[j]; break; }
    return { pos: i + 1, total: queue.length, prevId, nextId };
  }, [editingId, queue, items]);
  // 開いている人の行を一覧の見える位置へ（前へ・次へで移ったとき）
  useEffect(() => {
    if (!editingId) return;
    document.querySelector(`tr[data-id="${editingId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [editingId]);

  const filtered = !!(alertSel || query || status || month || Object.values(colF).some(Boolean));
  function clearFilters() { setAlertSel(null); setQuery(''); setStatus(''); setMonth(''); setColF({}); }
  // 件数カード：押すとその区分で絞り込む（もう一度押すと外す）。注意点の絞り込みは外す
  function pickStatus(s: StatusFilter) { setAlertSel(null); setStatus((cur) => (cur === s ? '' : s)); }
  const cards: { key: StatusFilter; label: string; n: number; cls?: string; hide?: boolean }[] = [
    { key: '', label: '問合せ', n: counts.total },
    { key: 'open', label: '追客中', n: counts.open },
    { key: 'considering', label: '検討中', n: counts.considering },
    { key: 'joined', label: '入塾', n: counts.joined, hide: view === 'active' },
    { key: 'applied', label: '申込', n: counts.applied },
    { key: 'declined', label: '見送り', n: counts.declined },
    { key: 'other', label: 'その他', n: counts.other, hide: !counts.other },
    { key: 'untouched', label: '未着手', n: counts.untouched, cls: 'warn' },
    { key: 'overdue', label: '期限超過', n: counts.overdue, cls: 'danger' },
  ];

  // 固定する列（生徒氏名まで）の左端を測る。列の幅は中身で変わるので、見出しの実際の幅を左から足していく
  const tableRef = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const t = tableRef.current;
    if (!t) return;
    const measure = () => {
      let left = 0;
      t.querySelectorAll<HTMLTableCellElement>('thead tr:first-child th.frz').forEach((th) => {
        const key = [...th.classList].find((c) => c.startsWith('frz-') && c !== 'frz-last')?.slice(4);
        if (key) t.style.setProperty(`--frz-${key}`, `${left}px`);
        left += th.getBoundingClientRect().width;
      });
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(t);
    return () => ro?.disconnect();
  }, [cols, inlineEdit, bigFont, shown.length, loading]);

  // 一覧の枠を「画面の残りの高さ」に合わせる。枠の下端が常に画面内に来るので、横スクロールバーが
  // いちばん下まで行かなくても見える（PC のみ。スマホはカード表示なので枠の高さは触らない）。
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      if (window.innerWidth <= 900) { el.style.maxHeight = ''; return; }
      const top = el.getBoundingClientRect().top;
      el.style.maxHeight = `${Math.max(260, Math.floor(window.innerHeight - top - 12))}px`;
    };
    fit();
    window.addEventListener('scroll', fit, { passive: true });
    window.addEventListener('resize', fit);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(document.body);
    return () => { window.removeEventListener('scroll', fit); window.removeEventListener('resize', fit); ro?.disconnect(); };
  }, [loading, shown.length, showStats, showFilters, dense, bigFont]);

  return (
    <div className={`ib ${bigFont ? 'ib-big' : ''} ${editing ? 'has-panel' : ''}`}>
      <div className="ib-tabs" role="tablist">
        {[ALL, ...BOARD_CAMPUSES].map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={campus === c}
            className={`ib-tab ${campus === c ? 'active' : ''}`}
            onClick={() => changeCampus(c)}
          >
            {c}
            <span className="ib-tab-n">{c === ALL ? items.length : items.filter((r) => r.campus === c).length}</span>
          </button>
        ))}
      </div>

      <div className="ib-views" role="tablist" aria-label="表示区分">
        {VIEWS.map((vw) => (
          <button
            key={vw.key}
            role="tab"
            aria-selected={view === vw.key}
            className={`ib-view ${view === vw.key ? 'active' : ''}`}
            title={vw.desc}
            onClick={() => changeView(vw.key)}
          >
            {vw.label}
            <span className="ib-tab-n">
              {vw.key === 'all' ? campusRows.length
                : vw.key === 'joined' ? campusRows.filter((r) => statusOf(r.result) === 'joined').length
                : campusRows.filter((r) => statusOf(r.result) !== 'joined').length}
            </span>
          </button>
        ))}
      </div>

      {note && <div className="ib-note">{note}</div>}
      {backend === 'local' && (
        <div className="ib-note ib-note-dev">開発モード：この端末の .data/inquiry-board.json に保存しています（スプレッドシート未接続）。</div>
      )}

      {!note && (
        <AlertPanel
          campus={campus}
          version={version}
          selected={alertSel?.label ?? ''}
          onFilter={(a) => {
            // その注意に数えた行だけを出す。ほかの絞り込みは外す（件数と一覧を一致させるため）
            if (alertSel?.label === a.label) { setAlertSel(null); return; }
            setQuery(''); setStatus(''); setMonth(''); setColF({});
            setAlertSel({ label: a.label ?? '注意点', ids: new Set(a.ids ?? []) });
          }}
        />
      )}

      <div className="ib-summary">
        {cards.filter((c) => !c.hide).map((c) => (
          <button
            key={c.key || 'total'}
            className={`ib-sum ${c.cls ?? ''} ${status === c.key && !alertSel ? 'active' : ''}`}
            onClick={() => { if (c.key) pickStatus(c.key); else { setAlertSel(null); setStatus(''); } }}
            title={c.key === 'considering' ? '結果が「検討中」。まだ決着していないので、期限超過・注意点の対象にも入る' : c.key === 'overdue' ? 'クローズ予定日を過ぎて結果が決まっていない（追客中・検討中）' : undefined}
          >
            <b>{c.n}</b><span>{c.label}</span>
          </button>
        ))}
      </div>

      <div className="ib-toolbar">
        <button className="ib-primary" onClick={openNew}>＋ 新規登録</button>
        <button
          className={`ib-ghost ib-toggle ${inlineEdit ? 'active' : ''}`}
          onClick={toggleInline}
          title="一覧の各セルをその場で書き換える。セルを離れると保存される"
        >
          {inlineEdit ? '一覧で編集：ON' : '一覧で編集'}
        </button>
        <input
          className="ib-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="氏名・学校・保護者・電話・備考で検索"
        />
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="月">
          <option value="">すべての月</option>
          {months.map((m) => <option key={m} value={m}>{ymLabel(m)}</option>)}
        </select>
        <button
          className={`ib-ghost ib-toggle ${dense === 'detail' ? 'active' : ''}`}
          onClick={() => setDense((d) => { const n = d === 'simple' ? 'detail' : 'simple'; try { localStorage.setItem(DENSE_KEY, n); } catch {} return n; })}
          title="簡易表示：ふだんの追客に要る列だけ。詳細表示：体験・面談・本人OK・クローズ予定・入塾日・媒体も出す"
        >
          {dense === 'simple' ? '簡易表示' : '詳細表示'}
        </button>
        <button
          className={`ib-ghost ib-toggle ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters((v) => { try { localStorage.setItem(FILTERS_KEY, v ? '0' : '1'); } catch {} return !v; })}
          title="見出しの下に、列ごとの絞り込み欄を出す"
        >
          列で絞り込み
        </button>
        <button
          className={`ib-ghost ib-toggle ${bigFont ? 'active' : ''}`}
          onClick={() => setBigFont((v) => { try { localStorage.setItem(FONT_KEY, v ? 'std' : 'big'); } catch {} return !v; })}
          title="一覧の文字を大きくする"
        >
          文字：{bigFont ? '大' : '標準'}
        </button>
        <button className="ib-ghost" onClick={() => setShowStats((v) => !v)}>{showStats ? '集計を閉じる' : '集計'}</button>
        <button className="ib-ghost" onClick={downloadCsv} disabled={!shown.length}>CSV</button>
        <button className="ib-ghost" onClick={() => void load()} disabled={loading}>{loading ? '読込中…' : '更新'}</button>
      </div>

      {showStats && <StatsPanel stats={stats} count={statsRows.length} filtered={filtered} />}

      <div className="ib-list-head">
        <span>
          {filtered ? `${shown.length}件（${alertSel ? alertSel.ids.size : viewRows.length}件中）` : `${shown.length}件`}
          {alertSel && (
            <span className="ib-filter-chip">
              注意点：{alertSel.label}
              <button type="button" onClick={() => setAlertSel(null)} aria-label="注意点の絞り込みを外す">×</button>
            </span>
          )}
          {filtered && (
            <button className="ib-link" onClick={clearFilters}>
              絞り込みを解除
            </button>
          )}
        </span>
        {fetchedAt && <span className="ib-meta">取得 {fmtTs(fetchedAt)}</span>}
      </div>
      {flash && <div className="ib-note ib-note-err">{flash}</div>}
      {okMsg && <div className="ib-note ib-note-dev">{okMsg}</div>}

      {loading && !items.length ? (
        <p className="ib-empty">読み込み中…</p>
      ) : shown.length === 0 ? (
        <p className="ib-empty">{items.length === 0 && !note ? 'まだ登録がありません。「＋ 新規登録」から追加してください。' : '該当する問い合わせはありません。'}</p>
      ) : (
        <div className="ib-table-wrap" ref={wrapRef}>
          <table className={`ib-table ${inlineEdit ? 'inline' : ''}`} ref={tableRef}>
            <thead>
              <tr>
                {inlineEdit && <th className={frz('act')}></th>}
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className={`${c.th ?? ''} ${c.sortable ? 'ib-sortable' : ''} ${sortKey === c.key ? 'sorted' : ''} ${c.freeze ? frz(c.key) : ''}`}
                    onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                    title={c.sortable ? '押すとこの列で並び替え（昇順⇄降順）' : undefined}
                    aria-sort={sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {c.label}
                    {c.sortable && <span className="ib-sort-arrow">{sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>}
                  </th>
                ))}
              </tr>
              {showFilters && (
                <tr className="ib-filter-row">
                  {inlineEdit && <th className={frz('act')}></th>}
                  {cols.map((c) => (
                    <th key={c.key} className={c.freeze ? frz(c.key) : undefined}>
                      {c.filter === 'select' && (
                        <select
                          className={colF[c.key] ? 'on' : ''}
                          value={colF[c.key] ?? ''}
                          onChange={(e) => setColF((f) => ({ ...f, [c.key]: e.target.value }))}
                          aria-label={`${c.label}で絞り込み`}
                        >
                          <option value="">すべて</option>
                          <option value={EMPTY}>{c.key === 'result' ? '追客中（未記入）' : '未記入'}</option>
                          {(filterOptions[c.key] ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                      {c.filter === 'text' && (
                        <input
                          className={colF[c.key] ? 'on' : ''}
                          value={colF[c.key] ?? ''}
                          onChange={(e) => setColF((f) => ({ ...f, [c.key]: e.target.value }))}
                          placeholder="含む"
                          aria-label={`${c.label}で絞り込み`}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {shown.map((r) => (
                <BoardRow
                  key={r.id}
                  r={r}
                  show={show}
                  inline={inlineEdit}
                  today={today}
                  current={r.id === editingId}
                  onOpen={() => openRecord(r)}
                  onSave={saveInline}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* スマホの新規登録は画面の下に常に置く（一覧の上まで戻らなくてよいように） */}
      {!editing && <button type="button" className="ib-fab" onClick={openNew}>＋ 新規登録</button>}

      {editing && (
        <RecordForm
          key={editing === 'new' ? 'new' : editing.id}
          record={editing === 'new' ? null : editing}
          defaultCampus={campus === ALL ? '' : campus /* 「すべて」からは校舎を選んでもらう（黙って先頭の校舎に入れない） */}
          today={today}
          user={name}
          nav={nav}
          onClose={() => setEditing(null)}
          onSaved={(item, thenId) => { applySaved(item); if (thenId) gotoId(thenId); else setEditing(null); }}
          onGoto={gotoId}
          onDirty={setDirty}
          onSynced={applySaved}
          onDeleted={(id) => { applyDeleted(id); setEditing(null); }}
          candidates={items}
          onMerged={(item, droppedId) => { applyDeleted(droppedId); applySaved(item); setEditing(null); setOkMsg(`${item.campus} #${item.no} に統合しました。まとめた行は削除され、内容は備考に残っています。`); }}
        />
      )}
    </div>
  );
}

// ---- 画面上部の注意点（AIアラート） ------------------------------------------
//
// /api/inquiry-board/alerts を校舎ごとに読む。台帳を保存するたび（version が変わるたび）に取り直す。
// ルールの行（件数・#No.）は毎回いまの台帳から数え直す。AI の一言（3行）は 1日1回まとめて生成され
// その日は変わらない（generatedAt にその時刻が入る）。

type AlertsRes =
  | { ok: true; alerts: Alert[]; ai: { text: string; generatedAt: string; date: string } | null; aiAvailable: boolean; facts: { monthLabel: string; scope: string; kpis: KpiLine[]; inquiriesThisMonth: number; inquiriesPrevMonth: number; monthOutcome: { joined: number; applied: number; declined: number; open: number; other: number } } }
  | { ok: false; reason: string };

const ALERTS_OPEN_KEY = 'ib_alerts_open';

/** 「2026/09/24 07:02」→「7:02」。形式が違えばそのまま返す。 */
function timeOf(ts: string): string {
  const m = /(\d{1,2}):(\d{2})$/.exec(ts || '');
  return m ? `${Number(m[1])}:${m[2]}` : ts;
}

function AlertPanel({ campus, version, selected, onFilter }: { campus: string; version: number; selected: string; onFilter: (a: Alert) => void }) {
  const [data, setData] = useState<AlertsRes | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try { if (localStorage.getItem(ALERTS_OPEN_KEY) === '0') setOpen(false); } catch {}
  }, []);
  function toggle() {
    setOpen((v) => { try { localStorage.setItem(ALERTS_OPEN_KEY, v ? '0' : '1'); } catch {} return !v; });
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inquiry-board/alerts?campus=${encodeURIComponent(campus)}`, { cache: 'no-store' });
      const j = (await res.json().catch(() => ({ ok: false, reason: 'upstream_error' }))) as AlertsRes;
      setData(j);
    } catch {
      setData({ ok: false, reason: 'network_error' });
    }
    setLoading(false);
  }, [campus]);

  // 保存直後の連続更新をまとめる（少し待ってから取りに行く）
  useEffect(() => {
    if (version === 0) return;
    const t = setTimeout(() => { void load(); }, 400);
    return () => clearTimeout(t);
  }, [load, version]);

  const ok = data && data.ok ? data : null;

  return (
    <section className={`ib-alerts ${open ? '' : 'closed'}`} aria-label="今日の注意点">
      <div className="ib-alerts-head">
        <span className="ib-ai-badge">AI</span>
        <b>今日の注意点</b>
        {ok && <span className="ib-meta">{ok.facts.monthLabel}・{ok.facts.scope}</span>}
        {ok?.ai && <span className="ib-meta" title="AIの一言は1日1回まとめて生成し、その日は変わりません。件数の行は保存のたびに数え直します">本日 {timeOf(ok.ai.generatedAt)} の評価</span>}
        {loading && <span className="ib-meta">確認中…</span>}
        <span className="ib-alerts-tools">
          <button type="button" className="ib-link" onClick={toggle}>{open ? '閉じる' : '開く'}</button>
        </span>
      </div>

      {open && data && !data.ok && (
        <p className="ib-meta">注意点を読み込めませんでした（{data.reason}）。</p>
      )}

      {open && ok && (
        <div className="ib-alerts-box" role="list">
          {ok.ai ? (
            ok.ai.text.split('\n').filter(Boolean).map((line, i) => (
              <div key={`ai${i}`} className={`ib-line ai ${i === 0 ? 'lead' : ''}`} role="listitem">
                <span className="ib-dot" />
                <span>{line}</span>
              </div>
            ))
          ) : !ok.aiAvailable ? (
            <div className="ib-line muted" role="listitem"><span className="ib-dot" /><span>AIの一言は未設定です（ANTHROPIC_API_KEY）。以下はルールで数えた注意点です。</span></div>
          ) : (
            <div className="ib-line muted" role="listitem"><span className="ib-dot" /><span>本日のAIの一言はまだありません（次に開いたときに生成します）。以下はルールで数えた注意点です。</span></div>
          )}

          <div className="ib-line kpi" role="listitem">
            <span className="ib-dot" />
            {ok.facts.kpis.map((k) => (
              <span
                key={k.metric}
                className={`ib-kpi ${k.target != null && k.target > 0 ? (k.actual >= k.target ? 'ok' : 'behind') : ''}`}
                title={`実績の出所：${k.source}`}
              >
                {k.metric} <b>{k.actual}</b>{k.target != null && <small>/{k.target}</small>}
              </span>
            ))}
            <span className="ib-kpi" title="問い合わせ日で数えた件数">
              問合せ <b>{ok.facts.inquiriesThisMonth}</b><small>（前月 {ok.facts.inquiriesPrevMonth}）</small>
            </span>
            <span className="ib-kpi" title="この月の問い合わせのその後（問い合わせQAのカードと同じ数え方。「その他」は検討中など）">
              入塾 <b>{ok.facts.monthOutcome.joined}</b><small>／申込 {ok.facts.monthOutcome.applied}／見送り {ok.facts.monthOutcome.declined}／追客中 {ok.facts.monthOutcome.open}{ok.facts.monthOutcome.other > 0 && `／その他 ${ok.facts.monthOutcome.other}`}</small>
            </span>
          </div>

          {ok.alerts.map((a, i) => (
            <div key={i} className={`ib-line lv-${a.level}`} role="listitem">
              <span className="ib-dot" />
              {a.ids?.length ? (
                <button
                  type="button"
                  className={selected && selected === a.label ? 'on' : ''}
                  aria-pressed={selected === a.label}
                  onClick={() => onFilter(a)}
                  title={selected === a.label ? 'もう一度押すと絞り込みを外す' : `押すとこの ${a.ids.length} 件だけを一覧に出す`}
                >{a.text}</button>
              ) : (
                <span>{a.text}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---- 一覧の1行 -----------------------------------------------------------
//
// 通常表示では行を押すと詳細フォームが開く。DM の 〇✕ だけはどちらの表示でも一覧上で切り替えられる。
// 「一覧で編集」では各セルが入力欄になる。選び直し（select・日付）はその場で、文字入力はセルを離れたときに保存する。
// 保存は行まるごと PUT。他の人が同じ行を直していた場合は後から保存した方が残る（詳細フォームと同じ）。

type RowProps = {
  r: InquiryRecord;
  show: ColShow;
  inline: boolean;
  today: string;
  current: boolean; // いま編集パネルで開いている人
  onOpen: () => void;
  onSave: (next: InquiryRecord, base: InquiryRecord) => Promise<boolean>;
};

function BoardRow({ r, show, inline, today, current, onOpen, onSave }: RowProps) {
  const [draft, setDraft] = useState<InquiryRecord>(r);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // 保存に失敗したときに戻す先。保存の応答（衝突なら他の人が直した最新の行）で r が先に変わることがあるので、いまの r を見る
  const latest = useRef(r);
  latest.current = r;

  // サーバの値が変わったら（自分の保存・更新ボタン）下書きを揃える
  useEffect(() => { setDraft(r); }, [r]);
  useEffect(() => {
    if (state !== 'saved') return;
    const t = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(t);
  }, [state]);

  async function commit(patch: Partial<InquiryRecord>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (RECORD_FIELDS.every((f) => next[f.key] === r[f.key])) return;
    setState('saving');
    const ok = await onSave(next, r);
    setState(ok ? 'saved' : 'error');
    if (!ok) setDraft(latest.current);
  }

  const st = statusOf(r.result);
  const overdue = isOverdue(r, today);
  const untouched = isUntouched(r);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const dm = (
    <span className="ib-seg" role="group" aria-label="DM" onClick={stop}>
      <button
        type="button"
        className={draft.dm === '〇' ? 'on' : ''}
        title="DM を発送する"
        disabled={state === 'saving'}
        onClick={() => commit({ dm: draft.dm === '〇' ? '' : '〇' })}
      >〇</button>
      <button
        type="button"
        className={draft.dm === '✕' ? 'on x' : ''}
        title="DM を発送しない"
        disabled={state === 'saving'}
        onClick={() => commit({ dm: draft.dm === '✕' ? '' : '✕' })}
      >✕</button>
    </span>
  );

  const rowClass = `ib-row st-${st} ${overdue ? 'overdue' : ''} ${untouched ? 'untouched' : ''} ${current ? 'current' : ''}`;

  if (!inline) {
    // スマホのカード：氏名・結果・経過日数・電話・備考の1行目だけ（PC では出さない。ほかのセルはスマホでは隠す）
    const days = isFollowing(r.result) ? daysSince(r.date, today) : null;
    const age = overdue ? '期限超過' : untouched ? '未着手'
      : days != null ? (days <= 0 ? '今日の問合せ' : `${days}日経過`) : r.date ? `問合せ ${shortDate(r.date)}` : '';
    const tel = phoneDigits(r.phone);
    const card = (
      <td className="ib-card">
        <div className="ib-card-top">
          <b>{r.studentName || (r.guardianName ? `（保護者）${r.guardianName}` : '（未記入）')}</b>
          <span className={`ib-badge st-${st}`}>{r.result || STATUS_LABEL.open}</span>
        </div>
        <div className="ib-card-meta">
          <span>{show.campus ? `${r.campus} ` : ''}#{r.no || '—'}</span>
          {r.grade && <span>{r.grade}</span>}
          {r.school && <span>{r.school}</span>}
          {age && <span className={overdue ? 'ib-over' : untouched ? 'ib-untouched' : ''}>{age}</span>}
          {r.contacted && <span>連絡：{r.contacted}</span>}
        </div>
        {r.phone && (
          <div className="ib-card-tel" onClick={stop}>
            {tel ? <a href={`tel:${tel}`} className="ib-call">電話する <span>{r.phone}</span></a> : <span>{r.phone}</span>}
            {r.guardianName && <small>{r.guardianName}</small>}
          </div>
        )}
        {r.note && <div className="ib-card-note">{r.note.split('\n')[0]}</div>}
      </td>
    );
    return (
      <tr className={`${rowClass} has-card`} data-id={r.id} onClick={onOpen} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
        {show.campus && <td data-label="校舎" className={frz('campus')}>{r.campus}</td>}
        {show.no && <td data-label="No." className={`ib-no ${frz('no')}`}>{r.no || '—'}</td>}
        {show.dm && <td data-label="DM" className={`ib-c ${frz('dm')}`}>{dm}</td>}
        {show.date && <td data-label="日付" className={`ib-date ${frz('date')}`}>{shortDate(r.date)}</td>}
        {show.studentName && (
          <td data-label="生徒氏名" className={`ib-name ${frz('studentName')}`}>
            <b>{r.studentName || (r.guardianName ? `（保護者）${r.guardianName}` : '（未記入）')}</b>
            {r.kana && <small>{r.kana}</small>}
          </td>
        )}
        {show.phone && (
          <td data-label="電話番号" className="ib-tel" onClick={stop}>
            <PhoneCell phone={r.phone} guardian={r.guardianName} />
          </td>
        )}
        {show.grade && <td data-label="学年">{r.grade}</td>}
        {show.school && <td data-label="学校" className="ib-school">{r.school}</td>}
        {show.source && <td data-label="媒体">{r.source}{r.referrer && <small className="ib-ref">紹介：{r.referrer}</small>}</td>}
        {show.term && <td data-label="受講期">{r.term}</td>}
        {show.contacted && <td data-label="連絡" className="ib-c">{r.contacted}</td>}
        {show.trial && <td data-label="体験" className="ib-c">{r.trial}{r.trialDate && <small>{shortDate(r.trialDate)}</small>}</td>}
        {show.meetingDate && <td data-label="面談" className="ib-c">{shortDate(r.meetingDate)}</td>}
        {show.agreed && <td data-label="本人OK" className="ib-c">{r.agreed}</td>}
        {show.closeDate && <td data-label="クローズ予定" className={`ib-c ${overdue ? 'ib-over' : ''}`}>{shortDate(r.closeDate)}</td>}
        {show.result && <td data-label="結果"><span className={`ib-badge st-${st}`}>{r.result || STATUS_LABEL.open}</span></td>}
        {show.enrollDate && <td data-label="入塾日" className="ib-c">{shortDate(r.enrollDate)}</td>}
        {show.note && <td data-label="備考" className="ib-note-cell">{r.note}</td>}
        {card}
      </tr>
    );
  }

  const sel = (key: keyof InquiryRecord, options: readonly string[], blank: string, label: string) => (
    <select aria-label={label} value={draft[key] as string} onChange={(e) => commit({ [key]: e.target.value })} disabled={state === 'saving'}>
      <option value="">{blank}</option>
      {withCurrent(options, draft[key] as string).map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  const date = (key: keyof InquiryRecord, label: string) => (
    <InlineDate label={label} value={draft[key] as string} onCommit={(v) => commit({ [key]: v })} />
  );

  return (
    <tr className={rowClass} data-id={r.id}>
      <td data-label="" className={`ib-act ${frz('act')}`}>
        <button type="button" className="ib-ghost sm" onClick={onOpen}>詳細</button>
        {state === 'saving' && <small>保存中…</small>}
        {state === 'saved' && <small className="ok">保存しました</small>}
        {state === 'error' && <small className="err">保存できませんでした</small>}
      </td>
      {show.campus && <td data-label="校舎" className={frz('campus')}>{r.campus}</td>}
      {show.no && <td data-label="No." className={`ib-no ${frz('no')}`}>{r.no || '—'}</td>}
      {show.dm && <td data-label="DM" className={`ib-c ${frz('dm')}`}>{dm}</td>}
      {show.date && <td data-label="日付" className={`ib-date ${frz('date')}`}>{date('date', '日付')}</td>}
      {show.studentName && (
        <td data-label="生徒氏名" className={`ib-name ${frz('studentName')}`}>
          <InlineText label="生徒氏名" value={draft.studentName} onCommit={(v) => commit({ studentName: v })} />
          {r.kana && <small>{r.kana}</small>}
        </td>
      )}
      {show.phone && (
        <td data-label="電話番号" className="ib-tel">
          <InlineText label="電話番号" value={draft.phone} onCommit={(v) => commit({ phone: v })} />
          {r.guardianName && <small>{r.guardianName}</small>}
        </td>
      )}
      {show.grade && <td data-label="学年">{sel('grade', GRADES, '—', '学年')}</td>}
      {show.school && <td data-label="学校" className="ib-school"><InlineText label="学校" value={draft.school} onCommit={(v) => commit({ school: v })} /></td>}
      {show.source && (
        <td data-label="媒体">
          <span className="ib-stack">
            {sel('source', SOURCES, '—', '媒体')}
            <InlineText label="紹介者" value={draft.referrer} onCommit={(v) => commit({ referrer: v })} />
          </span>
        </td>
      )}
      {show.term && <td data-label="受講期">{sel('term', TERMS, '—', '受講期')}</td>}
      {show.contacted && <td data-label="連絡">{sel('contacted', CONTACTS, '—', '連絡')}</td>}
      {show.trial && (
        <td data-label="体験">
          <span className="ib-stack">
            {sel('trial', MARKS, '—', '体験')}
            {date('trialDate', '体験日')}
          </span>
        </td>
      )}
      {show.meetingDate && <td data-label="面談">{date('meetingDate', '入塾提案面談日')}</td>}
      {show.agreed && <td data-label="本人OK">{sel('agreed', MARKS, '—', '本人OK')}</td>}
      {show.closeDate && <td data-label="クローズ予定" className={overdue ? 'ib-over' : ''}>{date('closeDate', 'クローズ予定日')}</td>}
      {show.result && <td data-label="結果">{sel('result', RESULTS, '追客中', '結果')}</td>}
      {show.enrollDate && <td data-label="入塾日">{date('enrollDate', '入塾日')}</td>}
      {show.note && (
        <td data-label="備考" className="ib-note-cell">
          <InlineText label="備考" multiline value={draft.note} onCommit={(v) => commit({ note: v })} />
        </td>
      )}
    </tr>
  );
}

/**
 * 一覧の電話番号。押すとそのまま発信できる（スマホの tel: リンク。PC では電話アプリが入っていれば開く）。
 * 保護者名があれば小さく添える（架電時に誰宛てか分かるように）。
 */
function PhoneCell({ phone, guardian }: { phone: string; guardian: string }) {
  const digits = (phone || '').replace(/[^0-9+]/g, '');
  return (
    <>
      {phone ? (
        digits ? <a href={`tel:${digits}`} className="ib-tel-link" title="押すと発信">{phone}</a> : <span>{phone}</span>
      ) : (
        <span className="ib-tel-none">—</span>
      )}
      {guardian && <small>{guardian}</small>}
    </>
  );
}

/** 一覧セルの文字入力。打っている途中は保存せず、セルを離れたとき（Enter でも）に変わっていれば保存する。 */
function InlineText({ label, value, onCommit, multiline }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const done = () => { if (v !== value) onCommit(v); };
  if (multiline) {
    return <textarea aria-label={label} value={v} rows={2} onChange={(e) => setV(e.target.value)} onBlur={done} />;
  }
  return (
    <input
      aria-label={label}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

/** 一覧セルの日付。通常はカレンダー入力（選んだ時点で保存）。旧データの「5/21.6/29」のような値は文字入力で見せる。 */
function InlineDate({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  if (value && !parseIso(value)) return <InlineText label={label} value={value} onCommit={onCommit} />;
  return <input type="date" aria-label={label} value={value} onChange={(e) => onCommit(e.target.value)} />;
}

// ---- 集計 -----------------------------------------------------------------

function StatsPanel({ stats, count, filtered }: { stats: ReturnType<typeof statsByGrade>; count: number; filtered: boolean }) {
  const rows = [...stats.grades, ...stats.groups, stats.total];
  return (
    <div className="ib-stats">
      <div className="ib-stats-head">
        <h2>学年別の集計</h2>
        <span className="ib-meta">{filtered ? `絞り込み後の ${count} 件の内訳` : `表示中の ${count} 件の内訳`}</span>
      </div>
      <div className="ib-table-wrap">
        <table className="ib-stat-table">
          <thead>
            <tr>
              <th>学年</th><th>問合</th><th>面談</th><th>問面率</th><th>体験</th><th>問体率</th>
              <th>入塾</th><th>問入率</th><th>申込</th><th>検討中</th><th>見送り</th><th>追客中</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.grade} className={s.grade === '合計' ? 'total' : /学生$/.test(s.grade) ? 'group' : ''}>
                <td>{s.grade}</td>
                <td>{s.total}</td>
                <td>{s.meeting}</td>
                <td>{pct(s.meeting, s.total)}</td>
                <td>{s.trial}</td>
                <td>{pct(s.trial, s.total)}</td>
                <td>{s.joined}</td>
                <td>{pct(s.joined, s.total)}</td>
                <td>{s.applied}</td>
                <td>{s.considering}</td>
                <td>{s.declined}</td>
                <td>{s.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ib-hint">面談＝入塾提案面談日あり／体験＝体験が〇／入塾＝結果が入塾／申込＝講習会・模試申込／検討中＝結果が検討中／追客中＝結果が未記入。</p>
    </div>
  );
}

// ---- 登録・編集パネル ---------------------------------------------------------
//
// PC（幅 900px 超）では画面の右に開き、左の一覧はそのまま見て押せる（押すとその人に切り替わる）。スマホは画面いっぱい。
// 編集は「電話をかけて状況を更新する」が中心なので、対応の記録 → 追客の状況 → 備考 → 基本 → その他 → 重複の統合 の順。
// 新規は電話を受けながら埋めるので、校舎・日付・氏名・電話・学年だけを先に出し、残りは［詳しく入力する］で開く（スマホ）。
// ［前へ］［次へ］は、一覧から開いたときの並び（絞り込み・並び替えの結果）を順番として使う。保存で一覧から外れる人がいても順番は崩れない。

type Nav = { pos: number; total: number; prevId: string | null; nextId: string | null };

type FormProps = {
  record: InquiryRecord | null;
  defaultCampus: string;
  today: string;
  user: string;
  nav: Nav | null;
  onClose: () => void;
  onSaved: (item: InquiryRecord, thenId?: string | null) => void; // thenId：［保存して次へ］で次に開く人
  onGoto: (id: string) => void;                                    // 前へ・次へ・重複のお知らせから別の人を開く（未保存の確認は済み）
  onDirty: (dirty: boolean) => void;                               // 一覧の行を押して切り替えるときの確認に使う
  onDeleted: (id: string) => void;
  onSynced: (item: InquiryRecord) => void;                         // 保存できなかったが最新の行が分かった（一覧だけ直す）
  candidates: InquiryRecord[];                                     // 統合先・重複のお知らせの候補（台帳の全件）
  onMerged: (item: InquiryRecord, droppedId: string) => void;      // 統合が済んだ（item=残った行、droppedId=消えた行）
};

const LEAVE_CONFIRM = '入力した内容はまだ保存されていません。保存せずに移ってよいですか？';
const CLOSE_CONFIRM = '入力した内容はまだ保存されていません。閉じると消えます。閉じてよいですか？';

/** スマホ幅か（パネルを画面いっぱいに出す幅。CSS の 900px と合わせる）。 */
function isNarrow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
}

/** 対応の記録に付ける「10/20 14:05」（日本時間）。 */
function nowStamp(): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('month')}/${g('day')} ${g('hour')}:${g('minute')}`;
}

function RecordForm({ record, defaultCampus, today, user, nav, onClose, onSaved, onGoto, onDirty, onDeleted, onSynced, candidates, onMerged }: FormProps) {
  // 開いた時点の値。編集中かどうか（閉じる・移る前に確かめる）の比べ先
  const [start] = useState<InquiryInput>(() => (record ? { ...record } : { ...emptyInput(defaultCampus), date: today }));
  const [v, setV] = useState<InquiryInput>(start);
  // 編集を始めた時点の行。保存のときに一緒に送り、変えた項目だけを書いてもらう（衝突したら最新の行に差し替える）
  const [base, setBase] = useState<InquiryRecord | null>(record);
  const [conflict, setConflict] = useState<{ item: InquiryRecord; keys: (keyof InquiryRecord)[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // 新規登録の［詳しく入力する］。スマホは最小の項目だけで始め、PC は最初から全部出す
  const [more, setMore] = useState(() => !!record || !isNarrow());
  const [memo, setMemo] = useState('');
  const [logged, setLogged] = useState<string[]>([]); // このパネルで記録した行（保存で確定する）
  const [trialAttn, setTrialAttn] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const trialRef = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<HTMLDivElement>(null);

  const dirty = !sameDraft(v, base ?? start);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  // ×・閉じる・Esc のどれで閉じても、保存していない入力があれば確かめる
  const requestClose = useCallback(() => {
    if (dirty && !window.confirm(CLOSE_CONFIRM)) return;
    onClose();
  }, [dirty, onClose]);
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    // スマホは画面いっぱいに重ねるので、後ろの一覧が動かないようにする（PC は一覧を見ながら使うので止めない）
    const narrow = isNarrow();
    const prev = document.body.style.overflow;
    if (narrow) document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      if (narrow) document.body.style.overflow = prev;
    };
  }, []);
  // 入力中にページを閉じる・再読み込みするときも、ブラウザの確認を出す
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => { if (conflict) conflictRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [conflict]);
  // 新規登録だけ氏名にフォーカスする（編集で当てるとスマホでキーボードが出て、対応の記録が隠れる）
  useEffect(() => { if (!record) firstRef.current?.focus(); }, [record]);

  function set<K extends keyof InquiryInput>(k: K, val: InquiryInput[K]) {
    setV((p) => ({ ...p, [k]: val }));
  }

  // 前へ・次へ・重複のお知らせから別の人へ。保存していない入力があれば確かめる
  function go(id: string | null) {
    if (!id || busy) return;
    if (dirty && !window.confirm(LEAVE_CONFIRM)) return;
    onGoto(id);
  }

  // over：衝突のあと［自分の入力で上書きする］を押したときの値（state の反映を待たずに送る）。then：保存のあとに開く人
  async function save(opts: { v?: InquiryInput; base?: InquiryRecord | null; then?: string | null } = {}) {
    if (busy) return;
    const val = opts.v ?? v;
    const b = opts.base ?? base;
    setBusy(true);
    setErrors([]);
    setConflict(null);
    try {
      const res = await fetch('/api/inquiry-board', {
        method: record ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record ? { ...val, id: record.id, base: b } : val),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok && j.item) {
        onSaved(j.item as InquiryRecord, opts.then);
      } else if (j?.reason === 'conflict' && j.item) {
        onSynced(j.item as InquiryRecord);
        setConflict({ item: j.item as InquiryRecord, keys: j.conflicts ?? [] });
      } else if (Array.isArray(j?.errors) && j.errors.length) {
        setErrors(j.errors);
      } else {
        setErrors([REASON_TEXT[j?.reason] ?? `保存に失敗しました（${j?.reason ?? '不明'}）。`]);
      }
    } catch {
      setErrors([REASON_TEXT.network_error]);
    } finally {
      setBusy(false);
    }
  }

  // ［保存して次へ］。変えていなければ保存せずに次の人へ
  function saveAndNext() {
    if (!nav?.nextId || busy) return;
    if (!dirty) { onGoto(nav.nextId); return; }
    void save({ then: nav.nextId });
  }

  async function remove() {
    if (!record || busy) return;
    const who = record.studentName || record.guardianName || `No.${record.no}`;
    if (!window.confirm(`${record.campus} #${record.no}「${who}」を削除します。よろしいですか？`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/inquiry-board?id=${encodeURIComponent(record.id)}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) onDeleted(record.id);
      else setErrors([REASON_TEXT[j?.reason] ?? `削除に失敗しました（${j?.reason ?? '不明'}）。`]);
    } catch {
      setErrors([REASON_TEXT.network_error]);
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save(); }
  }

  // 衝突のあと：どちらの場合も、自分が触っていない項目は他の人が直した最新の値に載せ替える
  function keepMine() {
    if (!conflict || !base) return;
    const nv = rebaseDraft(v, base, conflict.item);
    setV(nv);
    setBase(conflict.item);
    void save({ v: nv, base: conflict.item });
  }
  function takeTheirs() {
    if (!conflict || !base) return;
    const nv = rebaseDraft(v, base, conflict.item) as unknown as Record<string, unknown>;
    for (const k of conflict.keys) nv[k] = conflict.item[k];
    setV(nv as unknown as InquiryInput);
    setBase(conflict.item);
    setConflict(null);
  }
  const otherName = conflict?.item.updatedBy ? `${conflict.item.updatedBy}さん` : '他の人';

  // 対応を記録：備考の先頭に「[10/20 14:05 山田] 不通：メモ」を足し、連絡欄を変える（保存で確定）
  function log(kind: LogKind) {
    if (kind === 'memo' && !memo.trim()) return;
    const r = applyLog(v, kind, memo, `${nowStamp()} ${user}`);
    setV((p) => ({ ...p, ...r }));
    setLogged((l) => [r.note.split('\n')[0], ...l]);
    setMemo('');
    if (kind === 'trial' && !parseIso(v.trialDate)) {
      setTrialAttn(true);
      trialRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  const needsEnrollDate = statusOf(v.result) === 'joined' && !v.enrollDate;
  const { phone, studentName } = v;
  const dups = useMemo(() => (record ? [] : findDuplicates(candidates, { phone, studentName })), [record, candidates, phone, studentName]);
  const sameNameCount = useMemo(() => {
    const key = record ? nameKeyOf(record.studentName) : '';
    return key ? candidates.filter((r) => r.id !== record!.id && nameKeyOf(r.studentName) === key).length : 0;
  }, [candidates, record]);

  // ---- 項目（新規と編集で並びを変えるので、部品として先に作る） ----
  const fCampus = (
    <label className={v.campus ? '' : 'attention'}>校舎 <span className="req">必須</span>
      <select value={v.campus} onChange={(e) => set('campus', e.target.value)}>
        {!v.campus && <option value="">校舎を選ぶ</option>}
        {withCurrent(BOARD_CAMPUSES, v.campus).map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
  const fDate = (
    <Field label={<>問い合わせ日 <span className="req">必須</span></>}>
      <DateInput value={v.date} onChange={(x) => set('date', x)} today={today} quick={['today']} label="問い合わせ日" />
    </Field>
  );
  const fName = (
    <label className="full">生徒氏名 <span className="req">必須</span>
      <input ref={firstRef} value={v.studentName} onChange={(e) => set('studentName', e.target.value)} placeholder="姓 名" />
    </label>
  );
  const fKana = (
    <label className="full">ふりがな
      <input value={v.kana} onChange={(e) => set('kana', e.target.value)} />
    </label>
  );
  const fGrade = (
    <label>学年
      <select value={v.grade} onChange={(e) => set('grade', e.target.value)}>
        <option value="">—</option>
        {withCurrent(GRADES, v.grade).map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
    </label>
  );
  const fSchool = (
    <label className="full">学校名
      <input value={v.school} onChange={(e) => set('school', e.target.value)} placeholder="日野中" />
    </label>
  );
  const fPhone = (
    <label className="full">電話番号
      <input value={v.phone} onChange={(e) => set('phone', e.target.value)} onBlur={() => set('phone', normalizePhone(v.phone))} inputMode="tel" placeholder="090-0000-0000" />
    </label>
  );
  const fGuardian = (
    <label className="full">保護者名
      <input value={v.guardianName} onChange={(e) => set('guardianName', e.target.value)} />
    </label>
  );

  const secLog = record && (
    <section className="ib-log">
      <h3>対応を記録</h3>
      <input
        className="ib-log-memo"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); log('memo'); } }}
        placeholder="メモ（任意）例：夕方かけ直し"
        aria-label="対応のメモ"
      />
      <div className="ib-log-btns">
        <button type="button" onClick={() => log('ng')}>不通</button>
        <button type="button" onClick={() => log('ok')}>話せた</button>
        <button type="button" onClick={() => log('trial')}>体験予約</button>
        <button type="button" onClick={() => log('memo')} disabled={!memo.trim()}>メモだけ残す</button>
      </div>
      {logged.length > 0 && (
        <div className="ib-log-done">
          <ul>{logged.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <small>備考の先頭に入れました。［保存］で確定します。</small>
        </div>
      )}
    </section>
  );

  const secFollow = (
    <section>
      <h3>追客の状況</h3>
      <div className="ib-grid">
        <Field label="連絡" className="full">
          <Choice label="連絡" value={v.contacted} options={CONTACTS} onChange={(x) => set('contacted', x)} />
        </Field>
        <Field label={<>結果 <small>（決まるまでは追客中）</small></>} className="full">
          <Choice label="結果" value={v.result} options={RESULTS} blank="追客中" onChange={(x) => set('result', x)} />
        </Field>
        <Field label="体験日" className={`full ${trialAttn && !v.trialDate ? 'attention' : ''}`} ref={trialRef}>
          <DateInput value={v.trialDate} onChange={(x) => set('trialDate', x)} today={today} quick={['today', 'tomorrow', 'week']} label="体験日" />
          {trialAttn && !v.trialDate && <small className="ib-attn">体験予約の日を入れてください。</small>}
        </Field>
        <Field label="入塾提案面談日" className="full">
          <DateInput value={v.meetingDate} onChange={(x) => set('meetingDate', x)} today={today} quick={['today', 'tomorrow', 'week']} label="入塾提案面談日" />
        </Field>
        <Field label={<>体験 <small>（受けたら〇）</small></>}>
          <Choice label="体験" value={v.trial} options={MARKS} onChange={(x) => set('trial', x)} />
        </Field>
        <Field label="本人OK">
          <Choice label="本人OK" value={v.agreed} options={MARKS} onChange={(x) => set('agreed', x)} />
        </Field>
        <Field label="クローズ予定日" className="full">
          <DateInput value={v.closeDate} onChange={(x) => set('closeDate', x)} today={today} quick={['today', 'tomorrow', 'week']} label="クローズ予定日" />
        </Field>
        <Field label="入塾日" className={`full ${needsEnrollDate ? 'attention' : ''}`}>
          <DateInput value={v.enrollDate} onChange={(x) => set('enrollDate', x)} today={today} quick={['today']} label="入塾日" />
          {needsEnrollDate && <small className="ib-attn">結果が入塾のときは入塾日を入れてください（「今月入会」の集計に使います）。</small>}
        </Field>
        <Field label="受講期" className="full">
          <Choice label="受講期" value={v.term} options={TERMS} onChange={(x) => set('term', x)} />
        </Field>
        <label>媒体
          <select value={v.source} onChange={(e) => set('source', e.target.value)}>
            <option value="">—</option>
            {withCurrent(SOURCES, v.source).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>紹介者 <small>（紹介のとき）</small>
          <input value={v.referrer} onChange={(e) => set('referrer', e.target.value)} placeholder="紹介してくれた生徒・保護者" />
        </label>
      </div>
    </section>
  );

  const secNote = (
    <section>
      <h3>備考</h3>
      <textarea
        value={v.note}
        onChange={(e) => set('note', e.target.value)}
        placeholder="架電日時・検討中の理由・見送り理由・その他の補足（新しいものを上に書くと追いやすい）"
      />
    </section>
  );

  const secOther = (
    <section>
      <h3>その他</h3>
      <div className="ib-grid">
        <Field label={<>DM <small>（〇＝発送する）</small></>}>
          <Choice label="DM" value={v.dm} options={MARKS} onChange={(x) => set('dm', x)} />
        </Field>
        <label>No.
          <input
            type="number"
            min={0}
            value={v.no ?? ''}
            onChange={(e) => set('no', e.target.value === '' ? undefined : Number(e.target.value))}
            placeholder="空欄なら自動採番"
          />
        </label>
        <label className="full">メールアドレス
          <input value={v.email} onChange={(e) => set('email', e.target.value)} inputMode="email" />
        </label>
        <label>郵便番号
          <input value={v.postal} onChange={(e) => set('postal', e.target.value)} inputMode="numeric" placeholder="857-0000" />
        </label>
        <label className="wide">住所
          <input value={v.address} onChange={(e) => set('address', e.target.value)} />
        </label>
      </div>
    </section>
  );

  const dupBox = dups.length > 0 && (
    <div className="ib-dups" role="status">
      <b>すでに登録があるかもしれません</b>（登録する前に確かめてください。同じ人なら、その行を開いて追記します）
      <ul>
        {dups.map(({ record: r, reasons }) => (
          <li key={r.id}>
            <span>
              {r.campus} #{r.no} {r.studentName || r.guardianName || '（氏名なし）'}
              {r.grade && `・${r.grade}`}{r.date && `・${shortDate(r.date)}`}・{r.result || STATUS_LABEL.open}
              <small>（{reasons.join('・')}が同じ）</small>
            </span>
            <button type="button" className="ib-link" onClick={() => go(r.id)}>この行を開く</button>
          </li>
        ))}
      </ul>
    </div>
  );

  const title = record
    ? (record.studentName || (record.guardianName ? `（保護者）${record.guardianName}` : '（氏名なし）'))
    : '問い合わせの新規登録';

  return (
    <aside className="ib-panel" aria-label={record ? `${title}の編集` : title}>
      <div className="dm-modal ib-modal" onKeyDown={onKey}>
        <div className="dm-modal-head ib-panel-head">
          <div className="ib-panel-title">
            <div className="dm-modal-sub">
              {record ? `${record.campus} #${record.no}　更新 ${record.updatedBy || '—'} ${fmtTs(record.updatedAt)}` : `登録者：${user}`}
            </div>
            <h2>{title}{record?.grade && <small>{record.grade}</small>}</h2>
            {record?.phone && <div className="ib-panel-tel"><PhoneCell phone={record.phone} guardian={record.guardianName} /></div>}
          </div>
          <div className="ib-panel-nav">
            {nav && (
              <>
                <button type="button" className="ib-nav-btn" onClick={() => go(nav.prevId)} disabled={!nav.prevId || busy} aria-label="前の人">‹<span className="ib-nav-word"> 前へ</span></button>
                <span className="ib-nav-pos" title="一覧から開いたときの並びの何人目か">{nav.pos} / {nav.total}</span>
                <button type="button" className="ib-nav-btn" onClick={() => go(nav.nextId)} disabled={!nav.nextId || busy} aria-label="次の人"><span className="ib-nav-word">次へ </span>›</button>
              </>
            )}
            <button className="dm-modal-close" onClick={requestClose} aria-label="閉じる">×</button>
          </div>
        </div>

        <div className="dm-modal-body ib-form">
          {record ? (
            <>
              {sameNameCount > 0 && (
                <p className="ib-merge-note">
                  同じ氏名の行が {sameNameCount} 件あります。
                  <button type="button" className="ib-link" onClick={() => mergeRef.current?.scrollIntoView({ behavior: 'smooth' })}>重複の統合を見る</button>
                </p>
              )}
              {secLog}
              {secFollow}
              {secNote}
              <section>
                <h3>基本</h3>
                <div className="ib-grid">{fCampus}{fDate}{fName}{fKana}{fGrade}{fSchool}{fPhone}{fGuardian}</div>
              </section>
              {secOther}
              <div ref={mergeRef}>
                <MergeSection
                  record={record}
                  dirty={dirty}
                  candidates={candidates}
                  busy={busy}
                  setBusy={setBusy}
                  setErrors={setErrors}
                  onMerged={onMerged}
                />
              </div>
              <div className="ib-danger-zone">
                <button type="button" className="ib-delete" onClick={remove} disabled={busy}>この問い合わせを削除</button>
              </div>
            </>
          ) : (
            <>
              <section>
                <h3>基本（必須）</h3>
                <div className="ib-grid">
                  {fCampus}{fDate}{fName}{fPhone}{fGrade}
                  {more && <>{fKana}{fSchool}{fGuardian}</>}
                </div>
                {dupBox}
              </section>
              {more ? (
                <>
                  {secFollow}
                  {secNote}
                  {secOther}
                </>
              ) : (
                <button type="button" className="ib-more" onClick={() => setMore(true)}>
                  詳しく入力する（ふりがな・学校・保護者・追客の状況・備考など）
                </button>
              )}
            </>
          )}

          {conflict && (
            <div className="ib-conflict" role="alert" ref={conflictRef}>
              <p>
                <b>保存できませんでした。</b>この画面を開いたあとに、{otherName}が {fmtTs(conflict.item.updatedAt)} に同じ項目を変更しています。
                どちらの値にするか選んでください（ほかの項目の変更はそのまま残ります）。
              </p>
              <ul>
                {conflict.keys.map((k) => (
                  <li key={k}>
                    {labelOf(k)}：{otherName}「<b>{String(conflict.item[k] ?? '') || '空欄'}</b>」／あなた「<b>{String(v[k as keyof InquiryInput] ?? '') || '空欄'}</b>」
                  </li>
                ))}
              </ul>
              <div className="ib-conflict-actions">
                <button type="button" className="dm-modal-done" onClick={keepMine} disabled={busy}>自分の入力で上書きして保存</button>
                <button type="button" className="ib-cancel" onClick={takeTheirs} disabled={busy}>{otherName}の値に合わせる</button>
              </div>
            </div>
          )}

          {errors.length > 0 && (
            <ul className="ib-errors">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>

        <div className="dm-modal-foot ib-foot">
          <span className="ib-foot-hint">⌘/Ctrl + Enter で保存</span>
          <button className="ib-cancel" onClick={requestClose} disabled={busy}>閉じる</button>
          {record && nav?.nextId ? (
            <>
              <button className="ib-secondary" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : '保存'}</button>
              <button className="dm-modal-done" onClick={saveAndNext} disabled={busy}>{dirty ? '保存して次へ ›' : '次へ ›'}</button>
            </>
          ) : (
            <button className="dm-modal-done" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : record ? '保存' : '登録'}</button>
          )}
        </div>
      </div>
    </aside>
  );
}

/** パネルの1項目（ボタンで選ぶ項目・日付など、label で包めないもの）。見た目は label の項目と同じ。 */
const Field = forwardRef<HTMLDivElement, { label: ReactNode; className?: string; children: ReactNode }>(
  function Field({ label, className, children }, ref) {
    return (
      <div className={`ib-field ${className ?? ''}`} ref={ref}>
        <span className="ib-field-label">{label}</span>
        {children}
      </div>
    );
  },
);

/**
 * 短い選択肢をボタンで選ぶ（プルダウンより押す回数が少ない）。
 * blank があれば「未選択」をその名前のボタンで先頭に置く（結果の「追客中」）。無ければ選んだボタンをもう一度押すと外れる。
 * 選択肢に無い値（旧データの移行値など）もボタンとして出す（黙って消さない）。
 */
function Choice({ label, value, options, onChange, blank }: {
  label: string; value: string; options: readonly string[]; onChange: (v: string) => void; blank?: string;
}) {
  return (
    <div className="ib-choice" role="group" aria-label={label}>
      {blank != null && (
        <button type="button" className={!value ? 'on' : ''} aria-pressed={!value} onClick={() => onChange('')}>{blank}</button>
      )}
      {withCurrent(options, value).map((o) => (
        <button
          key={o}
          type="button"
          className={value === o ? 'on' : ''}
          aria-pressed={value === o}
          onClick={() => onChange(blank == null && value === o ? '' : o)}
        >{o}</button>
      ))}
    </div>
  );
}

// ---- 重複の統合 ------------------------------------------------------------------
//
// 同じ生徒が 2 行に分かれてしまったとき（HP フォームの別人判定・手入力の重複など）に、
// 編集中の行（残す行）にもう一方の行をまとめる。中身の決め方は lib/inquiryMerge.ts。
// 空欄だった項目だけ埋め、備考はつなげ、もう一方の行は削除する。実行前に何が変わるかを見せる。

function nameKeyOf(sname: string): string {
  return (sname || '').replace(/[\s　]/g, '');
}

/** 編集中の値が比べ先（開いた時点の値・編集を始めた時点の行）と同じか。ID・作成/更新の記録は見ない。 */
function sameDraft(a: InquiryInput, b: InquiryInput | InquiryRecord): boolean {
  for (const f of RECORD_FIELDS) {
    if (f.key === 'id' || f.key === 'createdAt' || f.key === 'createdBy' || f.key === 'updatedAt' || f.key === 'updatedBy') continue;
    const x = (a as unknown as Record<string, unknown>)[f.key];
    const y = (b as unknown as Record<string, unknown>)[f.key];
    if (String(x ?? '') !== String(y ?? '')) return false;
  }
  return true;
}

function MergeSection({ record, dirty, candidates, busy, setBusy, setErrors, onMerged }: {
  record: InquiryRecord;
  dirty: boolean;
  candidates: InquiryRecord[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setErrors: (e: string[]) => void;
  onMerged: (item: InquiryRecord, droppedId: string) => void;
}) {
  const key = nameKeyOf(record.studentName);
  const sameName = useMemo(
    () => candidates.filter((r) => r.id !== record.id && key && nameKeyOf(r.studentName) === key),
    [candidates, record.id, key],
  );
  // 同じ氏名の行があるときは最初から開き、1件だけならそれを選んでおく（後から来た問い合わせを開いて、すぐまとめられるように）
  const [open, setOpen] = useState(sameName.length > 0);
  const [q, setQ] = useState('');
  const [otherId, setOtherId] = useState(sameName.length === 1 ? sameName[0].id : '');
  const [swap, setSwap] = useState(false); // true なら「この行を残す」に反転

  const list = useMemo(() => {
    const others = candidates.filter((r) => r.id !== record.id);
    const qq = q.trim().toLowerCase();
    const hit = qq
      ? others.filter((r) => `${r.studentName} ${r.kana} ${r.phone} ${r.guardianName} ${r.school}`.toLowerCase().includes(qq))
      : others;
    const same = hit.filter((r) => key && nameKeyOf(r.studentName) === key);
    const rest = hit.filter((r) => !(key && nameKeyOf(r.studentName) === key));
    return { same, rest };
  }, [candidates, record.id, key, q]);

  const other = candidates.find((r) => r.id === otherId) ?? null;
  // 基本は古いほう（先に来た問い合わせ）を残し、この行（後から来たほう）をそこにまとめる。
  // 日付が同じか無いときは登録日時で決める。
  const otherIsOlder = other ? isOlder(other, record) : false;
  const keep = other ? ((otherIsOlder !== swap) ? other : record) : null;
  const drop = other ? (keep === other ? record : other) : null;
  const preview = keep && drop ? mergePreview(keep, drop) : null;

  const label = (r: InquiryRecord) =>
    `${r.campus} #${r.no} ${r.studentName || r.guardianName || '（氏名なし）'}${r.grade ? `・${r.grade}` : ''}${r.phone ? `・${r.phone}` : ''}${r.date ? `・${shortDate(r.date)}` : ''}`;
  const short = (r: InquiryRecord) => `${r.campus} #${r.no}${r.date ? `（${shortDate(r.date)}）` : ''}`;

  async function run() {
    if (!keep || !drop || busy) return;
    const who = drop.studentName || drop.guardianName || `No.${drop.no}`;
    if (!window.confirm(`${short(drop)}「${who}」を ${short(keep)} にまとめます。\n${short(drop)} は削除されます（内容は残る行の備考に入ります）。よろしいですか？`)) return;
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch('/api/inquiry-board/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepId: keep.id, dropId: drop.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok && j.item) onMerged(j.item as InquiryRecord, drop.id);
      else if (Array.isArray(j?.errors) && j.errors.length) setErrors(j.errors);
      else setErrors([REASON_TEXT[j?.reason] ?? `統合に失敗しました（${j?.reason ?? '不明'}）。`]);
    } catch {
      setErrors([REASON_TEXT.network_error]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ib-merge">
      <h3>
        重複の統合
        {sameName.length > 0 && <span className="ib-merge-hint">同じ氏名の行が {sameName.length} 件あります</span>}
        <button type="button" className="ib-link" onClick={() => setOpen((o) => !o)}>{open ? '閉じる' : '開く'}</button>
      </h3>
      {open && (
        <div className="ib-merge-body">
          <p className="ib-merge-desc">
            後から来た問い合わせを開いた状態で、以前の問い合わせを選ぶと、<b>古いほうの行に</b>この行をまとめます。
            古いほうの値を優先し、空欄の項目だけこの行の値で埋めます。備考はつなげ、日付は早いほうにします。
            まとめられた行は削除されます（値は残る行の備考に入るので、あとから見直せます）。
          </p>
          <div className="ib-merge-pick">
            <input
              className="ib-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="氏名・ふりがな・電話番号で絞り込み"
              aria-label="以前の問い合わせを絞り込み"
            />
            <select value={otherId} onChange={(e) => { setOtherId(e.target.value); setSwap(false); }} aria-label="以前の問い合わせ">
              <option value="">以前の問い合わせを選ぶ</option>
              {list.same.length > 0 && (
                <optgroup label="同じ氏名">
                  {list.same.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}
                </optgroup>
              )}
              <optgroup label={list.same.length ? 'その他' : '台帳の行'}>
                {list.rest.slice(0, 300).map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}
              </optgroup>
            </select>
          </div>
          {keep && drop && preview && (
            <div className="ib-merge-preview">
              <div>
                <b>残す行：{short(keep)}{keep === record ? '（この行）' : ''}</b>　←　まとめる行：{short(drop)}{drop === record ? '（この行）' : ''}
                <button type="button" className="ib-link" onClick={() => setSwap((v) => !v)}>入れ替える</button>
              </div>
              {keep === record && !swap && <div className="ib-meta">この行のほうが古いので、この行を残します。</div>}
              {preview.filled.length > 0 ? (
                <ul>
                  {preview.filled.map((f) => <li key={f.key}>{f.label}：空欄 → <b>{f.value}</b></li>)}
                </ul>
              ) : (
                <div className="ib-meta">空欄を埋める項目はありません。</div>
              )}
              {preview.dateFrom === 'drop' && <div>日付：{shortDate(keep.date) || '未記入'} → <b>{shortDate(preview.date)}</b>（早いほう）</div>}
              {preview.conflicts.length > 0 && (
                <div className="ib-meta">
                  両方にあって違う値（残す行を優先し、もう一方は備考に残す）：
                  {preview.conflicts.map((c) => `${c.label}「${c.keep}」←「${c.drop}」`).join('、')}
                </div>
              )}
              {drop.note && <div className="ib-meta">まとめる行の備考（{drop.note.split('\n').length} 行）を残す行の備考の下につなげます。</div>}
              {dirty && <div className="ib-attn">入力中の変更があります。先に「保存」してから統合してください。</div>}
              <button type="button" className="ib-merge-run" onClick={run} disabled={busy || dirty}>
                {keep === record ? 'この行にまとめる' : `${short(keep)} にまとめる`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** a のほうが b より古い（先に来た）問い合わせか。日付 → 登録日時 の順で比べる。同じなら a を古い扱いにする。 */
function isOlder(a: InquiryRecord, b: InquiryRecord): boolean {
  const da = parseIso(a.date) ? a.date : '';
  const db = parseIso(b.date) ? b.date : '';
  if (da && db && da !== db) return da < db;
  if (da && !db) return true;
  if (!da && db) return false;
  const ca = a.createdAt || ''; const cb = b.createdAt || '';
  if (ca && cb && ca !== cb) return ca < cb;
  return true;
}

/**
 * 日付入力。カレンダーのほか「今日」「明日」「1週間後」のボタンでも入れられる。
 * 旧シートから移した「5/21.6/29」のような複数日の値は date 入力に出せないので、
 * そのときだけ文字入力に切り替える（値を黙って消さないため）。
 */
type Quick = 'today' | 'tomorrow' | 'week';
const QUICK: Record<Quick, { label: string; days: number }> = {
  today: { label: '今日', days: 0 }, tomorrow: { label: '明日', days: 1 }, week: { label: '1週間後', days: 7 },
};

function DateInput({ value, onChange, today, quick = [], label }: {
  value: string; onChange: (v: string) => void; today?: string; quick?: Quick[]; label?: string;
}) {
  const isText = !!value && !parseIso(value);
  if (isText) {
    return (
      <span className="ib-date-text">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="5/21" aria-label={label} />
        <button type="button" className="ib-link" onClick={() => onChange('')}>消す</button>
      </span>
    );
  }
  return (
    <span className="ib-datein">
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      {today && quick.map((q) => {
        const d = addDays(today, QUICK[q].days);
        return (
          <button key={q} type="button" className={`ib-quick ${value === d ? 'on' : ''}`} onClick={() => onChange(d)}>
            {QUICK[q].label}
          </button>
        );
      })}
    </span>
  );
}
