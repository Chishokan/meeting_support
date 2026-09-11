import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/auth';
import { MODEL, THINKING } from '@/lib/systemPrompt';
import {
  buildDeptMinutesPrompt,
  buildDraftRequest,
  buildReviseRequest,
  type MeetingMeta,
} from '@/lib/deptMinutesPrompt';
import { logInteraction } from '@/lib/log';
import { stripRoleBleed } from '@/lib/sanitize';

// モデルが偽の user/assistant ターン（崩れた us/use/usb を含む）を書き始めたら即停止させる。
const STOP = ['\n\nus', '\n\nUs', '\n\nassistant', '\n\nAssistant', '\n\nhuman', '\n\nHuman'];

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new Anthropic();

// 1時間の会議でも文字起こしは数万字に収まるが、事故防止に上限を置く。
// 超えた分は切り捨てず、画面側に「長すぎる」と伝えて分割してもらう。
const MAX_TRANSCRIPT = 120000;

function readMeta(v: unknown): MeetingMeta {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    title: String(o.title ?? ''),
    date: String(o.date ?? ''),
    place: String(o.place ?? ''),
    attendees: String(o.attendees ?? ''),
    agenda: String(o.agenda ?? ''),
  };
}

// 会議の文字起こし → 議事録ドラフト（mode:'draft'）／修正指示の反映（mode:'revise'）。
// どちらもテキストをそのまま流し返す（画面側で逐次表示する）。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === 'revise' ? 'revise' : 'draft';
  const meta = readMeta(body?.meta);
  const transcript = String(body?.transcript ?? '').trim();
  if (!transcript) return new Response('transcript required', { status: 400 });
  if (transcript.length > MAX_TRANSCRIPT) return new Response('transcript too long', { status: 413 });

  const draft = String(body?.draft ?? '');
  const instruction = String(body?.instruction ?? '').trim();
  if (mode === 'revise' && !instruction) return new Response('instruction required', { status: 400 });

  const userText =
    mode === 'revise'
      ? buildReviseRequest(meta, transcript, draft, instruction)
      : buildDraftRequest(meta, transcript);

  const encoder = new TextEncoder();
  let full = '';
  let cacheLog = '';

  // プロンプトキャッシュ：議事録プロンプト（部門・担当で固定）にキャッシュポイントを置く。
  // 修正依頼を何度か往復しても、system 側は毎回キャッシュから読める。
  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: buildDeptMinutesPrompt(session.campus, session.name),
      cache_control: { type: 'ephemeral' },
    },
  ];

  const rs = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: MODEL,
          // 議事録＋会議の質チェックの2ブロック分。長い会議でも途中で切れないよう厚めに取る。
          max_tokens: 12000,
          thinking: THINKING,
          system,
          messages: [{ role: 'user', content: userText }],
          stop_sequences: STOP,
        });
        for await (const ev of stream) {
          if (ev.type === 'message_start') {
            const u = ev.message.usage;
            cacheLog = `in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`;
          } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            full += ev.delta.text;
            controller.enqueue(encoder.encode(ev.delta.text));
          }
        }
      } catch {
        controller.enqueue(encoder.encode('\n[エラーが発生しました。もう一度お試しください。]'));
      } finally {
        if (cacheLog) {
          try {
            console.log('[CACHE dept-minutes]', cacheLog);
          } catch {}
        }
        try {
          // 文字起こし全文はログに残さない（長すぎるうえ、会話の生データが二重に溜まるため）。
          await logInteraction({
            user: session.name,
            campus: session.campus,
            input: `[部門会議議事録/${mode}] ${meta.title || '（会議名未入力）'}｜文字起こし${transcript.length}字${instruction ? `｜修正指示：${instruction}` : ''}`,
            output: stripRoleBleed(full),
          });
        } catch {}
        controller.close();
      }
    },
  });

  return new Response(rs, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
