'use client';

// 問合せ管理（/inquiry-board）の画面。
// スプレッドシート「2026小中等部問合せ管理」の校舎タブを、校舎タブ＋一覧＋登録フォームに置き換える。
//
// - 校舎タブで切り替え、一覧の行を押すとその件の編集フォームが開く
// - 「結果」が空＝追客中。連絡も結果も無い行（未着手）とクローズ予定日を過ぎた行（期限超過）は色を付ける
// - 集計（学年別の問合・面談・体験・入塾）は元シート右側の表を再現したもの
// - 保存先は Apps Script 経由のスプレッドシート「問合せ台帳」（lib/inquiryStore.ts）

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD_CAMPUSES, GRADES, SOURCES, TERMS, CONTACTS, MARKS, RESULTS,
  emptyInput, isOverdue, isUntouched, normalizeGrade, parseIso, pct, shortDate,
  statsByGrade, statusOf, STATUS_LABEL, toCsv, ymOf,
  type InquiryInput, type InquiryRecord, type RecordStatus,
} from '@/lib/inquiryRecords';
import { useModalDismiss } from '@/lib/useModalDismiss';

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
};

const STORAGE_KEY = 'ib_campus';
const ALL = 'すべて';

type SortKey = 'date' | 'no';

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
  const [status, setStatus] = useState<'' | RecordStatus | 'untouched' | 'overdue'>('');
  const [grade, setGrade] = useState('');
  const [source, setSource] = useState('');
  const [month, setMonth] = useState('');
  const [sort, setSort] = useState<SortKey>('date');
  const [showStats, setShowStats] = useState(false);

  const [editing, setEditing] = useState<InquiryRecord | 'new' | null>(null);

  const today = useMemo(() => todayIso(), []);

  // 前回見ていた校舎を覚えておく（毎回タブを押し直さなくて済むように）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && (saved === ALL || (BOARD_CAMPUSES as readonly string[]).includes(saved))) setCampus(saved);
    } catch {}
  }, []);
  function changeCampus(c: string) {
    setCampus(c);
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

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const r of campusRows) {
      const ym = ymOf(r.date);
      if (ym) set.add(ym);
    }
    return [...set].sort().reverse();
  }, [campusRows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = campusRows.filter((r) => {
      if (status) {
        if (status === 'untouched') { if (!isUntouched(r)) return false; }
        else if (status === 'overdue') { if (!isOverdue(r, today)) return false; }
        else if (statusOf(r.result) !== status) return false;
      }
      if (grade && normalizeGrade(r.grade) !== grade) return false;
      if (source && r.source !== source) return false;
      if (month && ymOf(r.date) !== month) return false;
      if (q) {
        const hay = [r.studentName, r.kana, r.school, r.guardianName, r.phone, r.note, r.result, r.source, r.campus, String(r.no)]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows.sort((a, b) => {
      if (sort === 'no') {
        const c = a.campus.localeCompare(b.campus, 'ja');
        return c !== 0 ? c : (a.no || 0) - (b.no || 0);
      }
      // YYYY-MM-DD 以外（旧シートの「5/21.6/29」など）は日付が読めないので末尾に回す
      const da = parseIso(a.date) ? a.date : '';
      const db = parseIso(b.date) ? b.date : '';
      const d = db.localeCompare(da);
      return d !== 0 ? d : (b.no || 0) - (a.no || 0);
    });
    return rows;
  }, [campusRows, query, status, grade, source, month, sort, today]);

  const counts = useMemo(() => {
    const c = { total: campusRows.length, open: 0, joined: 0, applied: 0, declined: 0, untouched: 0, overdue: 0 };
    for (const r of campusRows) {
      const st = statusOf(r.result);
      if (st === 'open') c.open++;
      else if (st === 'joined') c.joined++;
      else if (st === 'applied') c.applied++;
      else if (st === 'declined') c.declined++;
      if (isUntouched(r)) c.untouched++;
      if (isOverdue(r, today)) c.overdue++;
    }
    return c;
  }, [campusRows, today]);

  const stats = useMemo(() => statsByGrade(shown), [shown]);

  // ---- 保存後の反映 ------------------------------------------------------

  function applySaved(item: InquiryRecord) {
    setItems((prev) => {
      const i = prev.findIndex((r) => r.id === item.id);
      if (i === -1) return [item, ...prev];
      const next = [...prev];
      next[i] = item;
      return next;
    });
  }
  function applyDeleted(id: string) {
    setItems((prev) => prev.filter((r) => r.id !== id));
  }

  function downloadCsv() {
    const blob = new Blob([toCsv(shown)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `問合せ台帳_${campus === ALL ? '全校舎' : campus}_${today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const filtered = !!(query || status || grade || source || month);

  return (
    <div className="ib">
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

      {note && <div className="ib-note">{note}</div>}
      {backend === 'local' && (
        <div className="ib-note ib-note-dev">開発モード：この端末の .data/inquiry-board.json に保存しています（スプレッドシート未接続）。</div>
      )}

      <div className="ib-summary">
        <button className={`ib-sum ${status === '' ? 'active' : ''}`} onClick={() => setStatus('')}>
          <b>{counts.total}</b><span>問合せ</span>
        </button>
        <button className={`ib-sum ${status === 'open' ? 'active' : ''}`} onClick={() => setStatus(status === 'open' ? '' : 'open')}>
          <b>{counts.open}</b><span>追客中</span>
        </button>
        <button className={`ib-sum ${status === 'joined' ? 'active' : ''}`} onClick={() => setStatus(status === 'joined' ? '' : 'joined')}>
          <b>{counts.joined}</b><span>入塾</span>
        </button>
        <button className={`ib-sum ${status === 'applied' ? 'active' : ''}`} onClick={() => setStatus(status === 'applied' ? '' : 'applied')}>
          <b>{counts.applied}</b><span>申込</span>
        </button>
        <button className={`ib-sum ${status === 'declined' ? 'active' : ''}`} onClick={() => setStatus(status === 'declined' ? '' : 'declined')}>
          <b>{counts.declined}</b><span>見送り</span>
        </button>
        <button className={`ib-sum warn ${status === 'untouched' ? 'active' : ''}`} onClick={() => setStatus(status === 'untouched' ? '' : 'untouched')}>
          <b>{counts.untouched}</b><span>未着手</span>
        </button>
        <button className={`ib-sum danger ${status === 'overdue' ? 'active' : ''}`} onClick={() => setStatus(status === 'overdue' ? '' : 'overdue')}>
          <b>{counts.overdue}</b><span>期限超過</span>
        </button>
      </div>

      <div className="ib-toolbar">
        <button className="ib-primary" onClick={() => setEditing('new')}>＋ 新規登録</button>
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
        <select value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="学年">
          <option value="">すべての学年</option>
          {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="媒体">
          <option value="">すべての媒体</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="並び順">
          <option value="date">日付が新しい順</option>
          <option value="no">No.順</option>
        </select>
        <button className="ib-ghost" onClick={() => setShowStats((v) => !v)}>{showStats ? '集計を閉じる' : '集計'}</button>
        <button className="ib-ghost" onClick={downloadCsv} disabled={!shown.length}>CSV</button>
        <button className="ib-ghost" onClick={() => void load()} disabled={loading}>{loading ? '読込中…' : '更新'}</button>
      </div>

      {showStats && <StatsPanel stats={stats} count={shown.length} filtered={filtered} />}

      <div className="ib-list-head">
        <span>
          {filtered ? `${shown.length}件（${campusRows.length}件中）` : `${shown.length}件`}
          {filtered && (
            <button className="ib-link" onClick={() => { setQuery(''); setStatus(''); setGrade(''); setSource(''); setMonth(''); }}>
              絞り込みを解除
            </button>
          )}
        </span>
        {fetchedAt && <span className="ib-meta">取得 {fmtTs(fetchedAt)}</span>}
      </div>

      {loading && !items.length ? (
        <p className="ib-empty">読み込み中…</p>
      ) : shown.length === 0 ? (
        <p className="ib-empty">{items.length === 0 && !note ? 'まだ登録がありません。「＋ 新規登録」から追加してください。' : '該当する問い合わせはありません。'}</p>
      ) : (
        <div className="ib-table-wrap">
          <table className="ib-table">
            <thead>
              <tr>
                {campus === ALL && <th>校舎</th>}
                <th>No.</th>
                <th>日付</th>
                <th>生徒氏名</th>
                <th>学年</th>
                <th>学校</th>
                <th>媒体</th>
                <th>受講期</th>
                <th>連絡</th>
                <th>体験</th>
                <th>面談</th>
                <th>本人OK</th>
                <th>クローズ予定</th>
                <th>結果</th>
                <th>入塾日</th>
                <th className="ib-th-note">備考</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const st = statusOf(r.result);
                const overdue = isOverdue(r, today);
                const untouched = isUntouched(r);
                return (
                  <tr
                    key={r.id}
                    className={`ib-row st-${st} ${overdue ? 'overdue' : ''} ${untouched ? 'untouched' : ''}`}
                    onClick={() => setEditing(r)}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') setEditing(r); }}
                  >
                    {campus === ALL && <td data-label="校舎">{r.campus}</td>}
                    <td data-label="No." className="ib-no">{r.no || '—'}</td>
                    <td data-label="日付" className="ib-date">{shortDate(r.date)}</td>
                    <td data-label="生徒氏名" className="ib-name">
                      <b>{r.studentName || (r.guardianName ? `（保護者）${r.guardianName}` : '（未記入）')}</b>
                      {r.kana && <small>{r.kana}</small>}
                      {r.dm === '〇' && <span className="ib-dm">DM</span>}
                    </td>
                    <td data-label="学年">{r.grade}</td>
                    <td data-label="学校" className="ib-school">{r.school}</td>
                    <td data-label="媒体">{r.source}</td>
                    <td data-label="受講期">{r.term}</td>
                    <td data-label="連絡" className="ib-c">{r.contacted}</td>
                    <td data-label="体験" className="ib-c">{r.trial}{r.trialDate && <small>{shortDate(r.trialDate)}</small>}</td>
                    <td data-label="面談" className="ib-c">{shortDate(r.meetingDate)}</td>
                    <td data-label="本人OK" className="ib-c">{r.agreed}</td>
                    <td data-label="クローズ予定" className={`ib-c ${overdue ? 'ib-over' : ''}`}>{shortDate(r.closeDate)}</td>
                    <td data-label="結果"><span className={`ib-badge st-${st}`}>{r.result || STATUS_LABEL.open}</span></td>
                    <td data-label="入塾日" className="ib-c">{shortDate(r.enrollDate)}</td>
                    <td data-label="備考" className="ib-note-cell">{r.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RecordForm
          record={editing === 'new' ? null : editing}
          defaultCampus={campus === ALL ? BOARD_CAMPUSES[0] : campus}
          today={today}
          user={name}
          onClose={() => setEditing(null)}
          onSaved={(item) => { applySaved(item); setEditing(null); }}
          onDeleted={(id) => { applyDeleted(id); setEditing(null); }}
        />
      )}
    </div>
  );
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
              <th>入塾</th><th>問入率</th><th>申込</th><th>見送り</th><th>追客中</th>
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
                <td>{s.declined}</td>
                <td>{s.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ib-hint">面談＝入塾提案面談日あり／体験＝体験が〇／入塾＝結果が入塾／申込＝講習会・模試申込／追客中＝結果が未記入。</p>
    </div>
  );
}

// ---- 登録・編集フォーム ---------------------------------------------------------

type FormProps = {
  record: InquiryRecord | null;
  defaultCampus: string;
  today: string;
  user: string;
  onClose: () => void;
  onSaved: (item: InquiryRecord) => void;
  onDeleted: (id: string) => void;
};

function RecordForm({ record, defaultCampus, today, user, onClose, onSaved, onDeleted }: FormProps) {
  const [v, setV] = useState<InquiryInput>(() => (record ? { ...record } : { ...emptyInput(defaultCampus), date: today }));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const firstRef = useRef<HTMLInputElement>(null);

  useModalDismiss(onClose);
  useEffect(() => { firstRef.current?.focus(); }, []);

  function set<K extends keyof InquiryInput>(k: K, val: InquiryInput[K]) {
    setV((p) => ({ ...p, [k]: val }));
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch('/api/inquiry-board', {
        method: record ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record ? { ...v, id: record.id } : v),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok && j.item) {
        onSaved(j.item as InquiryRecord);
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

  const needsEnrollDate = statusOf(v.result) === 'joined' && !v.enrollDate;

  return (
    <div className="dm-modal-bg" onClick={onClose}>
      <div className="dm-modal ib-modal" role="dialog" aria-modal="true" aria-label={record ? '問い合わせの編集' : '問い合わせの新規登録'} onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="dm-modal-head">
          <div>
            <div className="dm-modal-sub">
              {record ? `${record.campus} #${record.no}　登録 ${record.createdBy || '—'} ${fmtTs(record.createdAt)}　更新 ${record.updatedBy || '—'} ${fmtTs(record.updatedAt)}` : `登録者：${user}`}
            </div>
            <h2>{record ? '問い合わせの編集' : '問い合わせの新規登録'}</h2>
          </div>
          <button className="dm-modal-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>

        <div className="dm-modal-body ib-form">
          <section>
            <h3>基本</h3>
            <div className="ib-grid">
              <label>校舎 <span className="req">必須</span>
                <select value={v.campus} onChange={(e) => set('campus', e.target.value)}>
                  {withCurrent(BOARD_CAMPUSES, v.campus).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>問い合わせ日 <span className="req">必須</span>
                <DateInput value={v.date} onChange={(x) => set('date', x)} />
              </label>
              <label>No.
                <input
                  type="number"
                  min={0}
                  value={v.no ?? ''}
                  onChange={(e) => set('no', e.target.value === '' ? undefined : Number(e.target.value))}
                  placeholder="空欄なら自動採番"
                />
              </label>
              <label>生徒氏名 <span className="req">必須</span>
                <input ref={firstRef} value={v.studentName} onChange={(e) => set('studentName', e.target.value)} placeholder="姓 名" />
              </label>
              <label>ふりがな
                <input value={v.kana} onChange={(e) => set('kana', e.target.value)} />
              </label>
              <label>学年
                <select value={v.grade} onChange={(e) => set('grade', e.target.value)}>
                  <option value="">—</option>
                  {withCurrent(GRADES, v.grade).map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <label>学校名
                <input value={v.school} onChange={(e) => set('school', e.target.value)} placeholder="日野中" />
              </label>
            </div>
          </section>

          <section>
            <h3>きっかけ</h3>
            <div className="ib-grid">
              <label>媒体
                <select value={v.source} onChange={(e) => set('source', e.target.value)}>
                  <option value="">—</option>
                  {withCurrent(SOURCES, v.source).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>受講期
                <select value={v.term} onChange={(e) => set('term', e.target.value)}>
                  <option value="">—</option>
                  {withCurrent(TERMS, v.term).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>DM
                <MarkSelect value={v.dm} onChange={(x) => set('dm', x)} />
              </label>
            </div>
          </section>

          <section>
            <h3>追客の状況</h3>
            <div className="ib-grid">
              <label>連絡
                <select value={v.contacted} onChange={(e) => set('contacted', e.target.value)}>
                  <option value="">—</option>
                  {withCurrent(CONTACTS, v.contacted).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>体験日
                <DateInput value={v.trialDate} onChange={(x) => set('trialDate', x)} />
              </label>
              <label>体験
                <MarkSelect value={v.trial} onChange={(x) => set('trial', x)} />
              </label>
              <label>入塾提案面談日
                <DateInput value={v.meetingDate} onChange={(x) => set('meetingDate', x)} />
              </label>
              <label>本人OK
                <MarkSelect value={v.agreed} onChange={(x) => set('agreed', x)} />
              </label>
              <label>クローズ予定日
                <DateInput value={v.closeDate} onChange={(x) => set('closeDate', x)} />
              </label>
              <label>結果 <small>（空欄＝追客中）</small>
                <select value={v.result} onChange={(e) => set('result', e.target.value)}>
                  <option value="">追客中（未決）</option>
                  {withCurrent(RESULTS, v.result).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className={needsEnrollDate ? 'attention' : ''}>入塾日
                <DateInput value={v.enrollDate} onChange={(x) => set('enrollDate', x)} />
                {needsEnrollDate && <small className="ib-attn">結果が入塾のときは入塾日を入れてください（「今月入会」の集計に使います）。</small>}
              </label>
            </div>
          </section>

          <section>
            <h3>備考</h3>
            <textarea
              value={v.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="架電日時・検討中の理由・見送り理由・その他の補足（新しいものを上に書くと追いやすい）"
            />
          </section>

          <section>
            <h3>連絡先（保護者）</h3>
            <div className="ib-grid">
              <label>保護者名
                <input value={v.guardianName} onChange={(e) => set('guardianName', e.target.value)} />
              </label>
              <label>電話番号
                <input value={v.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" placeholder="090-0000-0000" />
              </label>
              <label>メールアドレス
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

          {errors.length > 0 && (
            <ul className="ib-errors">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>

        <div className="dm-modal-foot ib-foot">
          {record && (
            <button className="ib-delete" onClick={remove} disabled={busy}>削除</button>
          )}
          <span className="ib-foot-hint">⌘/Ctrl + Enter で保存</span>
          <button className="ib-cancel" onClick={onClose} disabled={busy}>キャンセル</button>
          <button className="dm-modal-done" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 日付入力。通常はカレンダー入力。
 * 旧シートから移した「5/21.6/29」のような複数日の値は date 入力に出せないので、
 * そのときだけ文字入力に切り替える（値を黙って消さないため）。
 */
function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isText = !!value && !parseIso(value);
  if (isText) {
    return (
      <span className="ib-date-text">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="5/21" />
        <button type="button" className="ib-link" onClick={() => onChange('')}>消す</button>
      </span>
    );
  }
  return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
}

function MarkSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {withCurrent(MARKS, value).map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}
