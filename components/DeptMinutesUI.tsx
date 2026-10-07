'use client';

import { useCallback, useEffect, useState } from 'react';
import { templateOutline } from '@/lib/deptMinutesTemplate';
import { extractDecisions, extractSection, summarizeSection } from '@/lib/deptMinutesParse';
import MinutesDetail from '@/components/MinutesDetail';
import AudioCapture from '@/components/AudioCapture';
import { useAudioTranscriber } from '@/lib/useAudioTranscriber';
import { DRAFT_KEY as STORE_KEY, draftFromRow } from '@/lib/deptMinutesDraft';
import type { DecisionRow, MinutesRow } from '@/app/api/dept-minutes/list/route';

// 録音・音声ファイルの取り込みと文字起こしは lib/useAudioTranscriber.ts（面談記録と共通）。
// 「音声を取り込む」欄の見た目は components/AudioCapture.tsx。

type Meta = { title: string; date: string; place: string; attendees: string; agenda: string };

const EMPTY_META: Meta = { title: '', date: '', place: '', attendees: '', agenda: '' };

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDate(s: string) {
  const m = s.match(/(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}` : s;
}

export default function DeptMinutesUI({ name, campus }: { name: string; campus: string }) {
  const [meta, setMeta] = useState<Meta>({ ...EMPTY_META, date: todayLocal() });
  const [transcript, setTranscript] = useState('');
  // 会議中に人が取ったメモ（任意）。音声と一緒にAIへ渡す。
  const [memo, setMemo] = useState('');
  const [draft, setDraft] = useState('');
  const [instruction, setInstruction] = useState('');

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  // 「一部だけ落ちた」ときの注意。失敗（赤）ではないので色を分ける。
  const [warn, setWarn] = useState('');
  const [err, setErr] = useState('');

  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [meetings, setMeetings] = useState<MinutesRow[]>([]);
  const [panelTab, setPanelTab] = useState<'meetings' | 'decisions'>('meetings');
  const [openMeeting, setOpenMeeting] = useState<MinutesRow | null>(null);
  // 保存済みの議事録を［修正］で開いているときだけ入る。
  // これを付けて保存すると新しい行を作らず、元の議事録を上書きする。
  const [editingId, setEditingId] = useState('');
  const [decFilter, setDecFilter] = useState('');
  const [showTemplate, setShowTemplate] = useState(false);
  // 下書きを読み終えたか。ref ではなく state にしているのは、
  // 読み込み直後の保存が「まだ反映されていない空の値」を書いてしまうのを防ぐため
  //（ref だと読み込みと同じ描画で保存側が動き、保存済みの下書きを消してしまう）。
  const [hydrated, setHydrated] = useState(false);

  // 録音・音声ファイル → 区間ごとの文字起こし。取れた文字は文字起こしの末尾に足していく。
  const t = useAudioTranscriber({
    endpoint: '/api/dept-minutes/transcribe',
    labels: { action: '議事録を作成', memo: '議事録メモ', output: '議事録' },
    onText: (text) => setTranscript((prev) => (prev ? `${prev}\n${text}` : text)),
    setNote,
    setWarn,
    setErr,
  });
  const { recording } = t;

  // ---- 下書きの保持（会議の録音は取り直せないので、リロードでも消さない） ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        if (j?.meta) setMeta({ ...EMPTY_META, ...j.meta });
        if (typeof j?.transcript === 'string') setTranscript(j.transcript);
        if (typeof j?.memo === 'string') setMemo(j.memo);
        if (typeof j?.editingId === 'string') setEditingId(j.editingId);
        if (typeof j?.draft === 'string') setDraft(j.draft);
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

  // 保存済みの議事録（会議ごと）と決定事項（1件ずつ）をまとめて読み込む。
  const loadSaved = useCallback(async () => {
    try {
      const [decRes, minRes] = await Promise.all([
        fetch('/api/dept-minutes/list'),
        fetch('/api/dept-minutes/list?scope=minutes'),
      ]);
      const jd = await decRes.json().catch(() => ({}));
      if (jd?.ok && Array.isArray(jd.items)) setDecisions(jd.items as DecisionRow[]);
      const jm = await minRes.json().catch(() => ({}));
      if (jm?.ok && Array.isArray(jm.items)) setMeetings(jm.items as MinutesRow[]);
    } catch {}
  }, []);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  // ---- 議事録の生成 ----
  async function generate(mode: 'draft' | 'revise') {
    if (generating) return;
    const text = transcript.trim();
    const memoText = memo.trim();
    if (mode === 'revise') {
      if (!instruction.trim()) return;
      // 保存済みの議事録を［修正］で開いたときは文字起こしが無い。議事録本文が材料になる。
      if (!draft.trim()) {
        setErr('先に議事録を作成してください。');
        return;
      }
    } else if (!text && !memoText) {
      // 録音が無くメモだけの会議もあるので、どちらか一方あれば作れる。
      setErr('先に会議の音声か議事録メモを用意してください。');
      return;
    }
    setErr('');
    setWarn('');
    setNote('');
    setGenerating(true);
    setDraft('');
    try {
      const res = await fetch('/api/dept-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, meta, transcript: text, memo: memoText, draft, instruction }),
      });
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
    } catch {
      setErr('議事録の作成に失敗しました。もう一度お試しください。');
    } finally {
      setGenerating(false);
    }
  }

  // ---- 保存 ----
  async function save() {
    if (saving || !draft.trim()) return;
    setErr('');
    setNote('保存中…');
    setSaving(true);
    try {
      const res = await fetch('/api/dept-minutes/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta, content: draft, id: editingId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setNote(
          j.updated
            ? `保存しました（${name} が修正／決定事項 ${j.decisions ?? 0} 件を入れ替え）。`
            : `保存しました（決定事項 ${j.decisions ?? 0} 件を全社共有に登録）。`,
        );
        // 続けて直せるよう、保存後も同じ議事録を編集中のままにする。
        if (j.id) setEditingId(String(j.id));
        void loadSaved();
      } else if (j?.reason === 'not_configured') {
        setNote('スプレッドシート連携が未設定のため、この端末にのみ保存しました。');
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

  // 保存済みの議事録を［修正］で編集画面へ読み込む。
  // 上書き保存できるよう editingId を持ったままにする。
  function startEdit(row: MinutesRow) {
    if (draft.trim() && !confirm('編集中の議事録を破棄して、保存済みの議事録を読み込みますか？')) return;
    const d = draftFromRow(row);
    setMeta({ ...EMPTY_META, ...d.meta });
    setTranscript(d.transcript);
    setMemo(d.memo);
    setDraft(d.draft);
    setEditingId(d.editingId);
    setOpenMeeting(null);
    setErr('');
    setWarn('');
    setNote(
      d.editingId
        ? '保存済みの議事録を読み込みました。直して「確認しました・保存する」を押すと上書きされます。'
        : '保存済みの議事録を読み込みました。※この議事録には識別子が無いため、保存すると新しい記録として追加されます。',
    );
    // 議事録の欄（手順3）まで送る。
    setTimeout(() => document.querySelector('.dm-draft')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }

  function reset() {
    if (!confirm('入力中の会議情報・文字起こし・議事録をすべて消して、新しい会議を始めますか？')) return;
    t.resetAll();
    setMeta({ ...EMPTY_META, date: todayLocal() });
    setTranscript('');
    setMemo('');
    setDraft('');
    setEditingId('');
    setInstruction('');
    setNote('');
    setWarn('');
    setErr('');
  }

  const set = (k: keyof Meta) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setMeta((m) => ({ ...m, [k]: e.target.value }));

  const shownDecisions = decisions.filter((d) => (decFilter ? d.campus === decFilter : true));
  const shownMeetings = meetings.filter((m) => (decFilter ? m.campus === decFilter : true));
  // 絞り込みの選択肢は、議事録と決定事項の両方に出てくる部門から作る。
  const campusesInList = Array.from(
    new Set([...meetings.map((m) => m.campus), ...decisions.map((d) => d.campus)].filter(Boolean)),
  );

  return (
    <div className="dm">
      <div className="page-head">
        <h1>部門会議議事録</h1>
        <p>
          {campus}／{name} さん。会議を録音して文字起こしし、議事録テンプレートに沿って整えます。
          内容を確認して保存すると、決定事項が全部門で見られるようになります。
        </p>
        <button className="reset-chat" onClick={reset} disabled={generating || saving || recording}>
          新しい会議
        </button>
      </div>

      <div className="dm-body">
        <div className="dm-main">
          {/* ---------- 1. 会議情報 ---------- */}
          <section className="dm-step">
            <h2><span className="dm-num">1</span>会議の情報</h2>
            <div className="dm-fields">
              <label>
                <span>会議名</span>
                <input value={meta.title} onChange={set('title')} placeholder="例：小中等部 定例会議" />
              </label>
              <label>
                <span>開催日時</span>
                <input value={meta.date} onChange={set('date')} placeholder="例：2026/9/10 18:00〜19:00" />
              </label>
              <label>
                <span>場所</span>
                <input value={meta.place} onChange={set('place')} placeholder="例：本部会議室 / オンライン" />
              </label>
              <label className="wide">
                <span>出席者</span>
                <input value={meta.attendees} onChange={set('attendees')} placeholder="例：直江、安東、池田、山中" />
              </label>
              <label className="wide">
                <span>予定していた議題、または会議のレジュメ（任意）</span>
                <textarea
                  className="dm-agenda"
                  value={meta.agenda}
                  onChange={set('agenda')}
                  placeholder={
                    '1行1件の箇条書きでも、レジュメをそのまま貼り付けても構いません。\n\n'
                    + '例1（箇条書き）\n9月の生徒数と対策\n中間テスト対策の役割分担\n\n'
                    + '例2（レジュメを貼り付け）\n1. 9月度 実績報告\n   (1) 生徒数・前年比\n   (2) 体験申込の状況\n2. 中間テスト対策について\n   ・担当の割り振り'
                  }
                />
              </label>
            </div>
            <p className="dm-hint">
              入れておくと、「予定どおり進んだか」「話し合えなかった議題はどれか」まで議事録に出ます。
              レジュメを貼った場合は、その見出しをそのまま議題名に使います。
              なお、レジュメに書いてあるだけで会議で触れられなかった内容が、
              決まったことのように議事録に載ることはありません。
            </p>
          </section>

          {/* ---------- 2. 音声 → 文字起こし ---------- */}
          <section className="dm-step">
            <h2><span className="dm-num">2</span>会議の音声を取り込む</h2>

            <AudioCapture t={t} transcript={transcript} setTranscript={setTranscript} subject="会議" />
            {/* 会議中に手で取ったメモ。録音と一緒に渡すと、聞き取れなかった数字や
                固有名詞をメモ側から補える。録音が無い会議はメモだけでも作れる。 */}
            <label className="dm-memo">
              <span>
                議事録メモ（任意）
                {memo.trim() && <em>　{memo.length.toLocaleString()}字</em>}
              </span>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder={'会議中に取ったメモがあれば貼り付けてください。箇条書き・断片のままで構いません。\n例：\n・サイトク 9/12開始で決定（池田）\n・バス18:50発に変更 → 総務へ依頼\n・冬期料金は次回持ち越し'}
              />
              <small>
                メモは文字起こしより正確なものとして扱います。数字・固有名詞・担当者名が
                録音と食い違うときはメモのほうを採用します。
              </small>
            </label>

            <div className="dm-actions">
              <button
                className="dm-primary"
                onClick={() => void generate('draft')}
                disabled={generating || (!transcript.trim() && !memo.trim()) || recording}
              >
                {generating ? '作成中…' : '議事録を作成'}
              </button>
              {recording && <span className="dm-note">録音を終了してから作成してください。</span>}
            </div>
          </section>

          {/* ---------- 3. 確認・保存 ---------- */}
          <section className="dm-step">
            <h2><span className="dm-num">3</span>内容を確認して保存</h2>
            {!draft && !generating ? (
              <p className="dm-hint">議事録を作成すると、ここに表示されます。そのまま手で直せます。</p>
            ) : (
              <>
                {generating && (
                  <div className="dm-work-line">
                    <span className="dm-spinner" aria-hidden="true" />
                    <span>
                      {draft ? '議事録を作成中…（下に書き出しています）' : 'AIが議事録を作成しています…'}
                    </span>
                  </div>
                )}
                <textarea
                  className="dm-draft"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="議事録を作成しています…"
                />
                <div className="dm-revise">
                  <input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="AIに直してほしいこと（例：決定事項3の担当を池田に）"
                    onKeyDown={(e) => {
                      // 日本語入力の変換確定でも Enter が来るため、単独の Enter では送らない。
                      // 他の画面と同じく ⌘/Ctrl + Enter で送信する。
                      // isComposing は変換中かどうか（変換中の確定キーを弾く）。
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
                  保存すると「■ 決定事項」が1件ずつ切り出され、全部門の決定事項一覧に載ります。
                  決まっていないことが決定事項に混ざっていないか、保存前にご確認ください。
                </p>
              </>
            )}
            {note && <p className="dm-note ok">{note}</p>}
            {warn && <p className="dm-note warn">{warn}</p>}
            {err && <p className="dm-note err">{err}</p>}
          </section>
        </div>

        {/* ---------- 右：保存済みの議事録・決定事項 ---------- */}
        <aside className="dm-side">
          <div className="dm-panel">
            <div className="dm-panel-head">
              <h2>保存済みの議事録</h2>
              <button className="dm-reload" onClick={() => void loadSaved()}>更新</button>
            </div>

            <div className="dm-panel-tabs">
              <button
                className={panelTab === 'meetings' ? 'active' : ''}
                onClick={() => setPanelTab('meetings')}
              >
                会議ごと{meetings.length > 0 && `（${meetings.length}）`}
              </button>
              <button
                className={panelTab === 'decisions' ? 'active' : ''}
                onClick={() => setPanelTab('decisions')}
              >
                決定事項{decisions.length > 0 && `（${decisions.length}）`}
              </button>
            </div>

            {campusesInList.length > 0 && (
              <select className="dm-filter" value={decFilter} onChange={(e) => setDecFilter(e.target.value)}>
                <option value="">すべての部門</option>
                {campusesInList.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}

            {/* 会議ごと：日付・会議名・議題が見え、［詳細］で議事録全体を開く */}
            {panelTab === 'meetings' && (
              shownMeetings.length === 0 ? (
                <p className="dm-empty">
                  まだ保存された議事録はありません。議事録を保存すると、ここに全部門分が会議ごとに並びます。
                </p>
              ) : (
                <ul className="dm-meet-list">
                  {shownMeetings.slice(0, 40).map((m, i) => {
                    const agenda = summarizeSection(extractSection(m.minutes, '議題') || m.agenda, 3);
                    const decCount = extractDecisions(m.minutes).length;
                    return (
                      <li key={`${m.ts}-${i}`}>
                        <div className="dm-meet-head">
                          <span className="dm-meet-date">{fmtDate(m.date || m.ts)}</span>
                          <span className="dm-dec-campus">{m.campus}</span>
                        </div>
                        <div className="dm-meet-title">{m.title || '（会議名なし）'}</div>
                        {agenda.length > 0 && (
                          <ul className="dm-meet-agenda">
                            {agenda.map((a, k) => <li key={k}>{a}</li>)}
                          </ul>
                        )}
                        <div className="dm-meet-foot">
                          <span className="dm-meet-count">
                            決定 {decCount} 件{m.user && ` ／ ${m.user}`}
                          </span>
                          <button className="dm-detail" onClick={() => setOpenMeeting(m)}>詳細</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            )}

            {/* 決定事項：部門をまたいだ決め事を1件ずつ並べる */}
            {panelTab === 'decisions' && (
              shownDecisions.length === 0 ? (
                <p className="dm-empty">
                  まだ登録された決定事項はありません。議事録を保存すると、ここに全部門分が並びます。
                </p>
              ) : (
                <ul className="dm-dec-list">
                  {shownDecisions.slice(0, 40).map((d, i) => (
                    <li key={`${d.ts}-${i}`}>
                      <div className="dm-dec-head">
                        <span className="dm-dec-campus">{d.campus}</span>
                        <span className="dm-dec-date">{fmtDate(d.date || d.ts)}</span>
                      </div>
                      <div className="dm-dec-title">{d.title || d.detail}</div>
                      {d.detail && d.title && <p className="dm-dec-detail">{d.detail}</p>}
                      <div className="dm-dec-meta">
                        {d.owner && <span>担当：{d.owner}</span>}
                        {d.due && <span>期限：{d.due}</span>}
                        {d.related && <span>関係：{d.related}</span>}
                      </div>
                      {d.meeting && <div className="dm-dec-from">{d.meeting}</div>}
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>

          <div className="dm-panel">
            <div className="dm-panel-head">
              <h2>議事録テンプレート</h2>
              <button className="dm-reload" onClick={() => setShowTemplate((v) => !v)}>
                {showTemplate ? '閉じる' : '見る'}
              </button>
            </div>
            {showTemplate ? (
              <ol className="dm-tpl">
                {templateOutline().map((t) => (
                  <li key={t.heading}>
                    <b>{t.heading}</b>
                    <span>{t.guide}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="dm-empty">
                AIはこのテンプレートに沿って議事録を作り、沿わなかった点を「会議の質チェック」として指摘します。
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* 議事録の詳細（ポップアップ）。ダッシュボードと同じ部品を使う。 */}
      {openMeeting && (
        <MinutesDetail
          row={openMeeting}
          onClose={() => setOpenMeeting(null)}
          onEdit={() => startEdit(openMeeting)}
        />
      )}
    </div>
  );
}
