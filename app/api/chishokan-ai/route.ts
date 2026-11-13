// 智翔館AI：社内ナレッジ（knowledge/）を調べて答える相談窓口。
//
// 流れ：会社の前提（COMPANY.md）＋回答方針（00_index/CLAUDE.md）＋索引（00_index/INDEX.md）を渡し、
// AIが read_file / grep_knowledge / list_dir で必要な資料だけを読んで答える（lib/chishokanAi/knowledgeTools.ts）。
// 添付（PDF・画像・テキスト。Word・Excel・PowerPoint は画面側で文字にしてから送る）は今回の質問にだけ付ける。
// 質問に Google ドライブのリンクがあれば、Apps Script で中身を読んで一緒に渡す（読めるフォルダは限定。lib/chishokanAi/driveFiles.ts）。
// 試用中は使える人を絞っている（lib/chishokanAi/access.ts）。
//
// 回答は 1行1つの JSON（NDJSON）で送る（決まりは lib/chishokanAi/conversation.ts）：
//   文章の断片、作業中の表示（📄 …を読んでいます）、読んだ資料、次の質問に持ち越す資料、出典の注意、途中で切れた知らせ。
// 会話の持ち越し：画面が覚えている「前に読んだナレッジのパス」と「文字にした資料」を受け取り、ナレッジは読み直して
// （確定していない要項などは読まない関門を通す）、今回の質問と一緒に AI に渡す。
// 作業の手順書（knowledge/05_作業/、lib/chishokanAi/tasks.ts）：画面の作業ボタンで選ばれたら手順書と資料を先に渡し、
// 文章で頼まれたときは AI が start_task で開く。資料づくりの回答は、埋め残しの {{ }} と「確認してほしいこと」の有無を確かめる。
// GET は画面の作業ボタンの一覧を返す。
// 停止：画面が通信を切ったら、AI への問い合わせも止める。時間切れ：300秒の制限の手前で止め、「途中で切れました」を送る。

import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getSession } from '@/lib/core/auth';
import { MODEL, THINKING } from '@/lib/systemPrompt';
import { logInteraction } from '@/lib/core/log';
import { sanitizeHistory, stripRoleBleed } from '@/lib/core/sanitize';
import { canUseChishokanAi } from '@/lib/chishokanAi/access';
import { buildChishokanAiPrompt } from '@/lib/chishokanAi/prompt';
import {
  KNOWLEDGE_ROOT,
  KNOWLEDGE_TOOLS,
  listAllowedFiles,
  readFileDetailed,
  runKnowledgeToolDetailed,
} from '@/lib/chishokanAi/knowledgeTools';
import { readDriveLinks, runDriveTool, type DriveRead, type DriveText } from '@/lib/chishokanAi/driveFiles';
import { extractDriveFolderIds, extractDriveIds } from '@/lib/chishokanAi/driveLinks';
import { DRIVE_TOOLS } from '@/lib/chishokanAi/driveTools';
import { CREATE_DOC_TOOL } from '@/lib/chishokanAi/createDocTool';
import { runCreateDoc, type CreatedDoc } from '@/lib/chishokanAi/createDoc';
import { CREATE_SLIDES_TOOL, SLIDES_TEMPLATES_TOOL } from '@/lib/chishokanAi/slidesTool';
import { runCreateSlides, runSlideTemplates } from '@/lib/chishokanAi/slides';
import { MATH_MATERIAL_TOOL } from '@/lib/chishokanAi/mathMaterialTool';
import { runCreateMathMaterial } from '@/lib/chishokanAi/mathMaterial';
import {
  buildCarryBlock,
  citationWarnings,
  citedPaths,
  encodeEvent,
  findGaps,
  leftoverPlaceholders,
  missingSectionNotice,
  normalizeContext,
  statusFor,
  type AiEvent,
  type Source,
} from '@/lib/chishokanAi/conversation';
import { TASKS_DIR, listTasks, loadTaskBundle, taskButtons, taskListForPrompt, taskTool, type TaskDef } from '@/lib/chishokanAi/tasks';

const STOP = ['\n\nus', '\n\nUs', '\n\nassistant', '\n\nAssistant', '\n\nhuman', '\n\nHuman'];

export const runtime = 'nodejs';
// ★実行時間の上限（秒）。Vercel の Fluid compute が有効なら、Hobby は 300 秒まで、Pro は 800 秒まで延ばせる
//   （Fluid compute が無効だと Hobby は 60 秒まで。超える値にするとデプロイが失敗する）。
//   変えるときは、ここと下の LIMIT_MS を一緒に変える。
export const maxDuration = 300;
const LIMIT_MS = 300_000;

const client = new Anthropic();

// ツールを使う往復の上限。
const MAX_ROUNDS = 10;
const MAX_TOOL_CALLS = 20;
const MAX_DRIVE_READS = 12;
// これを過ぎたら道具を使わせず、わかった範囲で書かせる（書く時間を残す）。
const TOOL_BUDGET_MS = 150_000;
// 制限の手前で止めて「途中で切れました」を送る（Vercel に打ち切られると、画面には何も届かない）。
// 止めたあとの後片付け（会話ログの保存）の時間を残す。
const HARD_STOP_MS = LIMIT_MS - 10_000;
const MAX_TOKENS = 16_000;
// じっくり考える作業（手順書に thinking: adaptive）は、考える分だけ回答の長さの上限を広げる。
const MAX_TOKENS_DEEP = 32_000;
// 計算の道具（Anthropic の実行環境で Python を動かす。手順書に code_execution: on の作業だけで使う）。
const CODE_EXECUTION_TOOL = { type: 'code_execution_20260521', name: 'code_execution' };

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

// プロンプトキャッシュの区切りを、いちばん新しい道具の結果に移す（往復のたびに前の結果まで読み直さないように）。
// 区切りは、システム・今回の質問・最新の道具の結果の3つ（上限は4つ）。
function markLatestToolResults(convo: Anthropic.MessageParam[]) {
  for (let i = 0; i < convo.length - 1; i++) {
    const c = convo[i].content;
    if (!Array.isArray(c)) continue;
    for (const b of c) if (b.type === 'tool_result' && 'cache_control' in b) delete (b as { cache_control?: unknown }).cache_control;
  }
  const last = convo[convo.length - 1];
  if (last && Array.isArray(last.content) && last.content.length) {
    const b = last.content[last.content.length - 1];
    if (b.type === 'tool_result') (b as Anthropic.ToolResultBlockParam).cache_control = { type: 'ephemeral' };
  }
}

// 画面の「よく使う作業」ボタンの一覧。
export async function GET() {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  if (!canUseChishokanAi(session.name)) return new Response('forbidden', { status: 403 });
  const tasks = await listTasks(path.join(process.cwd(), KNOWLEDGE_ROOT), readFileDetailed);
  return Response.json({ tasks: taskButtons(tasks) }, { headers: { 'Cache-Control': 'no-store' } });
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
  const carry = normalizeContext(body?.context);
  const continuation = body?.continuation === true;
  // 会話の番号と何回目のやり取りか（会話ログで1つの会話を追えるように。不具合の報告にも同じ番号が入る）
  const conversationId = typeof body?.conversationId === 'string' && /^[\w-]{4,40}$/.test(body.conversationId) ? body.conversationId : '';
  const turn = typeof body?.turn === 'number' && Number.isFinite(body.turn) ? Math.max(0, Math.floor(body.turn)) : 0;

  const root = path.join(process.cwd(), KNOWLEDGE_ROOT);
  const [policy, index, tasks] = await Promise.all([
    readText(path.join(root, '00_index', 'CLAUDE.md')),
    readText(path.join(root, '00_index', 'INDEX.md')),
    listTasks(root, readFileDetailed),
  ]);
  // 画面の作業ボタンで選ばれた作業
  const chosenTask = typeof body?.task === 'string' ? tasks.find((t) => t.id === body.task) : undefined;
  // 前の回に開いた手順書（持ち越しに入っていれば、その作業の続き）
  const carriedTaskPath = [...carry.reads].reverse().find((p) => p.startsWith(`${TASKS_DIR}/`));
  let activeTask: TaskDef | undefined = chosenTask ?? tasks.find((t) => t.path === carriedTaskPath);
  // じっくり考える設定は、回答の途中では切り替えられない（考えた跡が往復の最初から要る）。回答の始めの作業で決める。
  const deep = !!activeTask?.deepThinking;

  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: buildChishokanAiPrompt({ dept: session.campus, name: session.name, policy, index, tasks: taskListForPrompt(tasks) }),
      cache_control: { type: 'ephemeral' },
    },
  ];
  // 資料を読む3つの道具、ドライブを読む道具、作業の手順書を開く道具、頼まれたときに Google ドキュメント・スライドの下書きを作る道具。
  const START_TASK = taskTool(tasks);
  const tools = [
    ...KNOWLEDGE_TOOLS,
    ...DRIVE_TOOLS,
    START_TASK,
    CREATE_DOC_TOOL,
    SLIDES_TEMPLATES_TOOL,
    CREATE_SLIDES_TOOL,
    MATH_MATERIAL_TOOL,
  ] as unknown as Anthropic.Tool[];
  let tasksStarted = 0;
  // 計算の道具は、作業の手順書が使うときだけ足す（回答の途中で手順書を開いたら、次の往復から足す）。
  let codeExecution = !!activeTask?.codeExecution;
  let codeRuns = 0;
  let templateReads = 0;
  let slidesMade = 0;
  let mathMade = 0;
  const lastUserText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  const encoder = new TextEncoder();
  const ac = new AbortController();
  let clientGone = false;
  let timedOut = false;
  const onClientAbort = () => {
    clientGone = true;
    ac.abort();
  };
  req.signal?.addEventListener?.('abort', onClientAbort);

  let full = '';
  const usage: string[] = [];
  const opened: string[] = [];
  const createdDocs: CreatedDoc[] = [];
  const driveToolReads: DriveRead[] = [];
  let driveLinkReads: DriveRead[] = [];
  const turnReads: string[] = []; // 今回 read_file で読めたナレッジ
  const carryTexts: DriveText[] = []; // 今回ドライブから読めた文字（次の質問に持ち越す）
  let cut: 'time' | 'length' | null = null;

  const rs = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: AiEvent) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(ev)));
        } catch {
          clientGone = true;
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, Math.max(1_000, HARD_STOP_MS - (Date.now() - requestStarted)));
      let toolCalls = 0;
      try {
        // 最後の質問に Google ドライブのリンクがあれば読む（最大3件）。
        if (extractDriveIds(lastUserText).length || extractDriveFolderIds(lastUserText).length) {
          send({ t: 'status', v: '🔗 リンクの資料を読んでいます' });
        }
        const drive = await readDriveLinks(lastUserText, ac.signal);
        driveLinkReads = drive.reads;
        carryTexts.push(...drive.carry);

        // 前の回に読んだナレッジを読み直す（関門を通るものだけ）。
        const carriedKnowledge: { path: string; text: string }[] = [];
        if (carry.reads.length) send({ t: 'status', v: '📚 前に読んだ資料を開き直しています' });
        for (const p of carry.reads) {
          const r = await readFileDetailed(root, p);
          if (r.ok) carriedKnowledge.push({ path: r.path, text: r.text });
        }
        const carryBlock = buildCarryBlock(carriedKnowledge, carry.texts);

        // 作業ボタンで選ばれていれば、手順書と資料を先に渡す（AI が1本ずつ探さない）。
        let taskBlock = '';
        if (chosenTask) {
          send({ t: 'status', v: `🧭 手順書「${chosenTask.button}」を開いています` });
          const b = await loadTaskBundle(root, chosenTask, readFileDetailed);
          taskBlock = b.text;
          for (const p of b.reads) if (!turnReads.includes(p)) turnReads.push(p);
          tasksStarted++;
          opened.push(`task:${chosenTask.id}`);
        }

        const convo: Anthropic.MessageParam[] = messages.map((m, i) =>
          i === messages.length - 1
            ? {
                role: m.role,
                content: [
                  ...(carryBlock ? [{ type: 'text' as const, text: carryBlock }] : []),
                  ...(taskBlock ? [{ type: 'text' as const, text: taskBlock }] : []),
                  ...drive.blocks,
                  ...attachBlocks(attachments),
                  { type: 'text', text: m.content, cache_control: { type: 'ephemeral' } },
                ] as Anthropic.ContentBlockParam[],
              }
            : { role: m.role, content: m.content },
        );

        for (let round = 0; round < MAX_ROUNDS; round++) {
          if (ac.signal.aborted) break;
          const lastRound =
            round === MAX_ROUNDS - 1 || toolCalls >= MAX_TOOL_CALLS || Date.now() - requestStarted > TOOL_BUDGET_MS;
          if (round > 0) markLatestToolResults(convo);
          const roundTools = codeExecution ? [...tools, CODE_EXECUTION_TOOL as unknown as Anthropic.Tool] : tools;
          const stream = client.messages.stream(
            {
              model: MODEL,
              max_tokens: deep ? MAX_TOKENS_DEEP : MAX_TOKENS,
              // SDK 0.69 の型には adaptive がまだ無いが、API は受け付ける（Sonnet 5 以降の考える設定）
              thinking: (deep ? { type: 'adaptive' } : THINKING) as unknown as Anthropic.ThinkingConfigParam,
              system,
              tools: roundTools,
              tool_choice: lastRound ? { type: 'none' } : { type: 'auto' },
              messages: convo,
              stop_sequences: STOP,
            },
            { signal: ac.signal },
          );
          let roundText = '';
          // 計算・考える時間を挟んで文章が続くときも、前の文章と段落を分ける
          let breakBeforeText = false;
          for await (const ev of stream) {
            if (ev.type === 'content_block_start') {
              const b = ev.content_block as { type: string; name?: string };
              if (b.type === 'server_tool_use') {
                codeRuns++;
                send({ t: 'status', v: '🧮 計算して答えを確かめています' });
                breakBeforeText = true;
              } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
                if (!full) send({ t: 'status', v: '🤔 考えています' });
              }
            }
            if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
              // ツールを挟んで文章が続くときは、前の文章と段落を分ける。
              const sep = full && (!roundText || breakBeforeText) ? '\n\n' : '';
              breakBeforeText = false;
              const piece = `${sep}${ev.delta.text}`;
              roundText += ev.delta.text;
              full += piece;
              send({ t: 'text', v: piece });
            }
          }
          const msg = await stream.finalMessage();
          const u = msg.usage;
          usage.push(
            `in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`,
          );
          if (msg.stop_reason === 'max_tokens') cut = 'length';
          // 計算の道具が長く続くと、Anthropic 側で一度止まる（pause_turn）。そのまま送り返すと続きから再開する。
          if (msg.stop_reason === 'pause_turn') {
            convo.push({ role: 'assistant', content: msg.content });
            continue;
          }
          if (msg.stop_reason !== 'tool_use') break;

          convo.push({ role: 'assistant', content: msg.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const block of msg.content) {
            if (block.type !== 'tool_use') continue;
            // 停止・時間切れのあとは、残りの道具を動かさない（文書・スライドを作らない）
            if (ac.signal.aborted) break;
            toolCalls++;
            const input = (block.input ?? {}) as Record<string, unknown>;
            send({ t: 'status', v: statusFor(block.name, input) });
            let out: string;
            if (toolCalls > MAX_TOOL_CALLS) {
              out = 'ツールの上限に達しました。ここまでにわかった範囲で答えてください。';
            } else if (block.name === 'list_drive_folder' || block.name === 'read_drive_file') {
              // ドライブを読むのは1回の回答で合わせて MAX_DRIVE_READS 回まで（1回に数秒かかるため）
              if (driveToolReads.length >= MAX_DRIVE_READS) {
                out = `ドライブの読み込みは1回の回答で${MAX_DRIVE_READS}回までです。ここまでにわかった範囲で答えてください。`;
              } else {
                const r = await runDriveTool(block.name, input, ac.signal);
                if (r.read) driveToolReads.push(r.read);
                if (r.carry) carryTexts.push(r.carry);
                out = r.text;
              }
            } else if (block.name === START_TASK.name) {
              const t = tasks.find((x) => x.id === String(input.task ?? ''));
              if (tasksStarted >= 1) {
                out = '手順書は1回の回答で1つまでです。開いている手順書に沿って進めてください。';
              } else if (!t) {
                out = `その作業の手順書はありません。ある作業：${tasks.map((x) => x.id).join('、') || 'なし'}。手順書なしで回答方針に沿って進めてください。`;
              } else {
                const b = await loadTaskBundle(root, t, readFileDetailed);
                for (const p of b.reads) if (!turnReads.includes(p)) turnReads.push(p);
                tasksStarted++;
                activeTask = t;
                if (t.codeExecution) codeExecution = true;
                out = b.text;
              }
            } else if (block.name === SLIDES_TEMPLATES_TOOL.name) {
              // ひな形を見るのは1回の回答で3回まで（一覧 → 1つの詳しい形、で足りる）
              out = templateReads >= 3 ? 'ひな形はもう見ています。見た枠の一覧で作ってください。' : await runSlideTemplates(input, ac.signal);
              templateReads++;
            } else if (block.name === CREATE_SLIDES_TOOL.name) {
              if (slidesMade >= 1) {
                out = 'スライドは1回の回答で1つまでです。作ったスライドのURLを伝えてください。';
              } else {
                const r = await runCreateSlides(input, { campus: session.campus, user: session.name }, ac.signal);
                createdDocs.push(r.created);
                slidesMade++;
                out = r.toolResult;
              }
            } else if (block.name === MATH_MATERIAL_TOOL.name) {
              if (mathMade >= 1) {
                out = '数学の教材のファイルは1回の回答で1組までです。作ったファイルのURLを伝えてください。';
              } else {
                const r = await runCreateMathMaterial(input, { campus: session.campus, user: session.name }, ac.signal);
                createdDocs.push(...r.created);
                mathMade++;
                out = r.toolResult;
              }
            } else if (block.name === CREATE_DOC_TOOL.name) {
              if (createdDocs.length >= 1) {
                out = '文書は1回の回答で1つまでです。作った文書のURLを伝えてください。';
              } else {
                const r = await runCreateDoc(input, { campus: session.campus, user: session.name }, ac.signal);
                createdDocs.push(r.created);
                out = r.toolResult;
              }
            } else {
              const r = await runKnowledgeToolDetailed(root, block.name, input);
              if (r.readPath && !turnReads.includes(r.readPath)) turnReads.push(r.readPath);
              out = r.text;
            }
            opened.push(
              block.name === CREATE_DOC_TOOL.name || block.name === CREATE_SLIDES_TOOL.name || block.name === MATH_MATERIAL_TOOL.name
                ? `${block.name}:${String(input.title ?? '')}`
                : `${block.name}:${String(input.path ?? input.query ?? input.folder ?? input.file ?? input.task ?? input.template ?? '')}`,
            );
            results.push({ type: 'tool_result', tool_use_id: block.id, content: out });
          }
          convo.push({ role: 'user', content: results });
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          console.error('[chishokan-ai] error', e);
          send({ t: 'error', v: 'エラーが発生しました。もう一度お試しください。' });
        }
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener?.('abort', onClientAbort);
        if (timedOut) cut = 'time';

        // 読んだ資料（今回）と、次の質問に持ち越すもの。
        const sources: Source[] = [
          ...turnReads.map((p) => ({ kind: 'knowledge' as const, path: p })),
          ...[...driveLinkReads, ...driveToolReads]
            .filter((r) => r.ok && r.note !== 'フォルダ一覧')
            .filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i)
            .map((r) => ({ kind: 'drive' as const, name: r.name, id: r.id })),
        ];
        if (sources.length) send({ t: 'sources', items: sources });
        if (turnReads.length || carryTexts.length) send({ t: 'context', reads: turnReads, texts: carryTexts });

        // 出典に挙がっている資料を、この会話で実際に開いたかを確かめる。
        if (full && citedPaths(full).length) {
          try {
            const known = new Set(await listAllowedFiles(root));
            const read = new Set([...carry.reads, ...turnReads]);
            for (const w of citationWarnings(full, read, known)) send({ t: 'notice', v: w });
          } catch {}
        }
        // 資料づくりの確かめ：埋め残しの {{ }}、決まった見出し（確認してほしいこと）の有無。
        if (full) {
          const left = leftoverPlaceholders(full);
          if (left.length) {
            send({ t: 'notice', v: `埋まっていない {{${left.slice(0, 5).join('}}・{{')}}} が残っています。貼る前・使う前に埋めてください。` });
          }
          // 持ち越しただけの作業（この回に選んだ・開いたのではない）では知らせない（別の話題の質問に出続けないように）
          if (activeTask && tasksStarted > 0 && !cut && !clientGone) {
            const miss = missingSectionNotice(full, activeTask.mustInclude);
            if (miss) send({ t: 'notice', v: miss });
          }
        }
        if (cut && !clientGone) send({ t: 'cut', reason: cut });
        // 「資料に無い：…」は、ナレッジに足す資料の手がかりとして会話ログに残す。
        const gaps = findGaps(full);

        const flags = [continuation ? '続き' : '', clientGone ? '停止' : '', cut === 'time' ? '時間切れ' : cut === 'length' ? '長さで切れた' : '']
          .filter(Boolean)
          .join('・');
        try {
          console.log(
            '[chishokan-ai]',
            `rounds=${usage.length}`,
            usage.join(' | '),
            `tools=${opened.join(',')}`,
            `carry=${carry.reads.length}+${carry.texts.length}`,
            flags ? `flags=${flags}` : '',
            activeTask ? `task=${activeTask.id}` : '',
            deep ? 'thinking=adaptive' : '',
            codeRuns ? `code_runs=${codeRuns}` : '',
            gaps.length ? `gaps=${gaps.join('／')}` : '',
          );
        } catch {}
        const attachNote = attachments.length ? `（添付: ${attachments.map((a) => a.name).join('、')}）` : '';
        const allReads = [...driveLinkReads, ...driveToolReads];
        const driveNote = allReads.length
          ? `（ドライブ: ${allReads.map((r) => `${r.name}${r.ok ? '' : `＝読めず:${r.note}`}`).join('、')}）`
          : '';
        const convoNote = conversationId ? `（会話: ${conversationId}${turn ? `・${turn}回目` : ''}）` : '';
        const taskNote = activeTask ? `（作業: ${activeTask.id}）` : '';
        const gapNote = gaps.length ? `（資料に無い: ${gaps.join('／')}）` : '';
        const docNote = createdDocs.length
          ? `（作成した文書: ${createdDocs.map((d) => (d.ok ? `${d.title} ${d.url}` : `${d.title}＝作れず:${d.note}`)).join('、')}）`
          : '';
        try {
          await logInteraction({
            user: session.name,
            campus: session.campus,
            input: `[智翔館AI]${convoNote}${flags ? `（${flags}）` : ''}${taskNote}${gapNote} ${continuation ? '（続きを書く）' : lastUserText}${attachNote}${driveNote}${docNote}\n（調べた資料: ${opened.join('、') || 'なし'}）`,
            output: stripRoleBleed(full),
          }, { timeoutMs: Math.max(2_000, Math.min(15_000, LIMIT_MS - (Date.now() - requestStarted) - 2_000)) });
        } catch {}
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      // 画面が通信を切った（停止・画面を閉じた）
      onClientAbort();
    },
  });

  return new Response(rs, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
