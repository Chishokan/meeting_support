'use client';

// 適性検査：受検者が開く画面（ログイン不要。受検URLのトークンだけで開く）。
//   1. 説明と同意（利用目的・保存期間）＋プロフィールの確認（フリガナ・生年月日・電話・メール）
//   2. 1画面10問 ×（設問数÷10）ページ。全問に答えると［次へ］。ページごとに保存するので、閉じても続きから再開できる
//   3. 完了（得点・判定は出さない）
// 設問は受検ごとにランダムな順。サーバとは「何番目に出したか（pos）」だけでやり取りし、設問番号は持たない。
// 回答にかかった秒数（前の回答からの経過）を記録する。極端に速い受検を見分けるため。

import { useEffect, useMemo, useRef, useState } from 'react';
import { RETENTION, type AnswerValue, type ExamProfile } from '@/lib/aptitude/model';
import type { ExamView } from '@/lib/aptitude/store';
import { api, failText, jpDateTime } from '@/lib/aptitude/client';

const PER_PAGE = 10;

const CLOSED: Record<string, { title: string; body: string }> = {
  done: { title: '受検が完了しました', body: 'ご協力ありがとうございました。このページは閉じてかまいません。' },
  expired: { title: '受検URLの有効期限が切れています', body: 'お手数ですが、採用担当者に新しいURLの発行を依頼してください。' },
  revoked: { title: 'この受検URLは使えません', body: '取り消されたか、新しいURLが発行されています。採用担当者から届いた最新のURLを開いてください。' },
  not_found: { title: '受検URLが見つかりません', body: 'URLが途中で切れていないか確かめてください。わからない場合は採用担当者に問い合わせてください。' },
};

export default function ExamUI({ token }: { token: string }) {
  const [view, setView] = useState<ExamView | null>(null);
  const [err, setErr] = useState('');

  async function load() {
    const r = await api<{ view: ExamView }>(`/api/exam/${encodeURIComponent(token)}`);
    if (!r.ok) return setErr(failText(r));
    setView(r.view);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !view) return <div className="exam-card"><p className="exam-err" role="alert">{err}</p><button className="exam-btn" onClick={() => { setErr(''); load(); }}>もう一度読み込む</button></div>;
  if (!view) return <div className="exam-card"><p className="exam-muted">読み込み中…</p></div>;

  if (view.state === 'ready') return <Consent token={token} view={view} onDone={load} />;
  if (view.state === 'answering') return <Questions token={token} view={view} onDone={() => setView({ state: 'done' })} />;

  const c = CLOSED[view.state] ?? CLOSED.not_found;
  return (
    <div className="exam-card exam-closed">
      <h1 className="exam-h1">{c.title}</h1>
      <p>{c.body}</p>
    </div>
  );
}

// ---- 1. 説明と同意 ------------------------------------------------------------

function Consent({ token, view, onDone }: { token: string; view: ExamView; onDone: () => void }) {
  const [p, setP] = useState<ExamProfile>(view.profile ?? { kana: '', birthDate: '', phone: '', email: '' });
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const r = await api(`/api/exam/${encodeURIComponent(token)}`, { body: { action: 'consent', profile: p } });
    setBusy(false);
    if (!r.ok) return setErr(failText(r));
    onDone();
  }

  return (
    <form className="exam-card" onSubmit={start}>
      <h1 className="exam-h1">{view.name} さん</h1>
      <p className="exam-lead">採用選考の適性検査です。はじめる前に、下の説明をお読みください。</p>

      <section className="exam-sec">
        <h2 className="exam-h2">答え方</h2>
        <ul className="exam-list">
          <li>質問は100問ほどです。それぞれ「はい」か「いいえ」で答えてください。</li>
          <li>あまり深く考えず、<b>思ったとおりにスピーディに</b>答えてください。正解・不正解はありません。</li>
          <li>かかる時間は10〜15分ほどです。1画面に10問ずつ出ます。</li>
          <li>途中で閉じても、同じURLを開けば続きから再開できます{view.expiresAt && `（${jpDateTime(view.expiresAt)} まで）`}。</li>
        </ul>
      </section>

      <section className="exam-sec">
        <h2 className="exam-h2">個人情報の取り扱い</h2>
        <ul className="exam-list">
          <li><b>利用目的：</b>当社の採用選考（面接の参考資料）にのみ使います。ほかの目的には使いません。</li>
          <li><b>見る人：</b>当社の採用担当者に限ります。</li>
          <li><b>保存期間：</b>不採用・辞退の場合は、選考の終了から{Math.round(RETENTION.deniedDays / 365)}年で削除します。採用の場合は、人事の資料として在職中保管します。</li>
          <li>検査の結果（得点・判定）はお知らせしていません。</li>
        </ul>
      </section>

      <section className="exam-sec">
        <h2 className="exam-h2">ご本人の確認</h2>
        <div className="exam-fields">
          <label>フリガナ<span className="exam-req">必須</span>
            <input value={p.kana} onChange={(e) => setP({ ...p, kana: e.target.value })} autoComplete="off" placeholder="例 サセボ ハナコ" required />
          </label>
          <label>生年月日
            <input type="date" value={p.birthDate} onChange={(e) => setP({ ...p, birthDate: e.target.value })} />
          </label>
          <label>電話番号
            <input type="tel" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} autoComplete="tel" />
          </label>
          <label>メールアドレス
            <input type="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} autoComplete="email" />
          </label>
        </div>
      </section>

      <label className="exam-agree">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        上の説明と個人情報の取り扱いに同意して受検します
      </label>
      {err && <p className="exam-err" role="alert">{err}</p>}
      <button className="exam-btn primary" disabled={!agree || busy || !p.kana.trim()}>{busy ? '準備中…' : '同意してはじめる'}</button>
    </form>
  );
}

// ---- 2. 設問 -----------------------------------------------------------------

function Questions({ token, view, onDone }: { token: string; view: ExamView; onDone: () => void }) {
  const items = useMemo(() => view.items ?? [], [view.items]);
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const [answers, setAnswers] = useState<Record<number, AnswerValue>>(view.answers ?? {});
  // 途中から再開したときは、まだ答えていない設問がある最初のページから
  const [page, setPage] = useState(() => {
    const first = items.findIndex((it) => !(view.answers ?? {})[it.pos]);
    return first < 0 ? pages - 1 : Math.floor(first / PER_PAGE);
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const seconds = useRef<Record<number, number>>({});
  // 開いた時点で答えてあった設問（前回までに保存済み）。秒数は保存済みのものを使い、答え直しても測り直さない
  const before = useRef(new Set(Object.keys(view.answers ?? {}).map(Number)));
  const mark = useRef(Date.now());
  const top = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  const shown = items.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const answered = items.filter((it) => answers[it.pos]).length;
  const pageDone = shown.every((it) => answers[it.pos]);
  const last = page === pages - 1;

  useEffect(() => {
    mark.current = Date.now();
    // ページを移ったときだけ先頭へ戻す（開いた直後はヘッダが見える位置のまま）
    if (first.current) first.current = false;
    else top.current?.scrollIntoView({ block: 'start' });
  }, [page]);

  function choose(pos: number, v: AnswerValue) {
    // 秒数は最初に答えたときだけ記録する（前の回答またはページを開いてからの経過）
    if (seconds.current[pos] == null && !before.current.has(pos)) {
      const now = Date.now();
      seconds.current[pos] = (now - mark.current) / 1000;
      mark.current = now;
    }
    setAnswers((a) => ({ ...a, [pos]: v }));
  }

  async function savePage(): Promise<boolean> {
    // 秒数を測っていない設問（保存済みのもの）は null で送る。サーバは保存済みの秒数を残す
    const list = shown.map((it) => ({ pos: it.pos, answer: answers[it.pos], seconds: seconds.current[it.pos] ?? null }));
    const r = await api(`/api/exam/${encodeURIComponent(token)}`, { body: { action: 'answers', items: list } });
    if (!r.ok) { setErr(`保存できませんでした。${failText(r)}`); return false; }
    return true;
  }

  async function next() {
    setBusy(true);
    setErr('');
    const saved = await savePage();
    if (!saved) return setBusy(false);
    if (!last) {
      setBusy(false);
      return setPage(page + 1);
    }
    const r = await api(`/api/exam/${encodeURIComponent(token)}`, { body: { action: 'finish' } });
    setBusy(false);
    if (!r.ok) {
      if (r.reason.startsWith('unanswered')) {
        const pos = Number(r.reason.split('|')[1]?.split(',')[0]);
        if (Number.isInteger(pos)) setPage(Math.floor(pos / PER_PAGE));
        return setErr('答えていない質問があります。');
      }
      return setErr(failText(r));
    }
    onDone();
  }

  return (
    <div className="exam-card exam-q" ref={top}>
      <div className="exam-progress" aria-label={`回答 ${answered} / ${items.length}`}>
        <div className="exam-progress-bar"><div style={{ width: `${(answered / Math.max(1, items.length)) * 100}%` }} /></div>
        <span>{answered} / {items.length}</span>
      </div>
      <p className="exam-muted exam-hint">深く考えず、思ったとおりに答えてください。（{page + 1} / {pages} ページ）</p>

      <ol className="exam-items" start={page * PER_PAGE + 1}>
        {shown.map((it, i) => {
          const v = answers[it.pos];
          return (
            <li key={it.pos} className={`exam-item ${v ? 'answered' : ''}`}>
              <p className="exam-text"><span className="exam-no">{page * PER_PAGE + i + 1}.</span>{it.text}</p>
              <div className="exam-choices" role="radiogroup" aria-label={`${page * PER_PAGE + i + 1}番`}>
                <button type="button" role="radio" aria-checked={v === 'Y'} className={`exam-choice ${v === 'Y' ? 'on' : ''}`} onClick={() => choose(it.pos, 'Y')}>はい</button>
                <button type="button" role="radio" aria-checked={v === 'N'} className={`exam-choice ${v === 'N' ? 'on' : ''}`} onClick={() => choose(it.pos, 'N')}>いいえ</button>
              </div>
            </li>
          );
        })}
      </ol>

      {err && <p className="exam-err" role="alert">{err}</p>}
      <div className="exam-nav">
        <button className="exam-btn" disabled={busy || page === 0} onClick={() => setPage(page - 1)}>前へ</button>
        <button className="exam-btn primary" disabled={busy || !pageDone} onClick={next}>
          {busy ? '保存中…' : last ? '回答を送信する' : '次へ'}
        </button>
      </div>
      {!pageDone && <p className="exam-muted exam-center">このページの質問すべてに答えると先へ進めます。</p>}
    </div>
  );
}
