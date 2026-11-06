// 智翔館AI：社内ナレッジ（knowledge/）を調べて答える相談窓口。
//
// 流れ：会社の前提（COMPANY.md）＋回答方針（00_index/CLAUDE.md）＋索引（00_index/INDEX.md）を渡し、
// AIが read_file / grep_knowledge / list_dir で必要な資料だけを読んで答える（lib/chishokanAi/knowledgeTools.ts）。
// 添付（PDF・画像・テキスト。Word・Excel・PowerPoint は画面側で文字にしてから送る）は今回の質問にだけ付ける。
// 質問に Google ドライブのリンクがあれば、Apps Script で中身を読んで一緒に渡す（読めるフォルダは限定。lib/chishokanAi/driveFiles.ts）。
// 試用中は使える人を絞っている（lib/chishokanAi/access.ts）。

import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getSession } from '@/lib/core/auth';
import { MODEL, THINKING } from '@/lib/systemPrompt';
import { logInteraction } from '@/lib/core/log';
import { sanitizeHistory, stripRoleBleed } from '@/lib/core/sanitize';
import { canUseChishokanAi } from '@/lib/chishokanAi/access';
import { buildChishokanAiPrompt } from '@/lib/chishokanAi/prompt';
import { KNOWLEDGE_ROOT, KNOWLEDGE_TOOLS, runKnowledgeTool } from '@/lib/chishokanAi/knowledgeTools';
import { readDriveLinks, runDriveTool, type DriveRead } from '@/lib/chishokanAi/driveFiles';
import { DRIVE_TOOLS } from '@/lib/chishokanAi/driveTools';
import { CREATE_DOC_TOOL } from '@/lib/chishokanAi/createDocTool';
import { runCreateDoc, type CreatedDoc } from '@/lib/chishokanAi/createDoc';

const STOP = ['\n\nus', '\n\nUs', '\n\nassistant', '\n\nAssistant', '\n\nhuman', '\n\nHuman'];

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new Anthropic();

// ツールを使う往復の上限。60秒の制限に収めるため、時間でも打ち切る（最後の1回はツール無しで答えさせる）。
const MAX_ROUNDS = 6;
const MAX_TOOL_CALLS = 10;
const TIME_BUDGET_MS = 40_000;

type Msg = { role: 'user' | 'assistant'; content: string };
type Attach = { name: string; mime: string; kind: 'pdf' | 'image' | 'text'; data: string };

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// 添付を Claude のコンテンツブロックへ変換する（会議AI /api/chat と同じ扱い）。
function attachBlocks(atts: Attach[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const a of atts) {
    if (!a || typeof a.data !== 'string' || !a.data) continue;
    if (a.kind === 'pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } });
    } else if (a.kind === 'image' && IMAGE_MIMES.includes(a.mime)) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mime as 'image/jpeg', data: a.data } });
    } else if (a.kind === 'text') {
      blocks.push({ type: 'text', text: `【添付ファイル：${a.name}】\n${a.data}` });
    }
  }
  return blocks;
}

async function readText(p: string): Promise<string> {
  return fs.readFile(p, 'utf8').catch(() => '');
}

export async function POST(req: Request) {
  const requestStarted = Date.now();
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  if (!canUseChishokanAi(session.name)) return new Response('智翔館AIは試用中のため、まだ利用できません。', { status: 403 });

  const body = await req.json().catch(() => ({}));
  const raw: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  const messages = sanitizeHistory(raw) as Msg[];
  if (messages.length === 0) return new Response('messages required', { status: 400 });
  const attachments: Attach[] = Array.isArray(body?.attachments) ? body.attachments.slice(0, 5) : [];

  const root = path.join(process.cwd(), KNOWLEDGE_ROOT);
  const [policy, index] = await Promise.all([
    readText(path.join(root, '00_index', 'CLAUDE.md')),
    readText(path.join(root, '00_index', 'INDEX.md')),
  ]);

  // 最後の質問に Google ドライブのリンクがあれば読む（最大3件）。
  const lastUserText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const drive = await readDriveLinks(lastUserText);

  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: buildChishokanAiPrompt({ dept: session.campus, name: session.name, policy, index }),
      cache_control: { type: 'ephemeral' },
    },
  ];
  const convo: Anthropic.MessageParam[] = messages.map((m, i) =>
    i === messages.length - 1
      ? {
          role: m.role,
          content: [
            ...drive.blocks,
            ...attachBlocks(attachments),
            { type: 'text', text: m.content, cache_control: { type: 'ephemeral' } },
          ] as Anthropic.ContentBlockParam[],
        }
      : { role: m.role, content: m.content },
  );
  // 資料を読む3つの道具と、頼まれたときに Google ドキュメントの下書きを作る道具（1回の回答で1つまで）。
  const tools = [...KNOWLEDGE_TOOLS, ...DRIVE_TOOLS, CREATE_DOC_TOOL] as unknown as Anthropic.Tool[];
  const driveToolReads: DriveRead[] = [];

  const encoder = new TextEncoder();
  let full = '';
  const usage: string[] = [];
  const opened: string[] = [];
  const createdDocs: CreatedDoc[] = [];

  const rs = new ReadableStream<Uint8Array>({
    async start(controller) {
      // リンクの読み込みにかかった時間も含めて、60秒の制限に収める。
      const started = requestStarted;
      let toolCalls = 0;
      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const lastRound =
            round === MAX_ROUNDS - 1 || toolCalls >= MAX_TOOL_CALLS || Date.now() - started > TIME_BUDGET_MS;
          const stream = client.messages.stream({
            model: MODEL,
            max_tokens: 6000,
            thinking: THINKING,
            system,
            tools,
            tool_choice: lastRound ? { type: 'none' } : { type: 'auto' },
            messages: convo,
            stop_sequences: STOP,
          });
          let roundText = '';
          for await (const ev of stream) {
            if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
              // ツールを挟んで文章が続くときは、前の文章と段落を分ける。
              const piece = !roundText && full ? `\n\n${ev.delta.text}` : ev.delta.text;
              roundText += ev.delta.text;
              full += piece;
              controller.enqueue(encoder.encode(piece));
            }
          }
          const msg = await stream.finalMessage();
          const u = msg.usage;
          usage.push(`in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens}`);
          if (msg.stop_reason !== 'tool_use') break;

          convo.push({ role: 'assistant', content: msg.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const block of msg.content) {
            if (block.type !== 'tool_use') continue;
            toolCalls++;
            const input = (block.input ?? {}) as Record<string, unknown>;
            let out: string;
            if (toolCalls > MAX_TOOL_CALLS) {
              out = 'ツールの上限に達しました。ここまでにわかった範囲で答えてください。';
            } else if (block.name === 'list_drive_folder' || block.name === 'read_drive_file') {
              // ドライブを読むのは1回の回答で合わせて6回まで（60秒の制限に収めるため）
              if (driveToolReads.length >= 6) {
                out = 'ドライブの読み込みは1回の回答で6回までです。ここまでにわかった範囲で答えてください。';
              } else {
                const r = await runDriveTool(block.name, input);
                if (r.read) driveToolReads.push(r.read);
                out = r.text;
              }
            } else if (block.name === CREATE_DOC_TOOL.name) {
              if (createdDocs.length >= 1) {
                out = '文書は1回の回答で1つまでです。作った文書のURLを伝えてください。';
              } else {
                const r = await runCreateDoc(input, { campus: session.campus, user: session.name });
                createdDocs.push(r.created);
                out = r.toolResult;
              }
            } else {
              out = await runKnowledgeTool(root, block.name, input);
            }
            opened.push(block.name === CREATE_DOC_TOOL.name ? `create_google_doc:${String(input.title ?? '')}` : `${block.name}:${String(input.path ?? input.query ?? '')}`);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: out });
          }
          convo.push({ role: 'user', content: results });
        }
      } catch {
        controller.enqueue(encoder.encode('\n[エラーが発生しました。もう一度お試しください。]'));
      } finally {
        try {
          console.log('[chishokan-ai]', `rounds=${usage.length}`, usage.join(' | '), `tools=${opened.join(',')}`);
        } catch {}
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        const attachNote = attachments.length ? `（添付: ${attachments.map((a) => a.name).join('、')}）` : '';
        const allReads = [...drive.reads, ...driveToolReads];
        const driveNote = allReads.length
          ? `（ドライブ: ${allReads.map((r) => `${r.name}${r.ok ? '' : `＝読めず:${r.note}`}`).join('、')}）`
          : '';
        const docNote = createdDocs.length
          ? `（作成した文書: ${createdDocs.map((d) => (d.ok ? `${d.title} ${d.url}` : `${d.title}＝作れず:${d.note}`)).join('、')}）`
          : '';
        try {
          await logInteraction({
            user: session.name,
            campus: session.campus,
            input: `[智翔館AI] ${lastUser?.content ?? ''}${attachNote}${driveNote}${docNote}\n（調べた資料: ${opened.join('、') || 'なし'}）`,
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
