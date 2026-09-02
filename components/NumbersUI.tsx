'use client';

import { useEffect, useState } from 'react';
import {
  DEPARTMENTS,
  campusesFor,
  NUMBER_FIELDS,
  cellKey,
  type NumberEntry,
  type NumberValues,
} from '@/lib/summerNumbers';

function fmtDate(s: string) {
  const m = s.match(/(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}` : s;
}

export default function NumbersUI({ name, campus }: { name: string; campus: string }) {
  const [dept, setDept] = useState(DEPARTMENTS.includes(campus) ? campus : DEPARTMENTS[0] ?? '');
  const [site, setSite] = useState('');
  const [values, setValues] = useState<NumberValues>({});
  const [entries, setEntries] = useState<NumberEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');

  async function load() {
    try {
      const res = await fetch('/api/numbers');
      const j = await res.json().catch(() => ({}));
      if (j?.ok && Array.isArray(j.items)) setEntries(j.items as NumberEntry[]);
      else if (j?.reason === 'not_configured') setNote('スプレッドシート連携（Apps Script）が未設定です。');
    } catch {
      setNote('登録済みの数値を取得できませんでした。');
    }
  }

  useEffect(() => {
    void load();
  }, []);

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
        body: JSON.stringify({ dept, campus: target, values }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setStatus(`${dept}／${target} の数値を登録しました。会議AIの「夏の結果報告」から使えます。`);
        void load();
      } else if (j?.reason === 'not_configured') {
        setStatus('未設定です。スプレッドシート連携（Apps Script）を設定してください。');
      } else {
        setStatus(`登録に失敗しました（理由：${j?.reason ?? '不明'}）。`);
      }
    } catch {
      setStatus('通信エラーが発生しました。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="numbers">
      <div className="page-head">
        <h1>数値報告</h1>
        <p>
          {campus}／{name} さん。夏の数値を校舎ごとに登録します。ここで登録した数値を、
          会議AIの「夏の結果報告」がそのまま使います（会議AIでは数値を聞かれません）。
        </p>
      </div>

      <div className="numbers-body">
        <div className="numbers-form">
          <div className="num-selects">
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
            {NUMBER_FIELDS.map((f) => (
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
            同じ校舎で送り直すと、最新の内容が使われます。
          </p>
        </div>

        <div className="num-list">
          <h2>登録済み（{campus}）</h2>
          {note && <p className="num-empty">{note}</p>}
          {entries.length === 0 ? (
            <p className="num-empty">まだ登録がありません。</p>
          ) : (
            <ul>
              {entries.map((e, i) => (
                <li key={i}>
                  <div className="num-list-head">
                    <b>{e.campus}</b>
                    <span className="num-meta">{e.user}／{fmtDate(e.ts)}</span>
                  </div>
                  <button className="num-edit" onClick={() => edit(e)}>この内容を読み込む</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
