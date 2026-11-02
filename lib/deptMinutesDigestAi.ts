// 議事録を「社長送付用の1枚まとめ」（DigestBody）に要約する。サーバ専用。
// 呼び出し元: app/api/dept-minutes/digest/route.ts
// 整形・検査は lib/deptMinutesDigest.ts（AI の出力はそのまま信用せず normalizeDigest を通す）。

import Anthropic from '@anthropic-ai/sdk';
import { withCompanyKnowledge } from './core/companyKnowledge';
import { MODEL, THINKING } from './systemPrompt';
import { normalizeDigest, UNKNOWN, type DigestBody, type DigestInput } from './deptMinutesDigest';

const client = new Anthropic();

const TOOL_NAME = 'submit_digest';

const DIGEST_SYSTEM = `
あなたは「株式会社智翔館」の部門会議の議事録を、社長に送る「A4 1枚のまとめ」に整える役です。
読むのは社長。忙しい中で、その会議で何が決まり、誰がいつまでに何をするか、どこに抜けがあるかを1分でつかめるようにする。

【絶対のルール】
- 議事録に書かれていることだけを使う。推測で人・数字・日付を足さない。
- 決定事項と ToDo は、議事録にあるものを落とさない（似たものをまとめすぎない）。そのかわり1件ずつ短く書く。
- 担当・期限が議事録で決まっていない、または【要確認】になっているものは「${UNKNOWN}」と書く。空欄にしない。
  ただし議事録に担当・期限の欄そのものが無い項目は空文字でよい。
- 生徒・保護者の氏名は書かない。「対象生徒8名」「外部生」「中3の1名」のように人数や立場で書く。
  職員（先生・スタッフ）の名前は議事録の表記のまま書く。
- 文字起こしの明らかな誤変換（例：「後頭部」→「高等部」、「中頭部」→「中等部」）は直してよい。人名は直さない。
- 文体は常体。体言止めでよい。敬語・前置き・感想は書かない。

【各項目の書き方】
- purpose: 会議の目的が議事録にはっきり書かれていれば1文（60字以内）。無ければ空文字。
- summary: その会議の要点。何を確認し、何を決めたか。120〜160字。
- decisions: 決定事項。title は件名（20字前後）、detail は内容と理由を1〜2文（80字以内）。
- todos: ToDo。task は何をするか（40字以内）。議事録で [〇] なら status を "done"、[✕] なら "not_done"、それ以外は ""。
- pending: 継続審議・保留。「何が決まっていないか → 次にどうするか」を1項目60字以内で。
- reports: 報告・共有された事実（数字・状況）。1項目50字以内、多くても6項目。
- next: 次回会議の日時・場所と持ち越し議題を1文。決まっていなければ日時を「${UNKNOWN}」とする。
- checks: 社長が知っておくべき抜け・矛盾を最大3つ（各40字以内）。会議の質チェックの指摘や、
  担当・期限の未定、話し合えなかった議題、日付の矛盾、決定事項と ToDo の担当の食い違いなど。無ければ空配列。

まとめ終えたら、必ず ${TOOL_NAME} ツールを1回だけ呼んで提出する。本文には何も書かない。
`.trim();

const str = { type: 'string' } as const;

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: '議事録の1枚まとめを提出する。',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['purpose', 'summary', 'decisions', 'todos', 'pending', 'reports', 'next', 'checks'],
    properties: {
      purpose: str,
      summary: str,
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'detail', 'owner', 'due'],
          properties: { title: str, detail: str, owner: str, due: str },
        },
      },
      todos: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['task', 'owner', 'due', 'status'],
          properties: { task: str, owner: str, due: str, status: { type: 'string', enum: ['', 'done', 'not_done'] } },
        },
      },
      pending: { type: 'array', items: str },
      reports: { type: 'array', items: str },
      next: str,
      checks: { type: 'array', items: str },
    },
  },
};

function userContent(input: DigestInput): string {
  return [
    `【会議名】${input.title}`,
    `【部門】${input.campus}`,
    `【開催日時】${input.date}`,
    `【場所】${input.place}`,
    `【出席者】${input.attendees}`,
    input.agenda.trim() ? `【事前の議題（レジュメ）】\n${input.agenda.trim()}` : '',
    `【議事録】\n${input.minutes.trim()}`,
    input.quality.trim() ? `【会議の質チェック】\n${input.quality.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export type DigestAiResult = { ok: true; body: DigestBody } | { ok: false; reason: string };

export async function summarizeMinutes(input: DigestInput): Promise<DigestAiResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'ai_not_configured' };
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: THINKING,
      system: [{ type: 'text', text: withCompanyKnowledge(DIGEST_SYSTEM), cache_control: { type: 'ephemeral' } }],
      tools: [TOOL],
      // tool_choice は auto のまま。指名（type: 'tool'）は新しいモデルで使えないため、指示文で必ず呼ばせる。
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: userContent(input) }],
    });
    try {
      const u = res.usage;
      console.log('[minutes-digest]', `id=${input.id} stop=${res.stop_reason} in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens}`);
    } catch {}
    if (res.stop_reason === 'refusal') return { ok: false, reason: 'ai_refused' };
    if (res.stop_reason === 'max_tokens') return { ok: false, reason: 'ai_truncated' };
    const call = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME,
    );
    if (!call) return { ok: false, reason: 'ai_no_digest' };
    const body = normalizeDigest(call.input);
    return body ? { ok: true, body } : { ok: false, reason: 'ai_empty_digest' };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: 'ai_rate_limited' };
    if (err instanceof Anthropic.APIError) {
      console.log('[minutes-digest] ai failed', input.id, err.status, err.message);
      return { ok: false, reason: `ai_error_${err.status ?? 'unknown'}` };
    }
    console.log('[minutes-digest] ai failed', input.id, String(err));
    return { ok: false, reason: 'ai_network_error' };
  }
}
