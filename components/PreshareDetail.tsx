'use client';

// 部門会議の事前共有1件の詳細（ポップアップ）。
// ダッシュボードと「部門会議議事録」画面の両方から、カードの［詳細］で開く。
// 会議中に議題・レジュメを見ながら進めるためのものなので、本文は大きめの文字で全文を出す。
// ★議事録の詳細（MinutesDetail）と同じ見た目の枠（dm-modal-*）を使っている。

import { useState } from 'react';
import type { PreshareRow } from '@/lib/deptMinutesPreshare';
import { useModalDismiss } from '@/lib/useModalDismiss';
import ZoomButtons from '@/components/ZoomButtons';
import { formatMeetingId, zoomErrorText, zoomJoinHref } from '@/lib/zoom/link';
import { confirmSummary } from '@/lib/attendees';

// 更新日時は時刻まで見せる（会議の直前に直すことがあるため）。
function fmtStamp(s: string) {
  const d = s.match(/(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})/);
  const t = s.match(/(\d{1,2}):(\d{2})/);
  if (!d) return s;
  return `${Number(d[2])}/${Number(d[3])}${t ? ` ${t[1].padStart(2, '0')}:${t[2]}` : ''}`;
}

export default function PreshareDetail({
  row,
  when,
  me,
  onClose,
  onStart,
  onSaved,
  onDeleted,
  onConfirmed,
}: {
  row: PreshareRow;
  when?: string; // 「今日」「明日」など（無ければ出さない）
  me?: string; // いま見ている人の名前（直したときの「更新者」に出す）
  onClose: () => void;
  // 渡されたときだけ［この会議の議事録をつくる］を出す。押すと議事録の画面に会議情報を読み込む。
  onStart?: () => void;
  // 渡されたときだけ議題を直せるようにする。保存できたら直したあとの行を返す。
  onSaved?: (next: PreshareRow) => void;
  // 渡されたときだけ［削除］を出す（消せる人にだけ。row.canDelete）。消せたら事前共有IDを返す。
  onDeleted?: (id: string) => void;
  // 渡されたときだけ、出席者が「確認しました」を付けられる。付け外しできたら、直したあとの行を返す。
  onConfirmed?: (next: PreshareRow) => void;
}) {
  // 会議の直前に議題を足したいことがあるので、この場で直せるようにしている。
  // 全部門が見ているものを直すため、誰が直したかは必ず残す（更新日時・更新者）。
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.agenda);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // 押した直後の見た目（サーバの返事を待つあいだも、チェックがすぐ付いて見えるようにする）。
  const [pendingOn, setPendingOn] = useState<boolean | null>(null);

  // 事前に見たかどうか。出席者ごとに出し、出席者本人だけがチェックを付けられる（サーバでも確かめる）。
  const seen = confirmSummary(row.attendees, row.confirmed);
  const mine = Boolean(me) && (row.confirmed ?? []).includes(me as string);

  async function toggleConfirm(on: boolean) {
    if (confirming) return;
    setErr('');
    setPendingOn(on);
    setConfirming(true);
    try {
      const res = await fetch('/api/dept-minutes/preshare/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, on }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) onConfirmed?.({ ...row, confirmed: Array.isArray(j.confirmed) ? j.confirmed : [] });
      else setErr(j?.reason === 'forbidden' ? '「確認しました」を付けられるのは、この会議の出席者の方です。' : '確認の記録に失敗しました。時間をおいてお試しください。');
    } catch {
      setErr('確認の記録に失敗しました。通信状況をご確認ください。');
    } finally {
      setPendingOn(null);
      setConfirming(false);
    }
  }
  const dirty = editing && text.trim() !== row.agenda.trim();

  // 書きかけのまま閉じると消えてしまうので、そのときだけ確かめる。
  function close() {
    if (dirty && !confirm('直した議題を保存していません。閉じると消えますがよろしいですか？')) return;
    onClose();
  }

  async function save() {
    const agenda = text.trim();
    if (saving) return;
    if (!agenda) {
      setErr('議題が空です。何か書いてから保存してください。');
      return;
    }
    if (agenda === row.agenda.trim()) {
      setEditing(false);
      return;
    }
    setErr('');
    setSaving(true);
    try {
      const res = await fetch('/api/dept-minutes/preshare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id,
          // 事前共有は会議情報とひとそろいで保存する作りなので、直さない欄もそのまま送る。
          meta: {
            title: row.title,
            date: row.date,
            place: row.place,
            attendees: row.attendees,
            agenda,
          },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        onSaved?.({ ...row, agenda, editedAt: String(j.ts || ''), editedBy: me || row.editedBy });
        setEditing(false);
      } else if (j?.reason === 'not_configured') {
        setErr('スプレッドシート連携が未設定のため保存できません。管理者にご連絡ください。');
      } else if (j?.reason === 'gas_outdated') {
        setErr('スプレッドシート側の設定が古いため保存できません。管理者にご連絡ください。');
      } else {
        setErr('保存に失敗しました。時間をおいてお試しください。');
      }
    } catch {
      setErr('保存に失敗しました。通信状況をご確認ください。');
    } finally {
      setSaving(false);
    }
  }

  // 事前共有の削除。間違えて作ったとき・会議が無くなったときに使う。元に戻せないので必ず確かめる。
  async function remove() {
    if (deleting) return;
    const hasZoom = Boolean(row.zoomMeetingId);
    const ask = `「${row.title || '（会議名なし）'}」の事前共有を削除します。\n`
      + 'ダッシュボードから消え、元に戻せません。'
      + (hasZoom ? '\nこの会議の Zoom ミーティングも削除します（参加URLは使えなくなります）。' : '')
      + '\n\nよろしいですか？';
    if (!confirm(ask)) return;
    setErr('');
    setDeleting(true);
    try {
      const res = await fetch('/api/dept-minutes/preshare', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        // Zoom だけ消せなかったとき：事前共有は消えているので、Zoom に残ったことだけ伝える。
        if (j.zoom && !j.zoom.ok) {
          alert(
            j.zoom.reason === 'pmi'
              ? `事前共有を削除しました。\n${zoomErrorText('pmi')}`
              : `事前共有は削除しましたが、Zoom ミーティングは削除できませんでした。\n${zoomErrorText(j.zoom.reason)}`,
          );
        }
        onDeleted?.(row.id);
        return;
      }
      setErr(
        j?.reason === 'forbidden' ? '削除できるのは、その部門の方・事前共有した本人・管理部門の方です。'
          : j?.reason === 'has_minutes' ? 'この会議は議事録を保存済みのため、事前共有は削除できません。'
            : j?.reason === 'not_found' ? 'この事前共有は、すでに削除されています。画面を読み込み直してください。'
              : j?.reason === 'gas_outdated' ? 'スプレッドシート側の設定が古いため削除できません。管理者にご連絡ください。'
                : '削除に失敗しました。時間をおいてお試しください。',
      );
    } catch {
      setErr('削除に失敗しました。通信状況をご確認ください。');
    } finally {
      setDeleting(false);
    }
  }

  // Esc で閉じる／開いているあいだ後ろのページを動かさない
  useModalDismiss(close);

  const info = [
    { label: '開催日時', text: row.date },
    { label: '場所', text: row.place },
    { label: '出席者', text: row.attendees },
  ].filter((s) => s.text);
  // Zoom ミーティングを作った会議だけ、ID とパスコードを出す（アプリから入れない人に口頭で伝えられるように）。
  const zoomJoin = zoomJoinHref(row.zoomJoinUrl);
  const zoomInfo = zoomJoin
    ? `ミーティングID ${formatMeetingId(row.zoomMeetingId)}${row.zoomPasscode ? `　パスコード ${row.zoomPasscode}` : ''}`
    : '';

  return (
    <div className="dm-modal-bg" onClick={close}>
      <div
        className="dm-modal pre-modal"
        role="dialog"
        aria-modal="true"
        aria-label="部門会議の事前共有"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dm-modal-head">
          <div>
            <div className="dm-modal-sub">
              {when && <span className={`pre-when ${when === '今日' ? 'today' : ''}`}>{when}</span>}
              {when && '　'}
              {row.campus}
              {row.user && `　共有：${row.user}`}
            </div>
            <h2>{row.title || '（会議名なし）'}</h2>
            {info.map((s) => (
              <div key={s.label} className="dm-modal-sub">{s.label}：{s.text}</div>
            ))}
            {zoomInfo && <div className="dm-modal-sub">Zoom：{zoomInfo}</div>}
            {row.editedBy && (
              <div className="dm-modal-edited">
                更新：{fmtStamp(row.editedAt)}　{row.editedBy}
              </div>
            )}
          </div>
          <button className="dm-modal-close" onClick={close} aria-label="閉じる">×</button>
        </div>

        <div className="dm-modal-body">
          <div className="share-detail-sec">
            <h3>
              予定している議題・レジュメ
            </h3>

            {editing ? (
              <>
                <textarea
                  className="pre-agenda-edit"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={'1行1件の箇条書きでも、レジュメをそのまま貼り付けても構いません。'}
                  autoFocus
                />
                <p className="dm-hint">
                  この議題は全部門が見ています。保存すると上書きされ、「更新：日時 名前」が残ります。
                  ほかの人が同時に直していると、あとから保存したほうが残ります。
                </p>
                {err && <p className="dm-note err">{err}</p>}
              </>
            ) : (
              <>
                <pre className="dm-modal-text pre-agenda">{row.agenda || '（議題が登録されていません）'}</pre>
                {/* 事前に見たかの確認。出席者が登録されている会議だけ出す */}
                {seen.total > 0 && (
                  <div className="pre-confirm">
                    <div className="pre-confirm-head">
                      事前の確認<span>{seen.done}／{seen.total}人が確認済み</span>
                    </div>
                    <ul className="pre-confirm-list">
                      {seen.items.map((i) => (
                        <li key={i.name} className={i.ok ? 'ok' : undefined}>
                          {i.ok ? '✓' : '・'} {i.name}
                        </li>
                      ))}
                    </ul>
                    {onConfirmed && row.canConfirm && (
                      <label className="pre-confirm-me">
                        <input type="checkbox" checked={pendingOn ?? mine} disabled={confirming} onChange={(e) => void toggleConfirm(e.target.checked)} />
                        議題を確認しました{me ? `（${me}）` : ''}
                      </label>
                    )}
                  </div>
                )}
                {err && <p className="dm-note err">{err}</p>}
              </>
            )}
          </div>
        </div>

        <div className="dm-modal-foot">
          {editing ? (
            <>
              <button className="dm-modal-edit" onClick={() => void save()} disabled={saving}>
                {saving ? '保存中…' : '保存する'}
              </button>
              <button
                className="dm-copy"
                onClick={() => {
                  if (dirty && !confirm('直した議題を元に戻しますがよろしいですか？')) return;
                  setText(row.agenda);
                  setErr('');
                  setEditing(false);
                }}
                disabled={saving}
              >
                やめる
              </button>
            </>
          ) : (
            <>
          <ZoomButtons row={row} detail />
          {onStart && (
            <button className="dm-modal-edit" onClick={onStart}>この会議の議事録をつくる</button>
          )}
          {/* 議題を直す。長い議題をスクロールしても押せるよう、下のボタンの並びに置く。
              直せるのは、親から onSaved を渡された画面だけ（ダッシュボード・部門会議） */}
          {onSaved && (
            <button className="dm-copy" onClick={() => { setText(row.agenda); setErr(''); setEditing(true); }}>
              議題の修正
            </button>
          )}
          <button
            className="dm-copy"
            onClick={() =>
              navigator.clipboard?.writeText(
                [
                  row.title,
                  ...info.map((s) => `${s.label}：${s.text}`),
                  ...(zoomJoin ? [`Zoom：${zoomJoin}`, zoomInfo] : []),
                  '',
                  row.agenda,
                ].join('\n'),
              )
            }
          >
            コピー
          </button>
          {/* 消せる人（その部門・事前共有した本人・管理部門）にだけ出す */}
          {onDeleted && row.canDelete && (
            <button className="pre-delete" onClick={() => void remove()} disabled={deleting}>
              {deleting ? '削除中…' : '削除'}
            </button>
          )}
            </>
          )}
          <button className="dm-modal-done" onClick={close} disabled={saving || deleting}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
