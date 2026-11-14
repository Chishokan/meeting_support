'use client';

// 智翔館AI への要望の小窓。こういう使い方をしたい・この作業に対応してほしい・この資料を入れてほしい・
// このフォルダやファイルをリンクで読めるようにしてほしい、などを書いてもらい、/api/chishokan-ai/request に送る。
// 送り先は不具合の報告と同じ「問い合わせ」シート（ヘルプデスクの「ご意見・不具合」に、種別「智翔館AIへの要望」で出る）。

import { useCallback, useState } from 'react';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { imageToBase64 } from '@/lib/chishokanAi/clientImage';
import { REQUEST_KINDS } from '@/lib/chishokanAi/request';

type Props = {
  context: { conversationId?: string; turn?: number; task?: string };
  onClose: () => void;
};

// 種類ごとの書き方の例（入力欄の例として出す）
const HINTS: Record<string, { detail: string; scene: string }> = {
  [REQUEST_KINDS[0]]: {
    detail: '例：保護者会の資料（A4・2枚）を、校舎の数字を入れて作れるようにしてほしい',
    scene: '例：学期ごとの保護者会の前に、校舎長が使う。いまは毎回ゼロから作っていて2時間かかる',
  },
  [REQUEST_KINDS[1]]: {
    detail: '例：チラシの原稿を作るとき、最初に対象の学年を聞いてほしい',
    scene: '例：いまは中3向けで作られてしまい、作り直しになることが多い',
  },
  [REQUEST_KINDS[2]]: {
    detail: '例：冬期講習のカリキュラム表（中1・2）を入れてほしい',
    scene: '例：保護者から講習の内容を聞かれたときに、AIで確かめたい',
  },
  [REQUEST_KINDS[3]]: {
    detail: '例：「12_校舎運営」フォルダの中の、校舎ごとの年間行事表を読めるようにしてほしい',
    scene: '例：行事の日程を聞いたとき、リンクを貼らなくても答えてほしい',
  },
  [REQUEST_KINDS[4]]: {
    detail: '例：回答をそのまま LINE WORKS に送れるボタンがほしい',
    scene: '例：校舎の先生に共有するとき、毎回コピーして貼っている',
  },
};

export default function AiRequestDialog({ context, onClose }: Props) {
  const [kind, setKind] = useState('');
  const [detail, setDetail] = useState('');
  const [scene, setScene] = useState('');
  const [links, setLinks] = useState('');
  const [image, setImage] = useState<{ name: string; data: string; mime: string } | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');
  const close = useCallback(() => {
    if (state !== 'sending') onClose();
  }, [onClose, state]);
  useModalDismiss(close);
  const hint = HINTS[kind] ?? { detail: '何ができるとよいかを、具体的に書いてください', scene: 'いつ・誰が・何のために使うか、いまはどうしているか' };
  const wantsLinks = kind === REQUEST_KINDS[2] || kind === REQUEST_KINDS[3];

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('画像のファイルを選んでください。');
      return;
    }
    try {
      const { data, mime } = await imageToBase64(f);
      setImage({ name: f.name, data, mime });
      setError('');
    } catch {
      setError('画像を読み込めませんでした。');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!kind) return setError('要望の種類を選んでください。');
    if (detail.trim().length < 5) return setError('要望の内容を書いてください（何ができるとよいか）。');
    setState('sending');
    setError('');
    try {
      const res = await fetch('/api/chishokan-ai/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, detail, scene, links, context, image: image ? { data: image.data, mime: image.mime } : null }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setState('idle');
        setError(j?.message || '送れませんでした。時間をおいてもう一度送ってください。');
        return;
      }
      setState('done');
    } catch {
      setState('idle');
      setError('通信エラーで送れませんでした。');
    }
  }

  return (
    <div className="dm-modal-bg" onClick={close}>
      <div className="dm-modal ai-report" role="dialog" aria-modal="true" aria-label="智翔館AIへの要望" onClick={(e) => e.stopPropagation()}>
        <div className="dm-modal-head">
          <div>
            <h2>💡 智翔館AIへの要望</h2>
            <div className="dm-modal-sub">
              要望はヘルプデスクの「ご意見・不具合」（種別：智翔館AIへの要望）に入り、システム担当が確認して、改善に使います。
            </div>
          </div>
          <button className="dm-modal-close" onClick={close} aria-label="閉じる">×</button>
        </div>
        {state === 'done' ? (
          <div className="dm-modal-body">
            <p className="ai-report-done">要望を送りました。ありがとうございます。回答はヘルプデスクの「ご意見・不具合」で確認できます。</p>
            <div className="ai-report-actions">
              <a className="msg-action" href="/helpdesk/feedback" target="_blank" rel="noopener noreferrer">ご意見・不具合を開く</a>
              <button type="button" className="ai-report-submit" onClick={onClose}>閉じる</button>
            </div>
          </div>
        ) : (
          <form className="dm-modal-body ai-report-form" onSubmit={submit}>
            <fieldset>
              <legend>どんな要望ですか<span className="req">必須</span></legend>
              <div className="ai-report-kinds">
                {REQUEST_KINDS.map((k) => (
                  <label key={k} className={kind === k ? 'on' : ''}>
                    <input type="radio" name="request-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                    {k}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="ai-report-field">
              <span>要望の内容<span className="req">必須</span></span>
              <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={4} maxLength={3000} placeholder={hint.detail} />
            </label>

            <label className="ai-report-field">
              <span>使う場面・例（任意）</span>
              <textarea value={scene} onChange={(e) => setScene(e.target.value)} rows={3} maxLength={1500} placeholder={hint.scene} />
            </label>

            <label className="ai-report-field">
              <span>{wantsLinks ? '資料・フォルダのリンク（あれば）' : '参考のリンク（任意）'}</span>
              <textarea
                value={links}
                onChange={(e) => setLinks(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="ドライブのフォルダやファイルのリンク（1行に1つ）"
              />
            </label>

            <div className="ai-report-field">
              <span>見本の画像（任意）</span>
              <div className="ai-report-image">
                <label className="attach-btn">
                  📷 画像を選ぶ
                  <input type="file" accept="image/*" onChange={onPickImage} style={{ display: 'none' }} />
                </label>
                {image && (
                  <span className="attach-chip">
                    {image.name}
                    <button type="button" onClick={() => setImage(null)} aria-label="外す">×</button>
                  </span>
                )}
              </div>
            </div>

            <p className="ai-report-note">要望の一覧は、ほかの職員にも見えます。生徒・保護者の名前は書かないでください。</p>
            {error && <div className="ai-report-error">{error}</div>}
            <div className="ai-report-actions">
              <button type="button" className="msg-action" onClick={close} disabled={state === 'sending'}>やめる</button>
              <button type="submit" className="ai-report-submit" disabled={state === 'sending'}>
                {state === 'sending' ? '送っています…' : '要望を送る'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
