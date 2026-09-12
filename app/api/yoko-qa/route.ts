import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/auth';
import { MODEL, THINKING } from '@/lib/systemPrompt';
import { buildYokoQaPrompt } from '@/lib/yokoQaPrompt';
import { loadYokoDocs, confirmedDocs, formatDocs, formatIndex } from '@/lib/knowledgeDocs';
import { buildCards, docPeriod } from '@/lib/yokoCards';
import { logInteraction } from '@/lib/log';
import { sanitizeHistory, stripRoleBleed } from '@/lib/sanitize';

const STOP = ['\n\nus', '\n\nUs', '\n\nassistant', '\n\nAssistant', '\n\nhuman', '\n\nHuman'];

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new Anthropic();

type Msg = { role: 'user' | 'assistant'; content: string };

// 要項は全社員が保護者対応で使うものなので、部門を限定しない（個人情報を含まない）。

// 一覧・件数を返す（画面上部の表示用）。
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const docs = await loadYokoDocs();
  const confirmed = confirmedDocs(docs);

  // 日程が読めない要項はカードに出しようがない。件数だけ返して画面で知らせる
  // （要項側の「日程：」が空のまま確定されている、という現場の修正点になる）。
  const periodUnknown = confirmed.filter((d) => !docPeriod(d.body).start).length;

  return Response.json({
    ok: true,
    cards: buildCards(confirmed),
    periodUnknown,
    confirmed: confirmed.map((d) => ({ title: d.title, updated: d.updated, owner: d.owner })),
    pending: docs.filter((d) => d.status !== '確定').map((d) => ({ title: d.title })),
    total: docs.length,
  });
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  const messages = sanitizeHistory(raw) as Msg[];
  if (messages.length === 0) return new Response('messages required', { status: 400 });

  const all = await loadYokoDocs();
  const confirmed = confirmedDocs(all);
  const pending = all.filter((d) => d.status !== '確定');

  const systemText = buildYokoQaPrompt({
    dept: session.campus,
    name: session.name,
    docsText: formatDocs(confirmed),
    pendingText: formatIndex(pending),
  });

  const encoder = new TextEncoder();
  let full = '';
  let cacheLog = '';

  // 要項はデプロイ間で変わらないので、システム側のキャッシュがよく効く。
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } },
  ];
  const cachedMessages: Anthropic.MessageParam[] = messages.map((m, i) =>
    i === messages.length - 1
      ? { role: m.role, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] }
      : { role: m.role, content: m.content },
  );

  const rs = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 4000,
          thinking: THINKING,
          system,
          messages: cachedMessages,
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
            console.log('[CACHE yoko-qa]', cacheLog, `confirmed=${confirmed.length}/${all.length}`);
          } catch {}
        }
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        try {
          await logInteraction({
            user: session.name,
            campus: session.campus,
            input: `[要項QA] ${lastUser?.content ?? ''}`,
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
