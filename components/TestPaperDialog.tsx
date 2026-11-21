'use client';
// 智翔館AI：中学校のテスト問題（定期テスト・実力テスト・入試問題）を保存する小窓（チャットの［🗄 テスト問題を保存］で開く）。
// - 種類をプルダウンで選ぶ。定期テスト・実力テストは「年度・実施回（1〜4）・中学校・学年・科目」、入試問題は「年度・科目・公立／私立（私立は学校名）」。
//   中学校は表記の揺れを無くすため、決めた一覧（lib/chishokanAi/testPapers.ts の SCHOOL_GROUPS）から選ぶ。
// - ファイルは複数付けられる（PDF・画像・Word。1つ3MBまで。画像は長辺2400pxの JPEG に縮めて送る）。
//   1つずつ送って保存し（アプリが1回に受け取れる大きさに上限があるため）、全部送れたら1件として記録する。
//   途中で失敗したら、送れた分は残して、もう一度押せば残りだけ送る。保存をやめたら、記録しなかったファイルは消す（ゴミ箱へ）。
// API は app/api/chishokan-ai/test-papers。保存先はドライブ「15_AI利用データ/中学校テスト問題/<種類>」。

import { useCallback, useEffect, useRef, useState } from 'react';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { imageToBase64 } from '@/lib/chishokanAi/clientImage';
import {
  ENTRANCE_TYPES,
  OTHER_SCHOOL,
  SCHOOL_GROUPS,
  TEST_FILE_MAX_BYTES,
  TEST_FILE_MAX_CHARS,
  TEST_GRADES,
  TEST_KINDS,
  TEST_MAX_FILES,
  TEST_ROUNDS,
  TEST_SUBJECTS,
  checkMeta,
  currentSchoolYear,
  testLabel,
  type SavedFile,
  type TestMeta,
} from '@/lib/chishokanAi/testPapers';

type Picked = { key: string; file: File; status: 'wait' | 'sending' | 'done' | 'error'; saved?: SavedFile; savedFor?: string; error?: string };
type Form = {
  kind: string;
  year: string;
  round: string;
  school: string;
  otherSchool: string;
  grade: string;
  subject: string;
  entranceType: string;
  privateSchool: string;
  memo: string;
};

const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,application/pdf,image/*';
const reiwa = (y: number) => (y >= 2019 ? `令和${y - 2018 === 1 ? '元' : y - 2018}年度` : `平成${y - 1988}年度`);
const sizeLabel = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1000))}KB`);

function emptyForm(): Form {
  return { kind: '', year: String(currentSchoolYear()), round: '', school: '', otherSchool: '', grade: '', subject: '', entranceType: '', privateSchool: '', memo: '' };
}

function toMetaInput(f: Form) {
  return f.kind === '入試問題'
    ? { kind: f.kind, year: Number(f.year), subject: f.subject, entranceType: f.entranceType, school: f.privateSchool, memo: f.memo }
    : { kind: f.kind, year: Number(f.year), round: Number(f.round), school: f.school, otherSchool: f.otherSchool, grade: f.grade, subject: f.subject, memo: f.memo };
}

/** ファイル名・メタ情報が変わったら作り直すための印（保存したファイルの名前に、種類・学校などが入るため） */
const metaKey = (m: TestMeta) => JSON.stringify([m.kind, m.year, m.school, m.entranceType, m.grade, m.subject, m.round]);

async function readBase64(file: File): Promise<string> {
  const url: string = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  return url.split(',')[1] ?? '';
}

/** 送る形にする。画像は JPEG に縮める（大きければもう一段）。 */
async function prepare(file: File): Promise<{ name: string; mime: string; data: string }> {
  const type = (file.type || '').toLowerCase();
  const isImage = type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(file.name);
  if (isImage) {
    let img = await imageToBase64(file, 2400, 0.85);
    if (img.data.length > TEST_FILE_MAX_CHARS) img = await imageToBase64(file, 1800, 0.75);
    return { name: file.name, mime: img.mime, data: img.data };
  }
  const mime = type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'application/pdf' : WORD;
  return { name: file.name, mime, data: await readBase64(file) };
}

/** 付けられるファイルか（種類・大きさ）。だめなら理由。 */
function fileProblem(file: File): string {
  const type = (file.type || '').toLowerCase();
  const isImage = type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(file.name);
  const isPdf = type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isWord = type === WORD || /\.docx$/i.test(file.name);
  if (!isImage && !isPdf && !isWord) return `${file.name}：PDF・画像・Word（.docx）だけ付けられます。`;
  if (!isImage && file.size > TEST_FILE_MAX_BYTES) return `${file.name}：大きすぎます（${sizeLabel(file.size)}。1つ3MBまで）。ページを分けて付けてください。`;
  return '';
}

export default function TestPaperDialog({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [check, setCheck] = useState<{ state: 'loading' | 'ready' | 'blocked'; message?: string; privateSchools: string[] }>({ state: 'loading', privateSchools: [] });
  const [form, setForm] = useState<Form>(emptyForm);
  const [picks, setPicks] = useState<Picked[]>([]);
  const [state, setState] = useState<'edit' | 'saving' | 'done'>('edit');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [done, setDone] = useState<{ label: string; files: SavedFile[] } | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const picksRef = useRef<Picked[]>([]);
  picksRef.current = picks;
  const doneRef = useRef(false);

  // 記録しなかったファイル（送れたが1件として記録していない）を消す
  const discard = useCallback((ids: string[]) => {
    const clean = ids.filter(Boolean);
    if (!clean.length) return;
    void fetch('/api/chishokan-ai/test-papers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'discard', ids: clean }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  const close = useCallback(() => {
    if (state === 'saving') return;
    if (!doneRef.current) discard(picksRef.current.map((p) => p.saved?.id ?? ''));
    onClose();
  }, [discard, onClose, state]);
  useModalDismiss(close);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/chishokan-ai/test-papers', { cache: 'no-store' });
        const j = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.ok && j?.ok && j.ready) setCheck({ state: 'ready', privateSchools: Array.isArray(j.privateSchools) ? j.privateSchools : [] });
        else setCheck({ state: 'blocked', message: String(j?.message || '保存先につながりませんでした。時間をおいて開き直してください。'), privateSchools: [] });
      } catch {
        if (alive) setCheck({ state: 'blocked', message: '通信に失敗しました。閉じてもう一度開いてください。', privateSchools: [] });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    setError('');
  };

  function addFiles(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const problems: string[] = [];
    const next = [...picks];
    for (const file of files) {
      if (next.length >= TEST_MAX_FILES) {
        problems.push(`ファイルは1件に${TEST_MAX_FILES}個までです（続きは別の1件として保存してください）。`);
        break;
      }
      const p = fileProblem(file);
      if (p) {
        problems.push(p);
        continue;
      }
      if (next.some((x) => x.file.name === file.name && x.file.size === file.size)) continue;
      next.push({ key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`, file, status: 'wait' });
    }
    setPicks(next);
    setError(problems.join('\n'));
  }

  function removePick(key: string) {
    const p = picks.find((x) => x.key === key);
    if (p?.saved) discard([p.saved.id]);
    setPicks((list) => list.filter((x) => x.key !== key));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === 'saving') return;
    const m = checkMeta(toMetaInput(form));
    if (!m.ok) return setError(m.message);
    if (!picks.length) return setError('ファイルを付けてください（問題用紙・解答の PDF や写真）。');
    const meta = m.value;
    const key = metaKey(meta);
    setState('saving');
    setError('');

    // 種類・学校などを変えたあとに保存し直すときは、前に送った分を消して送り直す（ファイル名に入っているため）
    const stale = picks.filter((p) => p.saved && p.savedFor !== key);
    if (stale.length) discard(stale.map((p) => p.saved!.id));
    let list: Picked[] = picks.map((p) => (p.saved && p.savedFor !== key ? { ...p, status: 'wait', saved: undefined, savedFor: undefined } : p));
    setPicks(list);

    const update = (k: string, patch: Partial<Picked>) => {
      list = list.map((p) => (p.key === k ? { ...p, ...patch } : p));
      setPicks(list);
    };

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.saved) continue;
      setProgress(`ファイルを送っています（${i + 1}／${list.length}）…`);
      update(p.key, { status: 'sending', error: undefined });
      try {
        const file = await prepare(p.file);
        if (file.data.length > TEST_FILE_MAX_CHARS) {
          update(p.key, { status: 'error', error: '大きすぎます（1つ3MBまで）' });
          continue;
        }
        const res = await fetch('/api/chishokan-ai/test-papers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: 'file', meta: toMetaInput(form), file, index: i }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j?.ok && j.file) update(p.key, { status: 'done', saved: j.file as SavedFile, savedFor: key });
        else {
          update(p.key, { status: 'error', error: String(j?.message || (res.status === 413 ? '大きすぎます（1つ3MBまで）' : '保存できませんでした')) });
          if (j?.notDeployed) break;
        }
      } catch {
        update(p.key, { status: 'error', error: 'このファイルを読めないか、通信に失敗しました' });
      }
    }

    const failed = list.filter((p) => !p.saved);
    if (failed.length) {
      setProgress('');
      setError(`${failed.length}個のファイルを保存できませんでした。［保存する］をもう一度押すと、残りだけ送ります（消すときは × で外してください）。`);
      setState('edit');
      return;
    }

    setProgress('1件として記録しています…');
    try {
      const res = await fetch('/api/chishokan-ai/test-papers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'entry', meta: toMetaInput(form), files: list.map((p) => p.saved), conversationId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        doneRef.current = true;
        setDone({ label: String(j.label || testLabel(meta)), files: (Array.isArray(j.files) ? j.files : []) as SavedFile[] });
        setState('done');
        setProgress('');
        return;
      }
      setError(String(j?.message || '記録できませんでした。もう一度押してください。'));
    } catch {
      setError('通信に失敗しました。もう一度押してください（送ったファイルはそのまま使います）。');
    }
    setProgress('');
    setState('edit');
  }

  // 続けて保存する：種類・年度・学校・学年はそのまま、科目・実施回・メモ・ファイルを空にする
  function again() {
    doneRef.current = false;
    setDone(null);
    setPicks([]);
    setForm((f) => ({ ...f, subject: '', round: '', memo: '' }));
    setError('');
    setState('edit');
  }

  const saving = state === 'saving';
  const isEntrance = form.kind === '入試問題';
  const nowYear = currentSchoolYear();
  const years = Array.from({ length: 12 }, (_, i) => nowYear + 1 - i);

  return (
    <div className="dm-modal-bg" onClick={close}>
      <div className="dm-modal ai-report ai-preshare-modal tp-modal" role="dialog" aria-modal="true" aria-label="テスト問題を保存" onClick={(e) => e.stopPropagation()}>
        <div className="dm-modal-head">
          <div>
            <h2>🗄 テスト問題を保存</h2>
            <div className="dm-modal-sub">中学校の定期テスト・実力テスト・入試問題を、種類ごとのフォルダに保存します。保存したものは智翔館AIで探せます。</div>
          </div>
          <button className="dm-modal-close" onClick={close} aria-label="閉じる" disabled={saving}>×</button>
        </div>

        {check.state === 'loading' && <div className="dm-modal-body">保存先を確かめています…</div>}
        {check.state === 'blocked' && (
          <div className="dm-modal-body">
            <p className="ai-report-error">{check.message}</p>
          </div>
        )}

        {check.state === 'ready' && state === 'done' && done && (
          <div className="dm-modal-body">
            <p className="ai-report-done">✅ 保存しました：{done.label}</p>
            <ul className="tp-saved">
              {done.files.map((f) => (
                <li key={f.id}>
                  <a href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
                </li>
              ))}
            </ul>
            <p className="ai-report-note">チャットで「{isEntrance ? `${form.year}年度の${form.entranceType}入試の${form.subject}` : `${shortSchool(form.school === OTHER_SCHOOL ? form.otherSchool : form.school)}の${form.grade}${form.subject}の第${form.round}回${form.kind}`}を出して」のように聞くと探せます。</p>
            <div className="ai-report-actions">
              <button type="button" className="msg-action" onClick={again}>続けて保存する</button>
              <button type="button" className="ai-report-submit" onClick={onClose}>閉じる</button>
            </div>
          </div>
        )}

        {check.state === 'ready' && state !== 'done' && (
          <form className="dm-modal-body ai-report-form" onSubmit={submit}>
            <label className="ai-report-field">
              <span>種類<span className="req">必須</span></span>
              <select value={form.kind} onChange={set('kind')} disabled={saving}>
                <option value="">選んでください</option>
                {TEST_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>

            {form.kind && (
              <div className="tp-grid">
                <label className="ai-report-field">
                  <span>年度<span className="req">必須</span></span>
                  <select value={form.year} onChange={set('year')} disabled={saving}>
                    {years.map((y) => (
                      <option key={y} value={y}>{y}年度（{reiwa(y)}）</option>
                    ))}
                  </select>
                  <small className="ai-report-note">{isEntrance ? '問題に書かれた年度（令和8年度入試 → 2026年度）' : '4月始まり（1〜3月のテストは前の年度）'}</small>
                </label>

                {!isEntrance && (
                  <label className="ai-report-field">
                    <span>実施回<span className="req">必須</span></span>
                    <select value={form.round} onChange={set('round')} disabled={saving}>
                      <option value="">選んでください</option>
                      {TEST_ROUNDS.map((r) => (
                        <option key={r} value={r}>第{r}回</option>
                      ))}
                    </select>
                  </label>
                )}

                {!isEntrance && (
                  <label className="ai-report-field tp-wide">
                    <span>中学校<span className="req">必須</span></span>
                    <select value={form.school} onChange={set('school')} disabled={saving}>
                      <option value="">選んでください</option>
                      {SCHOOL_GROUPS.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.schools.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </optgroup>
                      ))}
                      <option value={OTHER_SCHOOL}>一覧に無い学校（名前を入れる）</option>
                    </select>
                  </label>
                )}
                {!isEntrance && form.school === OTHER_SCHOOL && (
                  <label className="ai-report-field tp-wide">
                    <span>学校名<span className="req">必須</span></span>
                    <input value={form.otherSchool} onChange={set('otherSchool')} maxLength={40} placeholder="例：佐々町立佐々中学校（「〇〇市立〇〇中学校」の正式な名前で）" disabled={saving} />
                    <small className="ai-report-note">一覧に足したい学校は「要望を送る」で知らせてください（次から選べるようにします）。</small>
                  </label>
                )}

                {!isEntrance && (
                  <label className="ai-report-field">
                    <span>学年<span className="req">必須</span></span>
                    <select value={form.grade} onChange={set('grade')} disabled={saving}>
                      <option value="">選んでください</option>
                      {TEST_GRADES.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="ai-report-field">
                  <span>科目<span className="req">必須</span></span>
                  <select value={form.subject} onChange={set('subject')} disabled={saving}>
                    <option value="">選んでください</option>
                    {TEST_SUBJECTS.map((s) => (
                      <option key={s} value={s}>{s === '5教科' ? '5教科（まとめて1つ）' : s}</option>
                    ))}
                  </select>
                </label>

                {isEntrance && (
                  <fieldset className="ai-report-field">
                    <legend>公立・私立<span className="req">必須</span></legend>
                    <div className="ai-report-kinds">
                      {ENTRANCE_TYPES.map((t) => (
                        <label key={t} className={form.entranceType === t ? 'on' : ''}>
                          <input type="radio" name="tp-entrance" value={t} checked={form.entranceType === t} onChange={set('entranceType')} disabled={saving} />
                          {t === '公立' ? '公立（長崎県公立高校）' : '私立'}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                {isEntrance && form.entranceType === '私立' && (
                  <label className="ai-report-field tp-wide">
                    <span>学校名<span className="req">必須</span></span>
                    <input value={form.privateSchool} onChange={set('privateSchool')} maxLength={40} list="tp-private-schools" placeholder="例：九州文化学園高等学校（正式な名前で）" disabled={saving} />
                    {check.privateSchools.length > 0 && (
                      <datalist id="tp-private-schools">
                        {check.privateSchools.map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    )}
                  </label>
                )}
              </div>
            )}

            {form.kind && (
              <>
                <div className="ai-report-field">
                  <span>ファイル<span className="req">必須</span></span>
                  <div
                    className={`tp-drop${drag ? ' on' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDrag(true);
                    }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDrag(false);
                      if (!saving) addFiles(e.dataTransfer.files);
                    }}
                  >
                    <button type="button" className="msg-action" onClick={() => fileRef.current?.click()} disabled={saving || picks.length >= TEST_MAX_FILES}>
                      📎 ファイルを選ぶ（複数可）
                    </button>
                    <span className="ai-report-note">ここに落としても付けられます。PDF・写真（JPEG・PNG）・Word、1つ3MBまで・{TEST_MAX_FILES}個まで</span>
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      accept={ACCEPT}
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        addFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </div>
                  {picks.length > 0 && (
                    <ul className="tp-files">
                      {picks.map((p) => (
                        <li key={p.key} className={`tp-file tp-${p.status}`}>
                          <span className="tp-file-name">{p.file.name}</span>
                          <span className="tp-file-size">{sizeLabel(p.file.size)}</span>
                          <span className="tp-file-state">
                            {p.status === 'sending' ? '送っています…' : p.status === 'done' ? '✅ 送りました' : p.status === 'error' ? `⚠ ${p.error}` : ''}
                          </span>
                          <button type="button" className="tp-file-remove" onClick={() => removePick(p.key)} disabled={saving} aria-label={`${p.file.name} を外す`}>×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <label className="ai-report-field">
                  <span>メモ（任意）</span>
                  <textarea value={form.memo} onChange={set('memo')} rows={2} maxLength={300} placeholder="例：範囲は一次関数・連立方程式。大問5が難しい。" disabled={saving} />
                </label>
                <p className="ai-report-note">生徒の名前・点数のある答案は保存しないでください（白紙の問題用紙・解答・解説だけ）。共有の設定はフォルダのままです。</p>
              </>
            )}

            {error && <div className="ai-report-error tp-error">{error}</div>}
            {progress && <div className="ai-report-note">{progress}</div>}
            <div className="ai-report-actions">
              <button type="button" className="msg-action" onClick={close} disabled={saving}>やめる</button>
              <button type="submit" className="ai-report-submit" disabled={saving || !form.kind}>
                {saving ? '保存しています…' : '保存する'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** 学校名の短い形（「佐世保市立日宇中学校」→「日宇中」）。案内の文だけに使う。 */
function shortSchool(name: string): string {
  return String(name || '学校').replace(/^.*?(市立|町立|県立)/, '').replace(/(小中学校|中学校)$/, (m) => (m === '小中学校' ? '小中' : '中'));
}
