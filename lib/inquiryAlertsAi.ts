// 「今日の注意点」の AI の一言（3行）を Claude に書かせる。サーバ専用。
//
// 生成は 1日1回・全体（「すべて」＋件数のある校舎）まとめて行い、その日は固定する。
//   - 定時：vercel.json の cron が /api/inquiry-board/alerts/daily を朝に叩く
//   - 保険：その日の分がまだ無いまま画面が開かれたら、最初の表示のときにまとめて生成して保存する
//     （cron が動かなかった日や、朝より前に開いた人のため。生成後はその日ずっと同じ文）
// 件数の計算はルール（lib/inquiryAlerts.ts）。AI には数えさせず、事実だけを渡して言葉にさせる。

import Anthropic from '@anthropic-ai/sdk';
import { BOARD_CAMPUSES, type InquiryRecord } from './inquiryRecords';
import { buildFacts, formatFactsForAi, type AlertFacts } from './inquiryAlerts';
import { withCompanyKnowledge } from './companyKnowledge';
import { MODEL, THINKING } from './systemPrompt';
import { nowJp } from './inquiryStore';
import { getAiNotes, saveAiNotes, type AiNote } from './aiNotesStore';
import type { GoalRow } from './goals';

export const ALL_SCOPE = 'すべて';

const client = new Anthropic();

const AI_SYSTEM = `
あなたは「株式会社智翔館 小中等部 問合せ管理」の画面上部に出る短い注意喚起を書く役です。
読むのは校舎の担当者。朝いちばんに画面を開いて、今日まず何をすべきかを3秒で判断できるようにする。
この文は1日1回だけ生成され、その日は書き換わらない。今日一日の行動指針として書く。

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

export function aiAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

async function aiComment(facts: AlertFacts): Promise<string | null> {
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
    try {
      const u = res.usage;
      console.log('[CACHE inquiry-alerts]', `scope=${facts.scope} in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`);
    } catch {}
    return text || null;
  } catch (err) {
    try { console.log('[inquiry-alerts] ai failed', facts.scope, err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : String(err)); } catch {}
    return null;
  }
}

/** 生成対象：「すべて」＋台帳に件数のある校舎。 */
export function scopesFor(rows: InquiryRecord[]): string[] {
  const out = [ALL_SCOPE];
  for (const c of BOARD_CAMPUSES) if (rows.some((r) => r.campus === c)) out.push(c);
  return out;
}

export type GenerateResult = { date: string; generated: string[]; failed: string[]; saved: boolean; saveReason?: string };

/** 指定の対象ぶんをまとめて生成し、保存する。 */
export async function generateNotes(rows: InquiryRecord[], goals: GoalRow[], today: string, scopes: string[]): Promise<{ notes: AiNote[]; result: GenerateResult }> {
  const generatedAt = nowJp();
  const notes: AiNote[] = [];
  const failed: string[] = [];
  const one = async (scope: string) => {
    const scoped = scope === ALL_SCOPE ? rows : rows.filter((r) => r.campus === scope);
    const text = scoped.length ? await aiComment(buildFacts(scoped, scope, today, goals)) : null;
    if (text) notes.push({ date: today, scope, text, generatedAt });
    else failed.push(scope);
  };
  // 最初の1件で会社情報のプロンプトキャッシュを作り、残りは並列で書かせる（時間と API 代の両方を抑える）
  if (scopes.length) await one(scopes[0]);
  await Promise.all(scopes.slice(1).map(one));

  const saved = await saveAiNotes(notes);
  return {
    notes,
    result: { date: today, generated: notes.map((n) => n.scope), failed, saved: saved.ok, ...(saved.ok ? {} : { saveReason: saved.reason }) },
  };
}

// 同じ関数インスタンス内で同時に開かれたときに二重生成しないための合流点
let inflight: { date: string; p: Promise<AiNote[]> } | null = null;
// 保存済みの一言はその日じゅう変わらないので、インスタンス内では取り直さない
let memo: { date: string; notes: AiNote[]; fetchedAt: number } | null = null;
const MEMO_MS = 10 * 60 * 1000;
// 生成に失敗したら、このインスタンスではしばらく再挑戦しない（画面を開くたびに API を叩き続けないため）
let lastFail: { date: string; at: number } | null = null;
const RETRY_MS = 5 * 60 * 1000;

/**
 * その日の一言を返す。まだ無い対象があれば、このタイミングでまとめて生成して保存する。
 * 生成済みの対象は保存された文をそのまま返す（＝その日は変わらない）。
 */
export async function ensureDailyNotes(rows: InquiryRecord[], goals: GoalRow[], today: string): Promise<AiNote[]> {
  if (!aiAvailable()) return [];
  if (inflight && inflight.date === today) return inflight.p;

  const p = (async () => {
    let stored: AiNote[] = [];
    if (memo && memo.date === today && Date.now() - memo.fetchedAt < MEMO_MS) {
      stored = memo.notes;
    } else {
      const got = await getAiNotes(today);
      if (!got.ok) {
        // 保存先が読めないときは生成しない（読めないのに書くと、日に何度も生成してしまう）
        try { console.log('[inquiry-alerts] notes unavailable', got.reason); } catch {}
        return memo && memo.date === today ? memo.notes : [];
      }
      stored = got.notes;
    }
    const have = new Set(stored.map((n) => n.scope));
    const missing = scopesFor(rows).filter((s) => !have.has(s));
    let notes = stored;
    const coolingDown = lastFail && lastFail.date === today && Date.now() - lastFail.at < RETRY_MS;
    if (missing.length && !coolingDown) {
      const g = await generateNotes(rows, goals, today, missing);
      notes = stored.concat(g.notes);
      lastFail = g.result.failed.length || !g.result.saved ? { date: today, at: Date.now() } : null;
    }
    memo = { date: today, notes, fetchedAt: Date.now() };
    return notes;
  })();

  inflight = { date: today, p };
  try {
    return await p;
  } finally {
    if (inflight && inflight.p === p) inflight = null;
  }
}

/** 定時実行用：その日の分を全対象まとめて生成する。既にあれば何もしない（force で作り直し）。 */
export async function runDaily(rows: InquiryRecord[], goals: GoalRow[], today: string, force = false): Promise<GenerateResult & { skipped: string[] }> {
  const scopes = scopesFor(rows);
  let skipped: string[] = [];
  let target = scopes;
  if (!force) {
    const got = await getAiNotes(today);
    if (got.ok) {
      const have = new Set(got.notes.map((n) => n.scope));
      skipped = scopes.filter((s) => have.has(s));
      target = scopes.filter((s) => !have.has(s));
    }
  }
  if (!target.length) return { date: today, generated: [], failed: [], saved: true, skipped };
  const g = await generateNotes(rows, goals, today, target);
  memo = null;
  return { ...g.result, skipped };
}
