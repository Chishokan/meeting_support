'use client';

import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string };

type CampusStat = {
  campus: string;
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

type StatsRes =
  | { ok: true; stats: CampusStat[]; total: number; fetchedAt: string }
  | { ok: false; reason: string };

// 最初の一歩を作る例。担当者が何を聞けるか分からずに止まるのを防ぐ。
const EXAMPLES = [
  '校舎ごとの問い合わせ状況をまとめて',
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
          <div className="iqa-cards">
            {stats.stats.map((s) => (
              <div className="iqa-card" key={s.campus}>
                <div className="iqa-campus">{s.campus}</div>
                <div className="iqa-total">
                  {s.total}
                  <span>件</span>
                </div>
                <div className="iqa-breakdown">
                  <div>入塾 <b>{s.joined}</b> ／ 申込 <b>{s.applied}</b> ／ 見送り <b>{s.declined}</b></div>
                  <div>
                    追客中 <b>{s.open}</b>
                    {s.other > 0 && <> ／ その他 <b>{s.other}</b></>}
                  </div>
                  {s.noContact > 0 && <div className="iqa-warn">未着手 {s.noContact} 件</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="iqa-note">
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
