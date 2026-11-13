'use client';

// 智翔館AI の不具合報告の小窓。どんな状況で不具合があったかを詳しく書いてもらい、/api/chishokan-ai/report に送る。
// 送り先は「問い合わせ」シート（ヘルプデスクの「ご意見・不具合」に、種別「智翔館AIの不具合」で出る）。
// 会話の番号・読んだ資料・出た注意などは画面が自動で添える（何を添えるかは小窓の中で見せる）。

import { useCallback, useState } from 'react';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { imageToBase64 } from '@/lib/chishokanAi/clientImage';
import { REPORT_KINDS, type ReportContext } from '@/lib/chishokanAi/report';

type Props = {
  context: ReportContext;
  /** 最初に選んでおく種類（エラーの回答から開いたときなど） */
  initialKind?: string;
  onClose: () => void;
};

export default function AiReportDialog({ context, initialKind, onClose }: Props) {
  const [kind, setKind] = useState(initialKind && (REPORT_KINDS as readonly string[]).includes(initialKind) ? initialKind : '');
  const [detail, setDetail] = useState('');
  const [expected, setExpected] = useState('');
  const [includeText, setIncludeText] = useState(true);
  const [image, setImage] = useState<{ name: string; data: string; mime: string } | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');
  const close = useCallback(() => {
    if (state !== 'sending') onClose();
  }, [onClose, state]);
  useModalDismiss(close);

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
    if (!kind) return setError('何が起きたかを選んでください。');
    if (detail.trim().length < 5) return setError('詳しい状況を書いてください（何をしようとして、どうなったか）。');
    setState('sending');
    setError('');
    try {
      const res = await fetch('/api/chishokan-ai/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          detail,
          expected,
          includeText,
          context: {
            ...context,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
            screen: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
          },
          image: image ? { data: image.data, mime: image.mime } : null,
        }),
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

  const auto = [
    context.conversationId && `会話の番号：${context.conversationId}${context.turn ? `（${context.turn}回目のやり取り）` : ''}`,
    context.at && `回答の時刻：${context.at}`,
    context.task && `選んだ作業：${context.task}`,
    context.flags?.length && `状態：${context.flags.join('、')}`,
    context.sources?.length && `読んだ資料：${context.sources.join('、')}`,
    context.notices?.length && `画面に出た注意：${context.notices.length}件`,
    '使っている端末・ブラウザ・画面の大きさ',
  ].filter(Boolean) as string[];

  return (
    <div className="dm-modal-bg" onClick={close}>
      <div className="dm-modal ai-report" role="dialog" aria-modal="true" aria-label="智翔館AIの不具合を報告" onClick={(e) => e.stopPropagation()}>
        <div className="dm-modal-head">
          <div>
            <h2>⚠ 智翔館AIの不具合を報告</h2>
            <div className="dm-modal-sub">
              報告はヘルプデスクの「ご意見・不具合」（種別：智翔館AIの不具合）に入り、システム担当が確認して回答します。
            </div>
          </div>
          <button className="dm-modal-close" onClick={close} aria-label="閉じる">×</button>
        </div>
        {state === 'done' ? (
          <div className="dm-modal-body">
            <p className="ai-report-done">報告を送りました。ありがとうございます。回答はヘルプデスクの「ご意見・不具合」で確認できます。</p>
            <div className="ai-report-actions">
              <a className="msg-action" href="/helpdesk/feedback" target="_blank" rel="noopener noreferrer">ご意見・不具合を開く</a>
              <button type="button" className="ai-report-submit" onClick={onClose}>閉じる</button>
            </div>
          </div>
        ) : (
          <form className="dm-modal-body ai-report-form" onSubmit={submit}>
            <fieldset>
              <legend>何が起きましたか<span className="req">必須</span></legend>
              <div className="ai-report-kinds">
                {REPORT_KINDS.map((k) => (
                  <label key={k} className={kind === k ? 'on' : ''}>
                    <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                    {k}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="ai-report-field">
              <span>詳しい状況<span className="req">必須</span></span>
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={6}
                maxLength={3000}
                placeholder={'できるだけ具体的に書いてください。\n・何をしようとしたか（例：冬期講習（中3）のチラシを作りたかった）\n・どう頼んだか（押したボタン、書いた文、添付やリンク）\n・何が起きたか（表示された文やエラー、どこが違ったか）\n・何回やっても同じか、たまにか'}
              />
            </label>

            <label className="ai-report-field">
              <span>本当はどうなってほしかったか（任意）</span>
              <textarea
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="例：要項の日程（12月26日〜1月7日）で答えてほしかった"
              />
            </label>

            <div className="ai-report-field">
              <span>画面の写真（任意）</span>
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

            <div className="ai-report-auto">
              <div className="ai-report-auto-title">一緒に送る情報（画面が自動で添えます）</div>
              <ul>
                {auto.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              {(context.question || context.answer) && (
                <label className="ai-report-check">
                  <input type="checkbox" checked={includeText} onChange={(e) => setIncludeText(e.target.checked)} />
                  質問と回答の先頭も添える（ご意見・不具合の一覧は、ほかの職員にも見えます。生徒の名前などが入っていたら外してください）
                </label>
              )}
            </div>

            {error && <div className="ai-report-error">{error}</div>}
            <div className="ai-report-actions">
              <button type="button" className="msg-action" onClick={close} disabled={state === 'sending'}>やめる</button>
              <button type="submit" className="ai-report-submit" disabled={state === 'sending'}>
                {state === 'sending' ? '送っています…' : '報告を送る'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
