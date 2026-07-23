import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/auth';
import { buildProgressPrompt } from '@/lib/progressPrompt';
import { MODEL } from '@/lib/systemPrompt';
import { logInteraction } from '@/lib/log';
import { sanitizeHistory, stripRoleBleed } from '@/lib/sanitize';

// モデルが偽の user/assistant ターン（崩れた us/use/usb を含む）を書き始めたら即停止させる。
const STOP = ['\n\nus', '\n\nUs', '\n\nassistant', '\n\nAssistant', '\n\nhuman', '\n\nHuman'];

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new Anthropic();

type Msg = { role: 'user' | 'assistant'; content: string };

// 管理部門が保存した「この部門の定例項目」を GAS から取得する。未設定・失敗時は null（＝初期値を使う）。
async function fetchSavedItems(campus: string): Promise<string[] | null> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getProgressItems', token: process.env.APPS_SCRIPT_TOKEN || '' }),
    });
    const j = await res.json().catch(() => null);
    const map = j && j.ok && j.items && typeof j.items === 'object' ? (j.items as Record<string, unknown>) : null;
    const arr = map && Array.isArray(map[campus]) ? (map[campus] as unknown[]) : null;
    return arr ? arr.map((s) => String(s)) : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  // 役割漏れ・空メッセージを除去（既に汚れた履歴が送られても自己対話ループを断つ）。
  const messages = sanitizeHistory(raw) as Msg[];
  if (messages.length === 0) return new Response('messages required', { status: 400 });

  const encoder = new TextEncoder();
  let full = '';
  let cacheLog = '';

  // プロンプトキャッシュ：システムプロンプト（同一セッション内で固定）と直近メッセージに
  // キャッシュポイントを置き、毎ターンの「システム＋全履歴」再送コストを抑える。
  const savedItems = await fetchSavedItems(session.campus);
  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: buildProgressPrompt(session.campus, session.name, savedItems),
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
          max_tokens: 4000,
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
            console.log('[CACHE progress]', cacheLog);
          } catch {}
        }
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        try {
          await logInteraction({
            user: session.name,
            campus: session.campus,
            input: lastUser?.content ?? '',
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
