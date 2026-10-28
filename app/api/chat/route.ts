import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/core/auth';
import { buildSystemPrompt, MODEL, THINKING } from '@/lib/systemPrompt';
import { buildSeasonPrompt } from '@/lib/seasonPrompt';
import { buildMonthlyPrompt } from '@/lib/monthlyPrompt';
import { listNumbers } from '@/lib/numbersStore';
import {
  NUMBER_FORMS,
  defaultPeriod,
  formatEntries,
  latestByCampus,
  recentEntries,
  type ReportKind,
} from '@/lib/numberReports';
import { logInteraction } from '@/lib/core/log';
import { sanitizeHistory, stripRoleBleed } from '@/lib/core/sanitize';

// モデルが偽の user/assistant ターン（崩れた us/use/usb を含む）を書き始めたら即停止させる。
const STOP = ['\n\nus', '\n\nUs', '\n\nassistant', '\n\nAssistant', '\n\nhuman', '\n\nHuman'];

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new Anthropic();

type Msg = { role: 'user' | 'assistant'; content: string };

// 会議AIのモード。meeting＝通常の事前報告 / monthly＝月次報告 / season＝講習の結果報告（春期・夏期・冬期）。
type Mode = 'meeting' | ReportKind;

const LOG_PREFIX: Record<Mode, string> = { meeting: '', monthly: '[月次報告] ', season: '[講習結果] ' };

// 「数値報告」メニューの登録内容（自部門・直近の期間・期間×校舎ごとに最新1件）をプロンプト用の文字列にする。
async function numbersFor(kind: ReportKind, dept: string): Promise<string> {
  const r = await listNumbers(kind, dept);
  return formatEntries(NUMBER_FORMS[kind], recentEntries(kind, latestByCampus(r.items)));
}

function buildPrompt(mode: Mode, dept: string, name: string, numbersText: string): string {
  if (mode === 'monthly') return buildMonthlyPrompt(dept, name, numbersText, defaultPeriod('monthly'));
  if (mode === 'season') return buildSeasonPrompt(dept, name, numbersText, defaultPeriod('season'));
  return buildSystemPrompt(dept, name);
}

// 添付ファイル（PDF/画像はネイティブ対応、テキスト系は本文として渡す）
type Attach = { name: string; mime: string; kind: 'pdf' | 'image' | 'text'; data: string };

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// 添付を Claude のコンテンツブロックへ変換する（PDF・画像はテキストより前に置く）。
function attachBlocks(atts: Attach[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const a of atts) {
    if (!a || typeof a.data !== 'string' || !a.data) continue;
    if (a.kind === 'pdf') {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: a.data },
      });
    } else if (a.kind === 'image' && IMAGE_MIMES.includes(a.mime)) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: a.mime as 'image/jpeg', data: a.data },
      });
    } else if (a.kind === 'text') {
      blocks.push({ type: 'text', text: `【添付ファイル：${a.name}】\n${a.data}` });
    }
  }
  return blocks;
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  // 役割漏れ・空メッセージを除去（既に汚れた履歴が送られても自己対話ループを断つ）。
  const messages = sanitizeHistory(raw) as Msg[];
  if (messages.length === 0) return new Response('messages required', { status: 400 });
  // 旧「夏の結果報告」（summer）は講習の結果報告に統合した。古い画面から来ても動くように読み替える。
  const rawMode = body?.mode === 'summer' ? 'season' : body?.mode;
  const mode: Mode = rawMode === 'monthly' || rawMode === 'season' ? rawMode : 'meeting';

  // 月次報告・講習の結果報告では「数値報告」メニューの登録内容をプロンプトへ差し込む
  // （毎ターン最新を取りに行くので、会話の途中で登録されても次の発言から反映される）。
  const numbersText = mode === 'meeting' ? '' : await numbersFor(mode, session.campus);

  const encoder = new TextEncoder();
  let full = '';
  let cacheLog = '';

  // プロンプトキャッシュ：システムプロンプト（同一セッション内で固定）と直近メッセージに
  // キャッシュポイントを置き、毎ターンの「システム＋全履歴」再送コストを抑える。
  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: buildPrompt(mode, session.campus, session.name, numbersText),
      cache_control: { type: 'ephemeral' },
    },
  ];
  // 添付は「今回のターン」にのみ付与する（履歴には残さない＝端末保存を軽く保つ）。
  const attachments: Attach[] = Array.isArray(body?.attachments) ? body.attachments.slice(0, 5) : [];
  const cachedMessages: Anthropic.MessageParam[] = messages.map((m, i) =>
    i === messages.length - 1
      ? {
          role: m.role,
          content: [
            ...attachBlocks(attachments),
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
          // Sonnet 5 はトークナイザが変わり、同じ日本語テキストで約1.3倍のトークンを使う。
          // 旧 4000 のままだと「貼り付け用：事前報告」の途中で切れうるため引き上げる。
          max_tokens: 6000,
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
            console.log(`[CACHE chat:${mode}]`, cacheLog);
          } catch {}
        }
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        try {
          await logInteraction({
            user: session.name,
            campus: session.campus,
            input: `${LOG_PREFIX[mode]}${lastUser?.content ?? ''}`,
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
