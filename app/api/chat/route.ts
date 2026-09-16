import type Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/auth';
import { buildSystemPrompt } from '@/lib/systemPrompt';
import { buildSummerPrompt } from '@/lib/summerPrompt';
import { listNumbers } from '@/lib/numbersStore';
import { formatEntries, latestByCampus } from '@/lib/summerNumbers';
import { sanitizeHistory } from '@/lib/sanitize';
import { cachedMessages, lastUserText, streamClaude, type Msg } from '@/lib/claudeStream';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 会議AIのモード。meeting＝通常の事前報告 / summer＝夏の結果報告（計画確認なし）。
type Mode = 'meeting' | 'summer';

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
  const mode: Mode = body?.mode === 'summer' ? 'summer' : 'meeting';

  // 夏の結果報告では「数値報告」メニューの登録内容をプロンプトへ差し込む
  // （毎ターン最新を取りに行くので、会話の途中で登録されても次の発言から反映される）。
  const numbersText =
    mode === 'summer' ? formatEntries(latestByCampus(await listNumbers(session.campus))) : '';

  // 添付は「今回のターン」にのみ付与する（履歴には残さない＝端末保存を軽く保つ）。
  const attachments: Attach[] = Array.isArray(body?.attachments) ? body.attachments.slice(0, 5) : [];

  return streamClaude({
    label: `chat:${mode}`,
    system:
      mode === 'summer'
        ? buildSummerPrompt(session.campus, session.name, numbersText)
        : buildSystemPrompt(session.campus, session.name),
    messages: cachedMessages(messages, attachBlocks(attachments)),
    // Sonnet 5 はトークナイザが変わり、同じ日本語テキストで約1.3倍のトークンを使う。
    // 旧 4000 のままだと「貼り付け用：事前報告」の途中で切れうるため引き上げる。
    maxTokens: 6000,
    log: {
      user: session.name,
      campus: session.campus,
      input: mode === 'summer' ? `[夏期結果] ${lastUserText(messages)}` : lastUserText(messages),
    },
  });
}
