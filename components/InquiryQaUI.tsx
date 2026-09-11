'use client';

import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string };

type GoalView = {
  metric: string;
  target: number | null;
  actual: number | null;
  source: '自動' | 'シート';
};

type CampusStat = {
  campus: string;
  goals?: GoalView[];
  trialsThisMonth?: number;
  total: number;
  joined: number;
  applied: number;
  declined: number;
  open: number;
  other: number;
  trialDone: number;
  noContact: number;
  bySource: Record<string, number>;
};

type MonthBlock = { ym: string; label: string; stats: CampusStat[]; totalGoals?: GoalView[] };

type StatsRes =
  | {
      ok: true;
      current: MonthBlock;
      previous: MonthBlock;
      goalsStatus: string;
      olderCount: number;
      unknownCount: number;
      total: number;
      fetchedAt: string;
    }
  | { ok: false; reason: string };

// 最初の一歩を作る例。担当者が何を聞けるか分からずに止まるのを防ぐ。
const EXAMPLES = [
  '当月と前月を比べてどうですか？',
  '7月の問い合わせ件数は？',
  '追客中で止まっている人は？',
  '媒体の内訳は？紹介はどれくらい',
  '体験まで来たのに入塾していない人は？',
  'クローズ予定日を過ぎている人は？',
];

const REASON_TEXT: Record<string, string> = {
  board_not_configured: '問合せ管理シートが未設定です（Apps Script の INQUIRY_BOARD_ID）。',
  board_open_failed: '問合せ管理シートを開けませんでした。Apps Script の実行アカウントに閲覧権限があるか確認してください。',
  not_configured: 'APPS_SCRIPT_URL が未設定です。',
  upstream_error: 'シートの読み込みに失敗しました。',
  network_error: 'シートに接続できませんでした。',
  forbidden: 'この機能は小中等部と管理部門のみ利用できます。',
};

export default function InquiryQaUI({ name, campus }: { name: string; campus: string }) {
  const [stats, setStats] = useState<StatsRes | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/inquiry-qa')
      .then((r) => r.json())
      .then((j: StatsRes) => { if (alive) setStats(j); })
      .catch(() => { if (alive) setStats({ ok: false, reason: 'network_error' }); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);

    const next: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages([...next, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/inquiry-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => '');
        setMessages([...next, { role: 'assistant', content: t || 'エラーが発生しました。' }]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMessages([...next, { role: 'assistant', content: acc }]);
      }
    } catch {
      setMessages([...next, { role: 'assistant', content: '通信エラーが発生しました。' }]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      ask(input);
    }
  }

  return (
    <div className="iqa-page">
      <div className="page-head">
        <h1>問い合わせQA</h1>
        <p>小中等部「問合せ管理」シートの内容に、AIが答えます（{campus} / {name} さん）。</p>
      </div>

      {stats && !stats.ok && (
        <div className="iqa-err">{REASON_TEXT[stats.reason] ?? `読み込みエラー（${stats.reason}）`}</div>
      )}

      {stats?.ok && (
        <>
          <MonthSection title={`${stats.current.label}（当月）`} block={stats.current} />
          <MonthSection title={`${stats.previous.label}（前月）`} block={stats.previous} />
          <div className="iqa-note">
            {stats.goalsStatus !== 'ok' && (
              <>
                目標データを読み込めていません（{stats.goalsStatus}）。
                Apps Script の GOALS_BOOK_ID を設定すると、カードに目標対比が出ます。
                <br />
              </>
            )}
            <b>「入塾」はその月に入会した人数ではありません。</b>
            その月に問い合わせた人のうち、最終的に入塾に至った件数です。
            月の入会実績は目標欄（行動計画の入力値）をご覧ください。
            <br />
            表示は当月と前月のみです。それ以前（{stats.olderCount} 件）は下のチャットで
            「7月の問い合わせ件数は？」のように月を指定して尋ねてください。
            {stats.unknownCount > 0 && (
              <> 日付を読み取れなかった行が {stats.unknownCount} 件あり、月別の集計には入っていません。</>
            )}
            <br />
            全 {stats.total} 件を読み込みました{stats.fetchedAt ? `（${stats.fetchedAt} 時点）` : ''}。
            生徒氏名は「佐○」の形にマスクされ、電話番号・住所・保護者名はAIに渡していません。
            個別の件は「校舎名 #No.」でシートを引いてください。
          </div>
        </>
      )}

      {messages.length === 0 && (
        <div className="iqa-examples">
          {EXAMPLES.map((e) => (
            <button key={e} className="iqa-example" onClick={() => ask(e)} disabled={busy}>
              {e}
            </button>
          ))}
        </div>
      )}

      <div className="wrap">
        <div className="messages">
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div>
                <div className="bubble">{m.content || '…'}</div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <div className="composer">
        <div className="inner">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="例：大野校の追客中を教えて（⌘/Ctrl+Enter で送信）"
          />
          <button onClick={() => ask(input)} disabled={busy || !input.trim()}>
            {busy ? '…' : '質問'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 1か月分の校舎カード。当月・前月で同じ形を使う。
function MonthSection({ title, block }: { title: string; block: MonthBlock }) {
  const total = block.stats.reduce((a, s) => a + s.total, 0);
  return (
    <div className="iqa-month">
      <div className="iqa-month-head">
        {title}
        <span className="iqa-month-total">問い合わせ {total} 件</span>
        {block.totalGoals && block.totalGoals.length > 0 && (
          <span className="iqa-month-goals">
            中等部合計{' '}
            {block.totalGoals.map((g) => {
              const behind = (g.target ?? 0) > 0 && (g.actual ?? 0) < (g.target ?? 0);
              return (
                <span key={g.metric} className="iqa-month-goal">
                  {g.metric} <b className={behind ? 'behind' : 'met'}>{g.actual ?? '—'}</b>
                  <i>/{g.target ?? '—'}</i>
                </span>
              );
            })}
          </span>
        )}
      </div>
      {block.stats.length === 0 ? (
        <div className="iqa-month-empty">この月の問い合わせはまだ登録されていません。</div>
      ) : (
        <div className="iqa-cards">
          {block.stats.map((s) => (
            <div className="iqa-card" key={s.campus}>
              <div className="iqa-campus">{s.campus}</div>
              <div className="iqa-total">
                {s.total}
                <span>件</span>
              </div>
              <div className="iqa-breakdown">
                <div className="iqa-breakdown-label">この月の問い合わせのその後</div>
                <div>入塾 <b>{s.joined}</b> ／ 申込 <b>{s.applied}</b> ／ 見送り <b>{s.declined}</b></div>
                <div>
                  追客中 <b>{s.open}</b>
                  {s.other > 0 && <> ／ その他 <b>{s.other}</b></>}
                </div>
                {s.noContact > 0 && <div className="iqa-warn">未着手 {s.noContact} 件</div>}
                {s.trialsThisMonth != null && s.trialsThisMonth > 0 && (
                  <div>この月に体験を実施 <b>{s.trialsThisMonth}</b></div>
                )}
              </div>
              {s.goals && s.goals.length > 0 && (
                <div className="iqa-goals">
                  {s.goals.map((g) => {
                    const a = g.actual ?? 0;
                    const t = g.target ?? 0;
                    const behind = t > 0 && a < t;
                    return (
                      <div className="iqa-goal" key={g.metric}>
                        <span className="iqa-goal-name" title={`実績の出所: ${g.source}`}>
                          {g.metric}
                        </span>
                        <span className={`iqa-goal-num ${behind ? 'behind' : 'met'}`}>
                          {g.actual ?? '—'}<i>/{g.target ?? '—'}</i>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
