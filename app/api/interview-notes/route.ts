import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/core/auth';
import { MODEL, THINKING } from '@/lib/systemPrompt';
import {
  buildInterviewDraftRequest,
  buildInterviewPrompt,
  buildInterviewReviseRequest,
  readInterviewMeta,
} from '@/lib/interviewNotes/prompt';
import { logInteraction } from '@/lib/core/log';

// モデルが偽の user/assistant ターンを書き始めたら即停止させる（部門会議議事録と同じ）。
const STOP = ['\n\nus', '\n\nUs', '\n\nassistant', '\n\nAssistant', '\n\nhuman', '\n\nHuman'];

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new Anthropic();

// 面談は長くても1時間程度。事故防止に上限を置き、超えたら画面に「長すぎる」と伝える。
const MAX_TRANSCRIPT = 120000;

// 面談の文字起こし → 面談記録（mode:'draft'）／修正指示の反映（mode:'revise'）。
// どちらもテキストをそのまま流し返す（画面側で逐次表示する）。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === 'revise' ? 'revise' : 'draft';
  const meta = readInterviewMeta(body?.meta);
  const transcript = String(body?.transcript ?? '').trim();
  const memo = String(body?.memo ?? '').trim();
  if (transcript.length + memo.length > MAX_TRANSCRIPT) {
    return new Response('transcript too long', { status: 413 });
  }

  const draft = String(body?.draft ?? '');
  const instruction = String(body?.instruction ?? '').trim();
  if (mode === 'revise') {
    if (!instruction) return new Response('instruction required', { status: 400 });
    if (!draft.trim()) return new Response('draft required', { status: 400 });
  } else if (!transcript && !memo) {
    return new Response('transcript or memo required', { status: 400 });
  }

  const userText =
    mode === 'revise'
      ? buildInterviewReviseRequest(meta, transcript, draft, instruction, memo)
      : buildInterviewDraftRequest(meta, transcript, memo);

  const encoder = new TextEncoder();
  let outLen = 0;
  let cacheLog = '';

  // プロンプトキャッシュ：面談記録プロンプト（部門・担当で固定）にキャッシュポイントを置く。
  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: buildInterviewPrompt(session.campus, session.name),
      cache_control: { type: 'ephemeral' },
    },
  ];

  const rs = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 10000,
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
            outLen += ev.delta.text.length;
            controller.enqueue(encoder.encode(ev.delta.text));
          }
        }
      } catch {
        controller.enqueue(encoder.encode('\n[エラーが発生しました。もう一度お試しください。]'));
      } finally {
        if (cacheLog) {
          try {
            console.log('[CACHE interview-notes]', cacheLog);
          } catch {}
        }
        try {
          // 面談記録は生徒・保護者の個人的な事情を含むので、会話ログ（全社共通のシート）には
          // 生徒名・文字起こし・出力本文を残さない。使われた事実と分量だけを残す。
          await logInteraction({
            user: session.name,
            campus: session.campus,
            input: `[面談記録/${mode}] ${meta.kind || '（種類未入力）'}｜文字起こし${transcript.length}字${memo ? `｜メモ${memo.length}字` : ''}${instruction ? '｜修正指示あり' : ''}`,
            output: `（面談記録の本文は記録しない／${outLen}字）`,
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
