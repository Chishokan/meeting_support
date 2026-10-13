'use client';

// つきいち改善（/kaizen）。提出する／投票する／一覧・結果 の3画面。
// 判定（何月に出せるか・誰が直せるか・得票を見せてよいか）はサーバ（app/api/kaizen）が lib/kaizen/model.ts で済ませて返す。

import { useEffect, useMemo, useRef, useState } from 'react';
import { downscaleToDataUrl } from '@/lib/downscaleImage';
import {
  KAIZEN_CAMPUSES,
  LIMITS,
  MAX_VOTES,
  addMonths,
  campusLabel,
  monthLabel,
  photoThumbUrl,
  shortMonthLabel,
  voteDeadlineLabel,
  type KaizenItemView,
  type KaizenView,
  type MonthView,
} from '@/lib/kaizen/model';

type Tab = 'submit' | 'vote' | 'results';
type ApiView = KaizenView & { ok: true; backend: 'sheet' | 'local' };

type PhotoState = { kind: 'keep'; urls: string[] } | { kind: 'new'; dataUrl: string } | { kind: 'none' };
type Draft = {
  id: string | null;
  month: string;
  members: string[];
  campus: string;
  title: string;
  before: string;
  after: string;
  beforePhoto: PhotoState;
  afterPhoto: PhotoState;
};

const CAMPUS_KEY = 'kaizen.campus';

function reasonText(reason?: string, message?: string): string {
  if (message) return message;
  switch (reason) {
    case 'not_configured':
      return '保存先（Apps Script）が未設定です。管理者に連絡してください。';
    case 'apps_script_outdated':
      return 'Apps Script が古いままです（管理者の方へ：apps_script/Code.gs を貼り替えて「新バージョン」でデプロイし直してください）。';
    case 'unauthorized':
      return 'ログインが切れました。画面を読み込み直してください。';
    case 'network_error':
    case 'upstream_error':
      return '保存先とつながりませんでした。少し待ってからやり直してください。';
    default:
      return `うまくいきませんでした（${reason || '理由不明'}）。`;
  }
}

function readCampus(): string {
  try {
    return localStorage.getItem(CAMPUS_KEY) || '';
  } catch {
    return '';
  }
}

function rememberCampus(c: string) {
  try {
    localStorage.setItem(CAMPUS_KEY, c);
  } catch {}
}

function emptyDraft(name: string, month: string, campus: string): Draft {
  return {
    id: null, month, members: [name], campus, title: '', before: '', after: '',
    beforePhoto: { kind: 'none' }, afterPhoto: { kind: 'none' },
  };
}

function photoPayload(p: PhotoState, editing: boolean) {
  if (p.kind === 'new') return { data: p.dataUrl.split(',')[1] ?? '', mime: 'image/jpeg', name: 'photo.jpg' };
  if (p.kind === 'none' && editing) return 'remove';
  return 'keep';
}

function stateText(m: MonthView): string {
  if (m.state === 'collecting') return '提出受付中';
  if (m.state === 'open') return '投票受付中';
  return '投票締め切り';
}

function stateNote(m: MonthView): string {
  if (m.state === 'collecting') return `投票は${shortMonthLabel(addMonths(m.month, 1))}`;
  if (m.state === 'open') return `締め切り ${voteDeadlineLabel(m.month)}`;
  return m.closedBy ? `${m.closedBy} が締め切り` : '月末で締め切り';
}

// ---- 写真 ------------------------------------------------------------------

function Photo({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const isData = url.startsWith('data:');
  if (failed) {
    return (
      <a className="kz-photo-link" href={url} target="_blank" rel="noreferrer">写真を開く</a>
    );
  }
  return (
    <a className="kz-photo" href={isData ? undefined : url} target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photoThumbUrl(url)} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    </a>
  );
}

function ClampText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 110 || text.split('\n').length > 4;
  return (
    <>
      <p className={`kz-text ${long && !open ? 'clamp' : ''}`}>{text}</p>
      {long && (
        <button type="button" className="kz-more" onClick={() => setOpen((v) => !v)}>
          {open ? '閉じる' : '続きを読む'}
        </button>
      )}
    </>
  );
}

// ---- 改善カード ---------------------------------------------------------------

function KaizenCard({
  item,
  votes,
  rank,
  award,
  selected,
  children,
}: {
  item: KaizenItemView;
  votes?: number;
  rank?: number;
  award?: boolean;
  selected?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <article className={`kz-card ${selected ? 'selected' : ''} ${award ? 'award' : ''}`}>
      <div className="kz-card-head">
        {rank != null && <span className="kz-rank">{rank}位</span>}
        <span className="kz-campus">{campusLabel(item.campus)}</span>
        {award && <span className="kz-award">優秀賞</span>}
        {item.mine && <span className="kz-mine">自分の改善</span>}
        {votes != null && <span className="kz-votes">{votes}票</span>}
      </div>
      <h3 className="kz-title">{item.title}</h3>
      <div className="kz-members">{item.members.join('・')}</div>
      <div className="kz-ba">
        <section className="kz-side before">
          <div className="kz-side-label">Before（改善前）</div>
          {item.beforePhotos.map((u) => <Photo key={u} url={u} alt={`${item.title} の改善前`} />)}
          <ClampText text={item.before} />
        </section>
        <section className="kz-side after">
          <div className="kz-side-label">After（改善後）</div>
          {item.afterPhotos.map((u) => <Photo key={u} url={u} alt={`${item.title} の改善後`} />)}
          <ClampText text={item.after} />
        </section>
      </div>
      {children}
    </article>
  );
}

// ---- 提出する -----------------------------------------------------------------

function PhotoField({ label, value, onChange }: { label: string; value: PhotoState; onChange: (p: PhotoState) => void }) {
  const [err, setErr] = useState('');
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // 同じ写真を選び直しても反応するように
    if (!f) return;
    setErr('');
    try {
      onChange({ kind: 'new', dataUrl: await downscaleToDataUrl(f) });
    } catch {
      setErr('この写真は読み込めませんでした。別の写真で試してください。');
    }
  }
  return (
    <div className="kz-photo-field">
      <label>{label}（任意）</label>
      {value.kind === 'new' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="kz-preview" src={value.dataUrl} alt={`${label}のプレビュー`} />
      )}
      {value.kind === 'keep' && value.urls.map((u) => <Photo key={u} url={u} alt={label} />)}
      <div className="kz-photo-actions">
        <label className="kz-file">
          {value.kind === 'none' ? '写真を選ぶ' : '写真を変える'}
          <input type="file" accept="image/*" onChange={onFile} />
        </label>
        {value.kind !== 'none' && (
          <button type="button" className="kz-link-btn danger" onClick={() => onChange({ kind: 'none' })}>写真を外す</button>
        )}
      </div>
      {err && <div className="kz-err">{err}</div>}
    </div>
  );
}

function SubmitTab({ view, name, onChanged }: { view: ApiView; name: string; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(name, view.currentMonth, readCampus()));
  const [person, setPerson] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const mine = view.items.filter((k) => k.mine);
  const editing = draft.id !== null;
  // 直している改善の月は、提出できる月でなくても選べる（管理部門が締め切った月を直すとき）
  const monthOptions = editing && !view.submittableMonths.includes(draft.month)
    ? [draft.month, ...view.submittableMonths]
    : view.submittableMonths;

  function set<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    setMsg((m) => (m && !m.ok ? null : m)); // 直し始めたら前のエラーは消す
  }

  function addPerson() {
    const n = person.trim();
    if (!n) return;
    if (!draft.members.includes(n) && draft.members.length < LIMITS.members) set('members', [...draft.members, n]);
    setPerson('');
  }

  function startEdit(k: KaizenItemView) {
    setDraft({
      id: k.id, month: k.month, members: [...k.members], campus: k.campus, title: k.title, before: k.before, after: k.after,
      beforePhoto: k.beforePhotos.length ? { kind: 'keep', urls: k.beforePhotos } : { kind: 'none' },
      afterPhoto: k.afterPhotos.length ? { kind: 'keep', urls: k.afterPhotos } : { kind: 'none' },
    });
    setMsg(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelEdit() {
    setDraft(emptyDraft(name, view.currentMonth, draft.campus));
    setMsg(null);
  }

  async function submit() {
    if (busy) return;
    const missing = !draft.members.length ? '提出者を入れてください。'
      : !draft.campus ? '校舎を選んでください。'
      : !draft.title.trim() ? '改善タイトルを入れてください。'
      : !draft.before.trim() ? 'Before（改善前）を入れてください。'
      : !draft.after.trim() ? 'After（改善後）を入れてください。' : '';
    if (missing) {
      setMsg({ ok: false, text: missing });
      return;
    }
    const photos = { before: photoPayload(draft.beforePhoto, editing), after: photoPayload(draft.afterPhoto, editing) };
    const size = JSON.stringify(photos).length;
    if (size > 4_000_000) {
      setMsg({ ok: false, text: '写真が大きすぎます。1枚ずつ外して試すか、別の写真にしてください。' });
      return;
    }
    setBusy(true);
    setMsg({ ok: true, text: editing ? '保存しています…' : '提出しています…（写真があると少しかかります）' });
    try {
      const res = await fetch('/api/kaizen', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draft.id ?? undefined, month: draft.month, members: draft.members, campus: draft.campus,
          title: draft.title, before: draft.before, after: draft.after, photos,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        rememberCampus(draft.campus);
        setMsg({ ok: true, text: editing ? '保存しました。' : `${monthLabel(draft.month)}分として提出しました。ありがとうございます！` });
        setDraft(emptyDraft(name, view.currentMonth, draft.campus));
        await onChanged();
      } else {
        setMsg({ ok: false, text: reasonText(j?.reason, j?.message) });
      }
    } catch {
      setMsg({ ok: false, text: reasonText('network_error') });
    } finally {
      setBusy(false);
    }
  }

  async function remove(k: KaizenItemView) {
    if (!confirm(`「${k.title}」を消しますか？（入っていた票も数えなくなります）`)) return;
    try {
      const res = await fetch(`/api/kaizen?id=${encodeURIComponent(k.id)}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        if (draft.id === k.id) cancelEdit();
        await onChanged();
      } else {
        alert(reasonText(j?.reason, j?.message));
      }
    } catch {
      alert(reasonText('network_error'));
    }
  }

  return (
    <div className="kz-submit">
      <div className={`kz-form ${editing ? 'editing' : ''}`} ref={formRef}>
        <h2>{editing ? '改善を直す' : '今月の改善を提出する'}</h2>

        {monthOptions.length > 1 ? (
          <>
            <label>どの月の改善か</label>
            <div className="kz-month-pick">
              {monthOptions.map((m) => (
                <button key={m} type="button" className={`kz-pill ${draft.month === m ? 'active' : ''}`} onClick={() => set('month', m)}>
                  {monthLabel(m)}分{m === view.votingMonth && !editing ? '（出し忘れ）' : ''}
                </button>
              ))}
            </div>
            {draft.month === view.votingMonth && draft.month !== view.currentMonth && (
              <p className="kz-hint">先月分は投票の途中から候補に加わります（投票の締め切りまで）。</p>
            )}
          </>
        ) : (
          <p className="kz-hint">{monthLabel(draft.month)}分として提出します。</p>
        )}

        <label>提出者（一緒に取り組んだ人も入れる）</label>
        <div className="kz-chips">
          {draft.members.map((m) => (
            <span key={m} className="kz-chip">
              {m}
              <button type="button" aria-label={`${m} を外す`} onClick={() => set('members', draft.members.filter((x) => x !== m))}>×</button>
            </span>
          ))}
        </div>
        <div className="kz-add-person">
          <input
            list="kz-people"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addPerson();
              }
            }}
            placeholder="名前を入れて「追加」"
          />
          <datalist id="kz-people">
            {view.people.filter((p) => !draft.members.includes(p)).map((p) => <option key={p} value={p} />)}
          </datalist>
          <button type="button" onClick={addPerson} disabled={!person.trim()}>追加</button>
        </div>

        <label>校舎</label>
        <select value={draft.campus} onChange={(e) => set('campus', e.target.value)}>
          <option value="">選んでください</option>
          {KAIZEN_CAMPUSES.map((c) => <option key={c} value={c}>{campusLabel(c)}</option>)}
        </select>

        <label>改善タイトル</label>
        <input
          value={draft.title}
          maxLength={LIMITS.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="例：おはよう勉強会リフレクション集"
        />

        <label>Before（改善前）</label>
        <textarea
          value={draft.before}
          maxLength={LIMITS.text}
          onChange={(e) => set('before', e.target.value)}
          placeholder="改善する前はどうだったか。困っていたこと・手間だったこと"
        />
        <PhotoField label="Beforeの写真" value={draft.beforePhoto} onChange={(p) => set('beforePhoto', p)} />

        <label>After（改善後）</label>
        <textarea
          value={draft.after}
          maxLength={LIMITS.text}
          onChange={(e) => set('after', e.target.value)}
          placeholder="何をどう変えたか。その結果どうなったか（件数・時間などの数字があれば）"
        />
        <PhotoField label="Afterの写真" value={draft.afterPhoto} onChange={(p) => set('afterPhoto', p)} />

        <p className="kz-hint">
          写真は、リンクを知っている人なら見られる形で保存されます。生徒の顔・氏名・成績が写っていないか確かめてください。
        </p>

        <div className="kz-actions">
          <button className="kz-primary" onClick={submit} disabled={busy}>
            {busy ? '送っています…' : editing ? '保存する' : '提出する'}
          </button>
          {editing && <button className="kz-secondary" onClick={cancelEdit} disabled={busy}>やめる</button>}
          {msg && <span className={`kz-msg ${msg.ok ? 'ok' : 'ng'}`}>{msg.text}</span>}
        </div>
      </div>

      <div className="kz-mylist">
        <h2>自分の提出</h2>
        {mine.length === 0 ? (
          <p className="kz-empty">まだ提出はありません。</p>
        ) : (
          <ul>
            {mine.map((k) => (
              <li key={k.id} className={draft.id === k.id ? 'editing' : ''}>
                <div className="kz-mylist-top">
                  <span className="kz-month-tag">{monthLabel(k.month)}分</span>
                  <span className="kz-mylist-meta">{campusLabel(k.campus)}・{k.submittedAt.slice(5, 10)}</span>
                </div>
                <div className="kz-mylist-title">{k.title}</div>
                {k.members.length > 1 && <div className="kz-mylist-meta">{k.members.join('・')}</div>}
                {k.canEdit && (
                  <div className="kz-mylist-actions">
                    <button type="button" className="kz-link-btn" onClick={() => startEdit(k)}>直す</button>
                    <button type="button" className="kz-link-btn danger" onClick={() => remove(k)}>消す</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---- 投票する -----------------------------------------------------------------

function VoteTab({ view, name, onChanged, goResults }: { view: ApiView; name: string; onChanged: () => Promise<void>; goResults: () => void }) {
  const month = view.votingMonth;
  const mv = view.months.find((m) => m.month === month);
  const candidates = useMemo(
    () => view.items.filter((k) => k.month === month).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)),
    [view.items, month],
  );
  const saved = mv?.myVote ?? [];
  const [selected, setSelected] = useState<string[]>(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const savedKey = saved.join(',');
  useEffect(() => setSelected(savedKey ? savedKey.split(',') : []), [savedKey]);

  if (!mv) return null;
  const open = mv.state === 'open';
  const changed = [...selected].sort().join(',') !== [...saved].sort().join(',');

  function toggle(id: string) {
    setMsg(null);
    if (selected.includes(id)) {
      setSelected(selected.filter((x) => x !== id));
    } else if (selected.length >= MAX_VOTES) {
      setMsg({ ok: false, text: `選べるのは${MAX_VOTES}つまでです。ほかを外してから選んでください。` });
    } else {
      setSelected([...selected, id]);
    }
  }

  async function vote() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/kaizen/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, ids: selected }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setMsg({ ok: true, text: selected.length ? '投票しました。締め切りまでは入れ直せます。' : '投票を取り消しました。' });
        await onChanged();
      } else {
        setMsg({ ok: false, text: reasonText(j?.reason, j?.message) });
      }
    } catch {
      setMsg({ ok: false, text: reasonText('network_error') });
    } finally {
      setBusy(false);
    }
  }

  async function setClosed(closed: boolean) {
    const q = closed
      ? `${monthLabel(month)}分の投票を締め切りますか？\n締め切ると、得票と優秀賞が全員に見えるようになります。`
      : `${monthLabel(month)}分の投票の受付を再開しますか？\n再開すると、締め切るまで得票は管理部門にしか見えなくなります。`;
    if (!confirm(q)) return;
    try {
      const res = await fetch('/api/kaizen/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, closed }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) await onChanged();
      else alert(reasonText(j?.reason, j?.message));
    } catch {
      alert(reasonText('network_error'));
    }
  }

  return (
    <div className="kz-vote">
      <div className={`kz-banner ${open ? '' : 'closed'}`}>
        {open ? (
          <>
            <b>{monthLabel(month)}分の改善（{candidates.length}件）</b>から、良いと思ったものを<b>{MAX_VOTES}つまで</b>選んで投票してください。
            締め切りは<b>{voteDeadlineLabel(month)}</b>です（全体会議の前に早めに締め切ることがあります）。自分の改善には投票できません。
          </>
        ) : (
          <>
            {monthLabel(month)}分の投票は締め切りました{mv.closedBy ? `（${mv.closedBy}）` : ''}。
            <button type="button" className="kz-link-btn" onClick={goResults}>結果を見る</button>
          </>
        )}
        {view.isAdmin && (
          <div className="kz-admin-row">
            <span>管理部門：投票 {mv.voterCount}人</span>
            {open ? (
              <button type="button" className="kz-secondary" onClick={() => setClosed(true)}>投票を締め切る</button>
            ) : (
              <button type="button" className="kz-secondary" onClick={() => setClosed(false)}>受付を再開する</button>
            )}
          </div>
        )}
      </div>

      {candidates.length === 0 ? (
        <p className="kz-empty pad">{monthLabel(month)}分の提出はありません。</p>
      ) : (
        <div className="kz-grid">
          {candidates.map((k) => {
            const on = selected.includes(k.id);
            return (
              <KaizenCard key={k.id} item={k} selected={on}>
                <div className="kz-card-foot">
                  {/* 投票できないのは提出者に名前がある改善だけ（代わりに入力しただけの改善には投票できる。サーバの checkVote と同じ） */}
                  {k.members.includes(name) ? (
                    <span className="kz-cannot">自分の改善には投票できません</span>
                  ) : (
                    <button type="button" className={`kz-pick ${on ? 'on' : ''}`} onClick={() => toggle(k.id)} disabled={!open} aria-pressed={on}>
                      {on ? '✓ 選んでいます' : 'これに投票'}
                    </button>
                  )}
                </div>
              </KaizenCard>
            );
          })}
        </div>
      )}

      {open && candidates.length > 0 && (
        <div className="kz-votebar">
          <div className="kz-votebar-inner">
            <span className="kz-count">
              選んだ数 <b>{selected.length}</b> / {MAX_VOTES}
              {mv.myVotedAt && !changed && <span className="kz-voted">投票済み（{mv.myVotedAt.slice(5)}）</span>}
            </span>
            {msg && <span className={`kz-msg ${msg.ok ? 'ok' : 'ng'}`}>{msg.text}</span>}
            <button className="kz-primary" onClick={vote} disabled={busy || !changed}>
              {busy ? '送っています…' : selected.length === 0 && saved.length ? '投票を取り消す' : saved.length ? '入れ直す' : '投票する'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- 一覧・結果 ---------------------------------------------------------------

function ResultsTab({ view, month, setMonth }: { view: ApiView; month: string; setMonth: (m: string) => void }) {
  const months = view.months.filter((m) => m.count > 0 || m.month === view.currentMonth || m.month === view.votingMonth);
  const mv = view.months.find((m) => m.month === month) ?? months[0];
  if (!mv) return null;
  const items = view.items.filter((k) => k.month === mv.month);
  const byId = new Map(items.map((k) => [k.id, k]));
  const ordered = mv.tally
    ? mv.tally.rows.map((r) => ({ item: byId.get(r.id)!, row: r })).filter((x) => x.item)
    : [...items].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)).map((item) => ({ item, row: null }));
  const awards = new Set(mv.tally?.awards ?? []);

  return (
    <div className="kz-results">
      <div className="kz-month-pick">
        {months.map((m) => (
          <button key={m.month} type="button" className={`kz-pill ${m.month === mv.month ? 'active' : ''}`} onClick={() => setMonth(m.month)}>
            {monthLabel(m.month)}
            <span className="kz-pill-n">{m.count}件</span>
          </button>
        ))}
      </div>

      <div className="kz-summary">
        <div className="kz-stat"><b>{mv.count}</b><span>提出</span></div>
        <div className="kz-stat"><b>{mv.state === 'collecting' ? '—' : mv.voterCount}</b><span>投票した人</span></div>
        <div className="kz-stat state"><b>{stateText(mv)}</b><span>{stateNote(mv)}</span></div>
      </div>

      {mv.tally && mv.state === 'open' && (
        <p className="kz-note admin">投票受付中のため、得票は管理部門にだけ見えています。締め切ると全員に公開されます。</p>
      )}
      {!mv.tally && mv.state === 'open' && (
        <p className="kz-note">得票と優秀賞は、投票の締め切り後に公開します。</p>
      )}
      {mv.state === 'collecting' && <p className="kz-note">今月の提出を受け付けています。来月、みんなで投票します。</p>}
      {mv.tally && mv.state === 'closed' && mv.voterCount === 0 && mv.count > 0 && (
        <p className="kz-note">この月の投票の記録はありません。</p>
      )}

      {mv.tally && mv.tally.awards.length > 0 && (
        <div className="kz-awards">
          <div className="kz-awards-label">優秀賞{mv.tally.awards.length > 1 ? '（同票）' : ''}</div>
          {mv.tally.awards.map((id) => {
            const k = byId.get(id);
            if (!k) return null;
            return (
              <div key={id} className="kz-award-line">
                <b>{k.title}</b>
                <span>{campusLabel(k.campus)}・{k.members.join('・')}</span>
                <span className="kz-votes">{mv.tally!.rows.find((r) => r.id === id)?.votes ?? 0}票</span>
              </div>
            );
          })}
        </div>
      )}

      {mv.admin && (
        <details className="kz-admin">
          <summary>管理部門向け：提出・投票の状況</summary>
          <div className="kz-admin-grid">
            <div>
              <h4>まだ提出していない人（{mv.admin.missing.length}人）</h4>
              <p>{mv.admin.missing.join('、') || 'なし'}</p>
            </div>
            {mv.state !== 'collecting' && mv.tally && (
              <div>
                <h4>投票した人（{mv.tally.voters.length}人）</h4>
                <p>{mv.tally.voters.map((v) => `${v.name}（${v.count}票）`).join('、') || 'なし'}</p>
              </div>
            )}
            {mv.state !== 'collecting' && (
              <div>
                <h4>まだ投票していない人（{mv.admin.nonVoters.length}人）</h4>
                <p>{mv.admin.nonVoters.join('、') || 'なし'}</p>
              </div>
            )}
          </div>
          <p className="kz-hint">名簿は lib/kaizen/model.ts の KAIZEN_ROSTER（旧スプレッドシートの「スタッフ名簿」）。</p>
        </details>
      )}

      {ordered.length === 0 ? (
        <p className="kz-empty pad">{monthLabel(mv.month)}分の提出はまだありません。</p>
      ) : (
        <div className="kz-grid">
          {ordered.map(({ item, row }) => (
            <KaizenCard key={item.id} item={item} votes={row?.votes} rank={row ? row.rank : undefined} award={awards.has(item.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 画面全体 -----------------------------------------------------------------

export default function KaizenUI({ name }: { name: string }) {
  const [view, setView] = useState<ApiView | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab | null>(null);
  const [resultMonth, setResultMonth] = useState('');

  async function load() {
    try {
      const res = await fetch('/api/kaizen', { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        const v = j as ApiView;
        setView(v);
        setErr('');
        // 最初に開くとき：投票受付中で、まだ投票していなければ「投票する」から
        setTab((t) => {
          if (t) return t;
          const vm = v.months.find((m) => m.month === v.votingMonth);
          return vm && vm.state === 'open' && vm.count > 0 && vm.myVote.length === 0 ? 'vote' : 'submit';
        });
        // 結果の月：管理部門は投票中の月、ほかの人は得票を見られるいちばん新しい月
        setResultMonth((m) => {
          if (m) return m;
          if (v.isAdmin) return v.votingMonth;
          return v.months.find((x) => x.tally && x.count > 0)?.month ?? v.currentMonth;
        });
      } else {
        setErr(reasonText(j?.reason, j?.message));
      }
    } catch {
      setErr(reasonText('network_error'));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const cur = view?.months.find((m) => m.month === view.currentMonth);
  const voting = view?.months.find((m) => m.month === view.votingMonth);

  return (
    <div className="kaizen">
      <div className="page-head">
        <h1>つきいち改善</h1>
        <p>
          月に1つ、仕事のやり方を良くした「ビフォー・アフター」を提出し、翌月にみんなで投票します（1人{MAX_VOTES}票まで）。
          得票がいちばん多い改善が優秀賞です。
        </p>
        {view && cur && voting && (
          <div className="kz-status">
            <span className="kz-status-chip">{shortMonthLabel(cur.month)}分の提出：受付中（{cur.count}件）</span>
            <span className={`kz-status-chip ${voting.state === 'open' ? 'open' : ''}`}>
              {shortMonthLabel(voting.month)}分の投票：
              {voting.state === 'open'
                ? `受付中（締め切り ${voteDeadlineLabel(voting.month)}・${voting.voterCount}人が投票${voting.myVote.length ? '・あなたは投票済み' : ''}）`
                : '締め切りました'}
            </span>
            {view.backend === 'local' && <span className="kz-status-chip local">開発用の保存（.data/kaizen.json）</span>}
          </div>
        )}
        <div className="kz-tabs" role="tablist">
          {([
            ['submit', '提出する'],
            ['vote', voting ? `投票する（${shortMonthLabel(voting.month)}分）` : '投票する'],
            ['results', '一覧・結果'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`dm-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)} disabled={!view}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="kz-err pad">{err}</p>}
      {!view && !err && <p className="kz-empty pad">読み込み中…</p>}

      {view && tab === 'submit' && <SubmitTab view={view} name={name} onChanged={load} />}
      {view && tab === 'vote' && <VoteTab view={view} name={name} onChanged={load} goResults={() => { setResultMonth(view.votingMonth); setTab('results'); }} />}
      {view && tab === 'results' && <ResultsTab view={view} month={resultMonth} setMonth={setResultMonth} />}
    </div>
  );
}
