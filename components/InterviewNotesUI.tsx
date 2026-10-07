'use client';

// 面談記録（/interview-notes）
// 流れ：面談情報を入力 →（録音／録音ファイル添付／文字起こし貼り付け）→ AIが面談記録にまとめる →
//       記録者が確認・修正 → 保存 → 同じ部門の人が一覧で見返せる
// 録音・文字起こしの仕組みは部門会議議事録と共通（lib/useAudioTranscriber.ts / components/AudioCapture.tsx）。
// テンプレート：lib/interviewNotes/template.ts　AIへの指示：lib/interviewNotes/prompt.ts

import { useCallback, useEffect, useState } from 'react';
import AudioCapture from '@/components/AudioCapture';
import { useAudioTranscriber } from '@/lib/useAudioTranscriber';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { GRADES, INTERVIEW_KINDS, interviewOutline } from '@/lib/interviewNotes/template';
import { EMPTY_INTERVIEW_META, type InterviewMeta } from '@/lib/interviewNotes/prompt';
import { extractNoteSection, joinNote } from '@/lib/interviewNotes/parse';
import type { InterviewNoteRow } from '@/lib/interviewNotes/types';

// 編集中の内容を端末に保持するキー（面談の録音は取り直せないので、リロードでも消さない）。
const STORE_KEY = 'chishokan_interview_note_v1';

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDate(s: string) {
  const m = s.match(/(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}` : s;
}

function fmtStamp(s: string) {
  const d = s.match(/(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})/);
  const t = s.match(/(\d{1,2}):(\d{2})/);
  if (!d) return s;
  return `${Number(d[2])}/${Number(d[3])}${t ? ` ${t[1].padStart(2, '0')}:${t[2]}` : ''}`;
}

// 一覧カードに出す要点（「話した内容」の先頭数行）。
function cardLines(note: string, max = 2): string[] {
  const sec = extractNoteSection(note, '話した内容') || extractNoteSection(note, '面談の目的');
  return sec
    .split('\n')
    .map((l) => l.trim().replace(/^[-*・•]\s*/, '').replace(/^\d+[.．)、]\s*/, ''))
    .filter((l) => l && !/^[（(].*[）)]$/.test(l) && !/^(該当なし|特になし|なし)$/.test(l))
    .slice(0, max);
}

function newMeta(name: string): InterviewMeta {
  return { ...EMPTY_INTERVIEW_META, date: todayLocal(), interviewer: name };
}

export default function InterviewNotesUI({
  name,
  campus,
  seeAll,
}: {
  name: string;
  campus: string;
  seeAll: boolean; // 管理部門（全部門の記録が見える）
}) {
  const [meta, setMeta] = useState<InterviewMeta>(() => newMeta(name));
  const [transcript, setTranscript] = useState('');
  // 面談中に手で取ったメモ（任意）。音声と一緒にAIへ渡す。
  const [memo, setMemo] = useState('');
  const [draft, setDraft] = useState('');
  const [instruction, setInstruction] = useState('');
  // 保存済みの記録を［修正］で開いているときだけ入る。付けて保存すると元の行を上書きする。
  const [editingId, setEditingId] = useState('');

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [warn, setWarn] = useState('');
  const [err, setErr] = useState('');

  const [rows, setRows] = useState<InterviewNoteRow[]>([]);
  const [listMsg, setListMsg] = useState('');
  const [search, setSearch] = useState('');
  const [openRow, setOpenRow] = useState<InterviewNoteRow | null>(null);
  const [showTemplate, setShowTemplate] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const t = useAudioTranscriber({
    endpoint: '/api/interview-notes/transcribe',
    labels: { action: '面談記録を作成', memo: '面談中のメモ', output: '面談記録' },
    onText: (text) => setTranscript((prev) => (prev ? `${prev}\n${text}` : text)),
    setNote,
    setWarn,
    setErr,
  });
  const { recording } = t;

  // ---- 下書きの保持 ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        if (j?.meta) setMeta({ ...EMPTY_INTERVIEW_META, ...j.meta });
        if (typeof j?.transcript === 'string') setTranscript(j.transcript);
        if (typeof j?.memo === 'string') setMemo(j.memo);
        if (typeof j?.draft === 'string') setDraft(j.draft);
        if (typeof j?.editingId === 'string') setEditingId(j.editingId);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ meta, transcript, memo, draft, editingId }));
    } catch {}
  }, [hydrated, meta, transcript, memo, draft, editingId]);

  // ---- 保存済みの面談記録 ----
  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch('/api/interview-notes/list');
      const j = await res.json().catch(() => ({}));
      if (j?.ok && Array.isArray(j.items)) {
        setRows(j.items as InterviewNoteRow[]);
        setListMsg('');
      } else if (j?.reason === 'not_configured') {
        setListMsg('スプレッドシート連携が未設定のため、保存済みの記録は表示できません。');
      } else {
        setListMsg('保存済みの記録を読み込めませんでした。「更新」でもう一度お試しください。');
      }
    } catch {
      setListMsg('保存済みの記録を読み込めませんでした。通信状況をご確認ください。');
    }
  }, []);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  // ---- 面談記録の生成 ----
  async function generate(mode: 'draft' | 'revise') {
    if (generating) return;
    const text = transcript.trim();
    const memoText = memo.trim();
    if (mode === 'revise') {
      if (!instruction.trim()) return;
      if (!draft.trim()) {
        setErr('先に面談記録を作成してください。');
        return;
      }
    } else if (!text && !memoText) {
      setErr('先に面談の音声か面談中のメモを用意してください。');
      return;
    }
    setErr('');
    setWarn('');
    setNote('');
    setGenerating(true);
    const before = draft;
    setDraft('');
    try {
      const res = await fetch('/api/interview-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, meta, transcript: text, memo: memoText, draft: before, instruction }),
      });
      if (res.status === 413) throw new Error('too_long');
      if (!res.ok || !res.body) throw new Error('failed');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setDraft(acc);
      }
      if (mode === 'revise') setInstruction('');
    } catch (e) {
      // 失敗したときは直前の記録を戻す（修正依頼の失敗で手直しした記録が消えないように）。
      setDraft(before);
      setErr(
        (e as Error)?.message === 'too_long'
          ? '文字起こしが長すぎて一度にまとめられません。面談ごとに分けてお試しください。'
          : '面談記録の作成に失敗しました。もう一度お試しください。',
      );
    } finally {
      setGenerating(false);
    }
  }

  // ---- 保存 ----
  async function save() {
    if (saving || !draft.trim()) return;
    if (!meta.student.trim()) {
      setErr('生徒氏名を入れてから保存してください（あとで記録を探すときに使います）。');
      return;
    }
    setErr('');
    setNote('保存中…');
    setSaving(true);
    try {
      const res = await fetch('/api/interview-notes/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta, content: draft, id: editingId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setNote(j.updated ? `保存しました（${name} が修正）。` : '保存しました。');
        if (j.id) setEditingId(String(j.id));
        void loadSaved();
      } else if (j?.reason === 'not_configured') {
        setNote('スプレッドシート連携が未設定のため、この端末にのみ保存しました。');
      } else if (j?.reason === 'forbidden') {
        setErr('他の部門の面談記録は上書きできません。');
        setNote('');
      } else {
        setErr('保存に失敗しました。時間をおいてお試しください。');
        setNote('');
      }
    } catch {
      setErr('保存に失敗しました。通信状況をご確認ください。');
      setNote('');
    } finally {
      setSaving(false);
    }
  }

  // 保存済みの記録を編集欄へ読み込む（上書き保存できるよう id を持ったままにする）。
  function startEdit(row: InterviewNoteRow) {
    if (draft.trim() && !confirm('編集中の面談記録を破棄して、保存済みの記録を読み込みますか？')) return;
    setMeta({
      student: row.student, grade: row.grade, kind: row.kind, date: row.date, place: row.place,
      interviewer: row.interviewer, attendees: row.attendees, purpose: row.purpose,
    });
    // 録音の文字起こしは保存していないので空。面談記録の本文が修正の材料になる。
    setTranscript('');
    setMemo('');
    setDraft(joinNote(row.note, row.checks));
    setEditingId(row.id);
    setOpenRow(null);
    setErr('');
    setWarn('');
    setNote('保存済みの面談記録を読み込みました。直して「確認しました・保存する」を押すと上書きされます。');
    setTimeout(() => document.querySelector('.dm-draft')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }

  function reset() {
    if (!confirm('入力中の面談情報・文字起こし・面談記録をすべて消して、新しい面談を始めますか？')) return;
    t.resetAll();
    setMeta(newMeta(name));
    setTranscript('');
    setMemo('');
    setDraft('');
    setEditingId('');
    setInstruction('');
    setNote('');
    setWarn('');
    setErr('');
  }

  const set = (k: keyof InterviewMeta) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setMeta((m) => ({ ...m, [k]: e.target.value }));

  const q = search.trim();
  const shown = q
    ? rows.filter((r) => [r.student, r.kind, r.grade, r.interviewer, r.place].some((v) => v.includes(q)))
    : rows;

  return (
    <div className="dm">
      <div className="page-head">
        <h1>面談記録</h1>
        <p>
          {campus}／{name} さん。面談を録音して文字起こしし、面談記録のテンプレートに沿ってまとめます。
          内容を確認して保存すると、{seeAll ? '全部門' : `${campus}`}の面談記録として見返せます。
        </p>
        <button className="reset-chat" onClick={reset} disabled={generating || saving || recording}>
          新しい面談
        </button>
      </div>

      <div className="dm-body">
        <div className="dm-main">
          {/* ---------- 1. 面談情報 ---------- */}
          <section className="dm-step">
            <h2><span className="dm-num">1</span>面談の情報</h2>
            <div className="dm-fields">
              <label>
                <span>生徒氏名</span>
                <input value={meta.student} onChange={set('student')} placeholder="例：智翔 太郎" />
              </label>
              <label>
                <span>学年</span>
                <select value={meta.grade} onChange={set('grade')}>
                  <option value="">選んでください</option>
                  {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <label>
                <span>面談の種類</span>
                <select value={meta.kind} onChange={set('kind')}>
                  <option value="">選んでください</option>
                  {INTERVIEW_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              <label>
                <span>面談日時</span>
                <input value={meta.date} onChange={set('date')} placeholder="例：2026/10/7 19:00〜19:30" />
              </label>
              <label>
                <span>校舎・場所</span>
                <input value={meta.place} onChange={set('place')} placeholder="例：日野校 / オンライン" />
              </label>
              <label>
                <span>面談者</span>
                <input value={meta.interviewer} onChange={set('interviewer')} placeholder="例：安東" />
              </label>
              <label className="wide">
                <span>同席者</span>
                <input value={meta.attendees} onChange={set('attendees')} placeholder="例：母、池田（担当講師）" />
              </label>
              <label className="wide">
                <span>面談の目的・事前メモ（任意）</span>
                <textarea
                  className="dm-agenda"
                  value={meta.purpose}
                  onChange={set('purpose')}
                  placeholder={
                    '面談の前に確認したかったことがあれば書いてください。\n'
                    + '例：\n・2学期中間の結果（数学が前回から-15点）\n・冬期講習の受講講座\n・志望校（第1・第2）の確認'
                  }
                />
              </label>
            </div>
            <p className="dm-hint">
              目的・事前メモを入れておくと、「話に出てこなかった項目」を確認事項として挙げます。
              事前メモに書いただけで面談で話していない内容が、話したことのように記録されることはありません。
            </p>
          </section>

          {/* ---------- 2. 音声 → 文字起こし ---------- */}
          <section className="dm-step">
            <h2><span className="dm-num">2</span>面談の音声を取り込む</h2>
            <AudioCapture
              t={t}
              transcript={transcript}
              setTranscript={setTranscript}
              subject="面談"
              recordHint="録音を始める前に、生徒・保護者に「記録のために録音します」と伝えて了承を得てください。録音そのものは保存されません。"
            />

            <label className="dm-memo">
              <span>
                面談中のメモ（任意）
                {memo.trim() && <em>　{memo.length.toLocaleString()}字</em>}
              </span>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder={'面談中に取ったメモがあれば貼り付けてください。箇条書き・断片のままで構いません。\n例：\n・数学 62点（前回77）\n・冬期 数学集中 受講OK（母）\n・第1志望 ○○高校'}
              />
              <small>
                メモは文字起こしより正確なものとして扱います。数字・学校名が録音と食い違うときはメモのほうを採用します。
                録音しなかった面談は、メモだけでも記録を作れます。
              </small>
            </label>

            <div className="dm-actions">
              <button
                className="dm-primary"
                onClick={() => void generate('draft')}
                disabled={generating || (!transcript.trim() && !memo.trim()) || recording}
              >
                {generating ? '作成中…' : '面談記録を作成'}
              </button>
              {recording && <span className="dm-note">録音を終了してから作成してください。</span>}
            </div>
          </section>

          {/* ---------- 3. 確認・保存 ---------- */}
          <section className="dm-step">
            <h2><span className="dm-num">3</span>内容を確認して保存</h2>
            {!draft && !generating ? (
              <p className="dm-hint">面談記録を作成すると、ここに表示されます。そのまま手で直せます。</p>
            ) : (
              <>
                {generating && (
                  <div className="dm-work-line">
                    <span className="dm-spinner" aria-hidden="true" />
                    <span>
                      {draft ? '面談記録を作成中…（下に書き出しています）' : 'AIが面談記録をまとめています…'}
                    </span>
                  </div>
                )}
                <textarea
                  className="dm-draft"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="面談記録をまとめています…"
                />
                <div className="dm-revise">
                  <input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="AIに直してほしいこと（例：ToDo の期限を11/末に）"
                    onKeyDown={(e) => {
                      // 日本語入力の変換確定でも Enter が来るため、⌘/Ctrl + Enter で送信する。
                      if (
                        e.key === 'Enter'
                        && (e.metaKey || e.ctrlKey)
                        && !e.nativeEvent.isComposing
                        && instruction.trim()
                      ) {
                        e.preventDefault();
                        void generate('revise');
                      }
                    }}
                  />
                  <button
                    onClick={() => void generate('revise')}
                    disabled={generating || !instruction.trim()}
                    title="⌘・Ctrl + Enter でも送信できます"
                  >
                    修正を依頼
                  </button>
                </div>
                <div className="dm-actions">
                  <button className="dm-save" onClick={save} disabled={saving || generating || !draft.trim()}>
                    {saving ? '保存中…' : '確認しました・保存する'}
                  </button>
                  <button
                    className="dm-copy"
                    onClick={() => navigator.clipboard?.writeText(draft)}
                    disabled={!draft.trim()}
                  >
                    コピー
                  </button>
                </div>
                <p className="dm-hint">
                  末尾の「確認事項」は、聞き漏れや聞き取りの怪しい箇所の指摘です。直したら消してから保存して構いません。
                  合意していないことが「合意したこと」に混ざっていないか、保存前にご確認ください。
                </p>
              </>
            )}
            {note && <p className="dm-note ok">{note}</p>}
            {warn && <p className="dm-note warn">{warn}</p>}
            {err && <p className="dm-note err">{err}</p>}
          </section>
        </div>

        {/* ---------- 右：保存済みの面談記録 ---------- */}
        <aside className="dm-side">
          <div className="dm-panel">
            <div className="dm-panel-head">
              <h2>保存済みの面談記録{rows.length > 0 && `（${rows.length}）`}</h2>
              <button className="dm-reload" onClick={() => void loadSaved()}>更新</button>
            </div>
            <input
              className="dm-filter"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="生徒氏名・面談者などで絞り込み"
            />
            {meta.student.trim() && search.trim() !== meta.student.trim() && (
              <button className="dm-tlink iv-same" onClick={() => setSearch(meta.student.trim())}>
                「{meta.student.trim()}」の過去の記録を見る
              </button>
            )}
            {listMsg ? (
              <p className="dm-empty">{listMsg}</p>
            ) : shown.length === 0 ? (
              <p className="dm-empty">
                {q
                  ? '該当する面談記録はありません。'
                  : `まだ保存された面談記録はありません。保存すると、ここに${seeAll ? '全部門' : campus}の記録が並びます。`}
              </p>
            ) : (
              <ul className="dm-meet-list">
                {shown.slice(0, 60).map((r) => {
                  const lines = cardLines(r.note);
                  return (
                    <li key={r.id || r.ts}>
                      <div className="dm-meet-head">
                        <span className="dm-meet-date">{fmtDate(r.date || r.ts)}</span>
                        {r.kind && <span className="dm-dec-campus">{r.kind}</span>}
                        {seeAll && r.campus && <span className="dm-dec-date">{r.campus}</span>}
                      </div>
                      <div className="dm-meet-title">
                        {r.student || '（生徒名なし）'}{r.grade && `（${r.grade}）`}
                      </div>
                      {lines.length > 0 && (
                        <ul className="dm-meet-agenda">
                          {lines.map((l, k) => <li key={k}>{l}</li>)}
                        </ul>
                      )}
                      <div className="dm-meet-foot">
                        <span className="dm-meet-count">面談：{r.interviewer || r.user}</span>
                        <button className="dm-detail" onClick={() => setOpenRow(r)}>詳細</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="dm-panel">
            <div className="dm-panel-head">
              <h2>面談記録テンプレート</h2>
              <button className="dm-reload" onClick={() => setShowTemplate((v) => !v)}>
                {showTemplate ? '閉じる' : '見る'}
              </button>
            </div>
            {showTemplate ? (
              <ol className="dm-tpl">
                {interviewOutline().map((o) => (
                  <li key={o.heading}>
                    <b>{o.heading}</b>
                    <span>{o.guide}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="dm-empty">
                AIはこのテンプレートに沿って面談記録をまとめ、聞き漏れなどを「確認事項」として挙げます。
              </p>
            )}
          </div>
        </aside>
      </div>

      {openRow && (
        <InterviewNoteDetail row={openRow} onClose={() => setOpenRow(null)} onEdit={() => startEdit(openRow)} />
      )}
    </div>
  );
}

// 面談記録1件の詳細（ポップアップ）。見た目は議事録の詳細（components/MinutesDetail.tsx）と同じ。
function InterviewNoteDetail({
  row,
  onClose,
  onEdit,
}: {
  row: InterviewNoteRow;
  onClose: () => void;
  onEdit: () => void;
}) {
  useModalDismiss(onClose);
  return (
    <div className="dm-modal-bg" onClick={onClose}>
      <div
        className="dm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="面談記録の詳細"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dm-modal-head">
          <div>
            <div className="dm-modal-sub">
              {fmtDate(row.date || row.ts)}　{row.kind}　{row.campus}
              {row.user && `　記録：${row.user}`}
            </div>
            <h2>{row.student || '（生徒名なし）'}{row.grade && `（${row.grade}）`}</h2>
            <div className="dm-modal-sub">
              面談者：{row.interviewer || '（未入力）'}{row.attendees && `　同席：${row.attendees}`}
            </div>
            {row.editedBy && (
              <div className="dm-modal-edited">修正：{fmtStamp(row.editedAt)}　{row.editedBy}</div>
            )}
          </div>
          <button className="dm-modal-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>

        <div className="dm-modal-body">
          <pre className="dm-modal-text">{row.note || '（本文がありません）'}</pre>
          {row.checks && (
            <div className="dm-modal-quality">
              <h3>確認事項</h3>
              <pre className="dm-modal-text">{row.checks}</pre>
            </div>
          )}
        </div>

        <div className="dm-modal-foot">
          <button className="dm-modal-edit" onClick={onEdit}>修正する</button>
          <button
            className="dm-copy"
            onClick={() =>
              navigator.clipboard?.writeText(row.checks ? `${row.note}\n\n【確認事項】\n${row.checks}` : row.note)
            }
          >
            コピー
          </button>
          <button className="dm-modal-done" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
