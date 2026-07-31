// 相談AI 共通エンジン（P1 生成型 24業務ぶんを、このルート1本で処理する）。
// 業務ごとの違いは templateId → lib/consultTemplates.ts の定義データだけで表現する。
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/auth';
import { findTemplate } from '@/lib/consultTemplates';
import { buildConsultPrompt } from '@/lib/consultPrompt';
import { MODEL, THINKING } from '@/lib/systemPrompt';
import { logInteraction } from '@/lib/log';
import { sanitizeHistory, stripRoleBleed } from '@/lib/sanitize';

// モデルが偽の user/assistant ターン（崩れた us/use/usb を含む）を書き始めたら即停止させる。
const STOP = ['\n\nus', '\n\nUs', '\n\nassistant', '\n\nAssistant', '\n\nhuman', '\n\nHuman'];

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new Anthropic();

type Msg = { role: 'user' | 'assistant'; content: string };

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });

  const body = await req.json().catch(() => ({}));
  const templateId = typeof body?.templateId === 'string' ? body.templateId : '';
  const template = findTemplate(templateId);
  if (!template) return new Response('unknown template', { status: 400 });

  const raw: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  // 役割漏れ・空メッセージを除去（既に汚れた履歴が送られても自己対話ループを断つ）。
  const messages = sanitizeHistory(raw) as Msg[];
  if (messages.length === 0) return new Response('messages required', { status: 400 });

  const encoder = new TextEncoder();
  let full = '';
  let cacheLog = '';

  // プロンプトキャッシュ：システムプロンプト（同一テンプレート内で固定）と直近メッセージに
  // キャッシュポイントを置き、毎ターンの「システム＋全履歴」再送コストを抑える。
  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: buildConsultPrompt(template, session.campus, session.name),
      cache_control: { type: 'ephemeral' },
    },
  ];
  const cachedMessages: Anthropic.MessageParam[] = messages.map((m, i) =>
    i === messages.length - 1
      ? {
          role: m.role,
          content: [
            { type: 'text', text: m.content, cache_control: { type: 'ephemeral' } },
          ] as Anthropic.ContentBlockParam[],
        }
      : { role: m.role, content: m.content },
  );

  const rs = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: MODEL,
          // 提案書など長い成果物を1回で出し切るため、対話系ルートより広く取る。
          // Sonnet 5 はトークナイザが変わり同じ日本語で約1.3倍のトークンを使うので、その分も上乗せ。
          max_tokens: 12000,
          thinking: THINKING,
          system,
          messages: cachedMessages,
          stop_sequences: STOP,
        });
        for await (const ev of stream) {
          if (ev.type === 'message_start') {
            const u = ev.message.usage;
            cacheLog = `tpl=${template.id} in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`;
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
            console.log('[CACHE consult]', cacheLog);
          } catch {}
        }
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        try {
          // ログのスプレッドではどの業務の相談かを追えるよう、先頭にテンプレート名を付ける。
          await logInteraction({
            user: session.name,
            campus: session.campus,
            input: `[相談AI ${template.id} ${template.title}]\n${lastUser?.content ?? ''}`,
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
