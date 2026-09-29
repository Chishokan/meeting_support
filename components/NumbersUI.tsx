'use client';

import { useEffect, useState } from 'react';
import {
  DEPARTMENTS,
  NUMBER_FORMS,
  campusesFor,
  cellKey,
  defaultPeriod,
  displayRows,
  periodOptions,
  type NumberEntry,
  type NumberValues,
  type ReportKind,
} from '@/lib/numberReports';

const KINDS: ReportKind[] = ['monthly', 'season'];
const KIND_STORE = 'chishokan_numbers_kind';

// 会議AIでこの数値を読むモード名（登録完了の案内に使う）。
const CHAT_MODE_LABEL: Record<ReportKind, string> = {
  monthly: '月次報告',
  season: '講習の結果報告',
};

function fmtDate(s: string) {
  const m = s.match(/(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}` : s;
}

function reasonText(reason: string | undefined): string {
  if (reason === 'not_configured') return 'スプレッドシート連携（Apps Script）が未設定です。';
  if (reason === 'apps_script_outdated') {
    return 'Apps Script が古い版のままです。apps_script/Code.gs を貼り直して「新しいデプロイ」をしてください。';
  }
  return `理由：${reason ?? '不明'}`;
}

export default function NumbersUI({ name, campus }: { name: string; campus: string }) {
  const [kind, setKind] = useState<ReportKind>('monthly');
  const [period, setPeriod] = useState(() => defaultPeriod('monthly'));
  const [dept, setDept] = useState(DEPARTMENTS.includes(campus) ? campus : DEPARTMENTS[0] ?? '');
  const [site, setSite] = useState('');
  const [values, setValues] = useState<NumberValues>({});
  const [entries, setEntries] = useState<NumberEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');

  const form = NUMBER_FORMS[kind];
  const shown = entries.filter((e) => e.period === period);

  async function load(k: ReportKind) {
    setNote('');
    try {
      const res = await fetch(`/api/numbers?kind=${k}`);
      const j = await res.json().catch(() => ({}));
      if (j?.ok && Array.isArray(j.items)) setEntries(j.items as NumberEntry[]);
      else {
        setEntries([]);
        setNote(reasonText(j?.reason));
      }
    } catch {
      setEntries([]);
      setNote('登録済みの数値を取得できませんでした。');
    }
  }

  // 前回開いていた種類（月次／講習期）で開く。
  useEffect(() => {
    let k: ReportKind = 'monthly';
    try {
      if (localStorage.getItem(KIND_STORE) === 'season') k = 'season';
    } catch {}
    setKind(k);
    setPeriod(defaultPeriod(k));
    void load(k);
  }, []);

  function switchKind(next: ReportKind) {
    if (busy || next === kind) return;
    setKind(next);
    setPeriod(defaultPeriod(next));
    setValues({});
    setStatus('');
    setEntries([]);
    try {
      localStorage.setItem(KIND_STORE, next);
    } catch {}
    void load(next);
  }

  // 部門を変えたら、その部門に無い校舎の選択は外す（自由入力の部門はそのまま残す）。
  function changeDept(next: string) {
    setDept(next);
    const list = campusesFor(next);
    if (list.length > 0 && !list.includes(site)) setSite('');
  }

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  // 登録済みの内容を読み込んで、修正のたたき台にする。
  function edit(e: NumberEntry) {
    setPeriod(e.period);
    setDept(e.dept);
    setSite(e.campus);
    setValues(e.values);
    setStatus('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit() {
    const target = site.trim();
    if (!target) {
      setStatus('校舎を選んでください。');
      return;
    }
    setBusy(true);
    setStatus('送信中…');
    try {
      const res = await fetch('/api/numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, period, dept, campus: target, values }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setStatus(
          `${period}／${dept}／${target} の数値を登録しました。会議AIの「${CHAT_MODE_LABEL[kind]}」から使えます。`,
        );
        void load(kind);
      } else {
        setStatus(`登録に失敗しました。${reasonText(j?.reason)}`);
      }
    } catch {
      setStatus('通信エラーが発生しました。');
    } finally {
      setBusy(false);
    }
  }

  const options = periodOptions(kind);
  if (!options.includes(period)) options.unshift(period);

  return (
    <div className="numbers">
      <div className="page-head">
        <h1>数値報告</h1>
        <p>
          {campus}／{name} さん。数値を校舎ごとに登録します。通常期は毎月の「月次」、講習会（春期・夏期・冬期）の
          あとは「講習期」を選んでください。ここで登録した数値を、会議AIの「月次報告」「講習の結果報告」が
          そのまま使います（会議AIでは数値を聞かれません）。
        </p>
        <div className="mode-switch" role="tablist" aria-label="報告の種類">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === kind}
              className={`mode-btn ${k === kind ? 'active' : ''}`}
              onClick={() => switchKind(k)}
              disabled={busy}
            >
              {NUMBER_FORMS[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="numbers-body">
        <div className="numbers-form">
          <div className="num-selects">
            <label>
              <span>{form.periodLabel}</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                {options.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              <span>部門</span>
              <select value={dept} onChange={(e) => changeDept(e.target.value)}>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <label>
              <span>校舎</span>
              {campusesFor(dept).length > 0 ? (
                <select value={site} onChange={(e) => setSite(e.target.value)}>
                  <option value="">選択してください</option>
                  {campusesFor(dept).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                  placeholder="校舎名を入力"
                />
              )}
            </label>
          </div>

          <ol className="num-fields">
            {form.fields.map((f) => (
              <li key={f.key}>
                <div className="num-label">
                  {f.label}
                  {f.note && <small>{f.note}</small>}
                </div>
                <div className="num-cols">
                  {f.cols.map((c) => (
                    <label key={c.key} className={f.cols.length === 1 ? 'wide' : ''}>
                      <span>{c.label}</span>
                      <input
                        type="text"
                        inputMode={c.placeholder === '○名' ? 'numeric' : 'text'}
                        value={values[cellKey(f, c)] ?? ''}
                        onChange={(e) => set(cellKey(f, c), e.target.value)}
                        placeholder={c.placeholder}
                      />
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ol>

          <div className="num-actions">
            <button onClick={submit} disabled={busy}>{busy ? '送信中…' : '登録する'}</button>
            {status && <span className="num-note">{status}</span>}
          </div>
          <p className="num-hint">
            ※ 分からない項目は空欄のままで構いません（会議AIでは「未集計」と表示されます）。
            同じ{form.periodLabel}・同じ校舎で送り直すと、最新の内容が使われます。
          </p>
        </div>

        <div className="num-list">
          <h2>登録済みの数値（{campus}／{period}）</h2>
          <p className="num-list-note">
            部門のメンバーが登録した内容です。会議AIはこの数値を使います。
            ほかの{form.periodLabel}は、左の「{form.periodLabel}」を切り替えると表示されます。
          </p>
          {note && <p className="num-empty">{note}</p>}
          {shown.length === 0 ? (
            <p className="num-empty">まだ登録がありません。</p>
          ) : (
            <ul>
              {shown.map((e, i) => (
                <li key={i}>
                  <div className="num-list-head">
                    <b>{e.campus}</b>
                    <span className="num-meta">{e.user}／{fmtDate(e.ts)}</span>
                  </div>
                  <dl className="num-view">
                    {displayRows(form, e.values).map((r, j) => (
                      <div key={j} className={r.value === '—' ? 'empty' : ''}>
                        <dt>{r.label}</dt>
                        <dd>{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <button className="num-edit" onClick={() => edit(e)}>この内容を読み込んで修正</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
