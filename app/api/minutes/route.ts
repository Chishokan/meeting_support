import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/auth';
import { MODEL } from '@/lib/systemPrompt';
import { buildMinutesPrompt } from '@/lib/minutesPrompt';
import { logInteraction } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new Anthropic();

type Msg = { role: 'user' | 'assistant'; content: string };

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });

  const body = await req.json().catch(() => ({}));
  const messages: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0) return new Response('messages required', { status: 400 });

  const encoder = new TextEncoder();
  let full = '';

  const rs = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 4000,
          system: buildMinutesPrompt(session.campus, session.name),
          messages,
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
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        try {
          await logInteraction({
            user: session.name,
            campus: session.campus,
            input: `[議事録] ${lastUser?.content ?? ''}`,
            output: full,
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
