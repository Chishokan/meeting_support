import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/core/auth';
import { logInteraction } from '@/lib/core/log';
import { stripRoleBleed } from '@/lib/core/sanitize';
import { MODEL, THINKING } from '@/lib/systemPrompt';
import {
  cleanHistory, cleanPlan, COACH_DEPT, COACH_SCHOOLS, evaluationText, extractJson, isValidItem, planDates,
} from '@/lib/taskCoach';
import { buildCoachPrompt, buildPlanPrompt } from '@/lib/taskCoachPrompt';
import { getEvaluation } from '@/lib/taskCoachStore';

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new Anthropic();

// モデルが偽の user/assistant ターンを書き始めたら止める（会議AIと同じ）。
const STOP = ['\n\nus', '\n\nUs', '\n\nassistant', '\n\nAssistant', '\n\nhuman', '\n\nHuman'];

// AI壁打ち（/task-coach）。小中等部の人だけが使える。
//   action:'chat' … 評価シートの校舎タブを読んだうえで、選んだ項目について会話する（文字を少しずつ返す）
//   action:'plan' … ここまでの会話から「行動計画の案」（日付・区分・行動）を JSON で返す
export async function POST(req: Request) {
  const s = getSession();
  if (!s) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (s.campus !== COACH_DEPT) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const school = String(body?.school ?? '');
  if (!COACH_SCHOOLS.includes(school)) return Response.json({ ok: false, reason: 'bad_school' }, { status: 400 });
  const isPlan = body?.action === 'plan';
  const messages = cleanHistory(body?.messages);
  // 会話を続けるときは最後が担当の発言、案を作るときは AI の返事まで含めた会話を使う。
  if (!messages.length || (!isPlan && messages[messages.length - 1].role !== 'user')) {
    return Response.json({ ok: false, reason: 'bad_messages' }, { status: 400 });
  }

  const r = await getEvaluation(school);
  if (!r.ok) return Response.json(r, { status: 502 });
  const item = String(body?.item ?? 'all');
  if (!isValidItem(r.evaluation, item)) return Response.json({ ok: false, reason: 'bad_item' }, { status: 400 });
  const dates = planDates();

  if (isPlan) {
    const transcript = messages.map((m) => `${m.role === 'user' ? '担当' : 'AI'}：${m.content}`).join('\n\n');
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 3000,
        thinking: THINKING,
        system: buildPlanPrompt(dates),
        messages: [{ role: 'user', content: `【会話】\n${transcript}\n\n上の会話から行動計画の案を JSON で出してください。` }],
      });
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      const plan = cleanPlan(extractJson(text), dates.map((d) => d.value), false);
      return Response.json(plan, { status: plan.ok ? 200 : 422 });
    } catch {
      return Response.json({ ok: false, reason: 'ai_error' }, { status: 502 });
    }
  }

  // 評価の内容は同じ校舎・項目なら毎回同じ文になるので、システムプロンプトと直近の発言に
  // キャッシュの印を付けて、往復のたびに全文を送り直す費用を抑える。
  const system: Anthropic.TextBlockParam[] = [{
    type: 'text',
    text: buildCoachPrompt(school, s.name, evaluationText(r.evaluation, item), dates),
    cache_control: { type: 'ephemeral' },
  }];
  const cached: Anthropic.MessageParam[] = messages.map((m, i) =>
    i === messages.length - 1
      ? { role: m.role, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] }
      : { role: m.role, content: m.content });

  const encoder = new TextEncoder();
  let full = '';
  const rs = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: MODEL, max_tokens: 3000, thinking: THINKING, system, messages: cached, stop_sequences: STOP,
        });
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            full += ev.delta.text;
            controller.enqueue(encoder.encode(ev.delta.text));
          }
        }
      } catch {
        controller.enqueue(encoder.encode('\n[エラーが発生しました。もう一度お試しください。]'));
      } finally {
        try {
          await logInteraction({
            user: s.name, campus: s.campus,
            input: `[AI壁打ち ${school}・${item === 'all' ? '全体' : r.evaluation.actions[Number(item)].name}] ${messages[messages.length - 1].content}`,
            output: stripRoleBleed(full),
          });
        } catch {}
        controller.close();
      }
    },
  });
  return new Response(rs, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
