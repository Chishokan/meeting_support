// 問合せ管理の画面上部アラート。
//   GET /api/inquiry-board/alerts?campus=<校舎 or すべて>
//   → { ok, facts, alerts（ルール）, ai: { text, cached } | null }
//
// ルール部分は lib/inquiryAlerts.ts。AI 部分はここで Claude を呼ぶ。
// 画面を開くたびに API を叩かないよう、校舎×台帳の更新状態ごとにサーバ内で 15 分キャッシュする
//（Vercel では関数インスタンスごとのキャッシュなので、ヒットしないこともある。その分は少し遅いだけ）。
// AI が使えないとき（キー未設定・エラー）は ai: null で返し、画面はルールのチップだけを出す。

import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/auth';
import { canUseInquiryBoard } from '@/lib/inquiryBoardAccess';
import { listRecords } from '@/lib/inquiryStore';
import { listGoals } from '@/lib/goals';
import { jstDate, withCompanyKnowledge } from '@/lib/companyKnowledge';
import { MODEL, THINKING } from '@/lib/systemPrompt';
import { buildFacts, factsFingerprint, formatFactsForAi, ruleAlerts, type Alert, type AlertFacts } from '@/lib/inquiryAlerts';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALL = 'すべて';
const CACHE_MS = 15 * 60 * 1000;

type Cached = { at: number; text: string };
const aiCache = new Map<string, Cached>();

const client = new Anthropic();

const AI_SYSTEM = `
あなたは「株式会社智翔館 小中等部 問合せ管理」の画面上部に出る短い注意喚起を書く役です。
読むのは校舎の担当者。朝いちばんに画面を開いて、今日まず何をすべきかを3秒で判断できるようにする。

【絶対のルール】
- 下の【事実】に書かれた数字と人だけを根拠にする。数え直さない。推測で人や数字を足さない。
- 個別の件は「#No.」で示す（例：#12 佐○）。事実に無い件を挙げない。
- 空欄は「未記入」と呼ぶ。「0件」と混同しない。
- 目標がある指標は「実績/目標」で示す。届いていなければそう書く。取り繕わない。
- 目標が無い指標に目標をでっち上げない。

【出力の形式】（この3行だけ。見出し・箇条書き記号・前置き・挨拶は書かない）
1行目: 今日の結論を1文（例：「クローズ超過3件の決着が最優先。今月入会は目標まであと4」）
2行目: 最優先で当たる人を具体的に（#No. と理由。最大3件）
3行目: KPI の一言（今月入会・体験授業の実績/目標と前月比の要点）
各行は60字以内。全体で200字以内。
`.trim();

async function aiComment(facts: AlertFacts, key: string): Promise<{ text: string; cached: boolean } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const hit = aiCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { text: hit.text, cached: true };

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      thinking: THINKING,
      system: [{ type: 'text', text: withCompanyKnowledge(AI_SYSTEM), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `【事実】\n${formatFactsForAi(facts)}` }],
    });
    if (res.stop_reason === 'refusal') return null;
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) return null;
    // 古いキャッシュが溜まらないように、たまに掃除する
    if (aiCache.size > 50) {
      for (const [k, v] of aiCache) if (Date.now() - v.at > CACHE_MS) aiCache.delete(k);
    }
    aiCache.set(key, { at: Date.now(), text });
    try {
      const u = res.usage;
      console.log('[CACHE inquiry-alerts]', `in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`);
    } catch {}
    return { text, cached: false };
  } catch (err) {
    // API の失敗で画面を止めない。ルールのチップだけで表示する。
    try { console.log('[inquiry-alerts] ai failed', err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : String(err)); } catch {}
    return null;
  }
}

export async function GET(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (!canUseInquiryBoard(session.campus)) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const scope = (url.searchParams.get('campus') || ALL).trim() || ALL;
  const force = url.searchParams.get('refresh') === '1';

  const list = await listRecords();
  if (!list.ok) return Response.json({ ok: false, reason: list.reason });

  const rows = scope === ALL ? list.items : list.items.filter((r) => r.campus === scope);
  const { y, m, d } = jstDate(new Date());
  const today = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // 目標（秋～冬行動計画）。読めなくてもアラートは動く
  const goals = await listGoals();
  const facts = buildFacts(rows, scope, today, goals.ok ? goals.rows : []);
  const alerts: Alert[] = ruleAlerts(facts);

  const key = factsFingerprint(rows, scope, today) + (goals.ok ? `|g${goals.rows.length}` : '');
  if (force) aiCache.delete(key);
  const ai = rows.length ? await aiComment(facts, key) : null;

  return Response.json({
    ok: true,
    facts,
    alerts,
    ai,
    aiAvailable: !!process.env.ANTHROPIC_API_KEY,
    goalsStatus: goals.ok ? 'ok' : goals.reason,
  });
}
