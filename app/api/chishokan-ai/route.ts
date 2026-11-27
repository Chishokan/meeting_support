// 智翔館AI：社内ナレッジ（knowledge/）を調べて答える相談窓口。
//
// 流れ：会社の前提（COMPANY.md）＋回答方針（00_index/CLAUDE.md）＋索引（00_index/INDEX.md）を渡し、
// AIが read_file / grep_knowledge / list_dir で必要な資料だけを読んで答える（lib/chishokanAi/knowledgeTools.ts）。
// 添付（PDF・画像・テキスト。Word・Excel・PowerPoint は画面側で文字にしてから送る）は今回の質問にだけ付ける。
// 質問に Google ドライブのリンクがあれば、Apps Script で中身を読んで一緒に渡す（読めるフォルダは限定。lib/chishokanAi/driveFiles.ts）。
// 使えるのは太田先生・瀬戸山先生と管理部門の方だけ（lib/chishokanAi/access.ts）。
//
// 回答は 1行1つの JSON（NDJSON）で送る（決まりは lib/chishokanAi/conversation.ts）：
//   文章の断片、作業中の表示（📄 …を読んでいます）、読んだ資料、次の質問に持ち越す資料、出典の注意、途中で切れた知らせ。
// 会話の持ち越し：画面が覚えている「前に読んだナレッジのパス」と「文字にした資料」を受け取り、ナレッジは読み直して
// （確定していない要項などは読まない関門を通す）、今回の質問と一緒に AI に渡す。
// 作業の手順書（knowledge/05_作業/、lib/chishokanAi/tasks.ts）：画面の作業ボタンで選ばれたら手順書と資料を先に渡し、
// 文章で頼まれたときは AI が start_task で開く。資料づくりの回答は、埋め残しの {{ }} と「確認してほしいこと」の有無を確かめる。
// コンテキスト欄（lib/chishokanAi/pinnedContext.ts）：職員が画面の右の欄に置いた前提を、質問のたびに渡す。
// AI は頼まれたときだけ propose_context_edit で直し案を出し、画面に送る（職員が押すまで変わらない）。
// 回答の確かめ（2026-11-14 の会話ログで見つかった不具合への対策）：
//   - 道具を呼ばずにファイルの URL を書いた（作り話のリンク）→ 画面から消して知らせ、1回だけ作り直させる
//   - 選択肢で聞き返したのに、同じ回答の中で作り始めた → ```選択肢 のブロックが閉じたら、そこで回答を終える
//   - 文字も道具も無いまま終わった（空の回答）→ 1回だけ作り直させる
// GET は画面の作業ボタンの一覧を返す。
// 停止：画面が通信を切ったら、AI への問い合わせも止める。時間切れ：300秒の制限の手前で止め、「途中で切れました」を送る。

import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getSession } from '@/lib/core/auth';
import { MODEL, THINKING } from '@/lib/systemPrompt';
import { logAi } from '@/lib/chishokanAi/aiLog';
import { sanitizeHistory, stripRoleBleed } from '@/lib/core/sanitize';
import { AI_DENIED_MESSAGE, canUseChishokanAi } from '@/lib/chishokanAi/access';
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
import { runCreateMathMaterial, runCreateMathQuiz } from '@/lib/chishokanAi/mathMaterial';
import { MATH_QUIZ_TOOL } from '@/lib/chishokanAi/mathQuizTool';
import { ENGLISH_WORD_QUIZ_TOOL, runCreateEnglishWordQuiz } from '@/lib/chishokanAi/englishQuizTool';
import { runTaskEvaluation, TASK_EVAL_TOOL } from '@/lib/chishokanAi/taskEval';
import { carriedNote, CARRY_MAX_FILES, isHeavy } from '@/lib/chishokanAi/attachCarry';
import { GENERATE_IMAGE_TOOL, IMAGE_MAX_PER_TURN, IMAGE_PAUSED_ALT, IMAGE_PAUSED_NOTICE } from '@/lib/chishokanAi/imageTool';
import { imageGenerationEnabled, runGenerateImage, type ImageSource } from '@/lib/chishokanAi/imageGen';
import { checkNepRequest, nepRequestToolResult, NEP_MAX_PER_TURN, PROPOSE_NEP_REQUEST_TOOL } from '@/lib/chishokanAi/nepRequest';
import { SEARCH_TEST_PAPERS_TOOL } from '@/lib/chishokanAi/testPapers';
import { runSearchTestPapers } from '@/lib/chishokanAi/testPapersRun';
import { MEETING_RECORDS_TOOL, PROPOSE_AGENDA_TOOL } from '@/lib/chishokanAi/meetingRecords';
import { runMeetingRecords, runProposeAgenda } from '@/lib/chishokanAi/meetingRecordsRun';
import { AGENDA_CHOICE_BLOCK, asksAboutPreshare, needsAgendaChoice } from '@/lib/chishokanAi/meetingRecords';
import {
  buildCarryBlock,
  citationWarnings,
  citedPaths,
  closedChoicesEnd,
  EMPTY_ANSWER_PROMPT,
  encodeEvent,
  fakeLinkNotice,
  fakeLinkPrompt,
  redactLinks,
  unknownGoogleLinks,
  findGaps,
  leftoverPlaceholders,
  missingSectionNotice,
  normalizeContext,
  statusFor,
  type AiEvent,
  type Source,
} from '@/lib/chishokanAi/conversation';
import {
  buildPinnedBlock,
  checkProposal,
  normalizePinnedForApi,
  PIN_MAX_PROPOSALS,
  PROPOSE_CONTEXT_TOOL,
  proposalToolResult,
} from '@/lib/chishokanAi/pinnedContext';
import { TASKS_DIR, listTasks, loadTaskBundle, taskButtons, taskListForPrompt, taskTool, type TaskDef } from '@/lib/chishokanAi/tasks';

// 作る道具が失敗したあとに呼び直したときの返事（「作れていた」と取り違えさせない）
const FAILED_AGAIN =
  '前の呼び出しで、作れなかった（保存できなかった）ファイルがあります。この回答では、もう作り直せません。' +
  '「作れていた」とは書かず、上の道具の結果のとおりに、保存できたもの・できなかったものと理由、作ろうとした中身を回答に書き、少し時間をおいてもう一度頼むよう伝える。';

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

/**
 * この回答で AI に渡したもの（回答方針・質問・前の回答・渡した資料・道具の結果）を1つの文にする。
 * 回答に書かれたファイルの URL が、ここに出てきたものかを確かめる（作り話のリンクを見つける）。PDF・画像は入れない。
 */
function knownText(system: Anthropic.TextBlockParam[], convo: Anthropic.MessageParam[]): string {
  const parts: string[] = system.map((b) => b.text);
  for (const m of convo) {
    if (typeof m.content === 'string') { parts.push(m.content); continue; }
    for (const b of m.content) {
      if (b.type === 'text') parts.push(b.text);
      else if (b.type === 'tool_result') parts.push(typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? ''));
      else if (b.type === 'tool_use') parts.push(JSON.stringify(b.input ?? {}));
    }
  }
  return parts.join('\n');
}

// 画面の「よく使う作業」ボタンの一覧。
export async function GET() {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  if (!canUseChishokanAi(session)) return new Response('forbidden', { status: 403 });
  const tasks = await listTasks(path.join(process.cwd(), KNOWLEDGE_ROOT), readFileDetailed);
  // 画像の生成を使えないあいだは、画面の上に知らせを出す（GPT・Gemini の API は調整中）
  const imageNotice = imageGenerationEnabled() ? '' : `${IMAGE_PAUSED_NOTICE}${IMAGE_PAUSED_ALT}`;
  return Response.json({ tasks: taskButtons(tasks), imageNotice }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const requestStarted = Date.now();
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  if (!canUseChishokanAi(session)) return new Response(AI_DENIED_MESSAGE, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const raw: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  const messages = sanitizeHistory(raw) as Msg[];
  if (messages.length === 0) return new Response('messages required', { status: 400 });
  const attachments: Attach[] = Array.isArray(body?.attachments) ? body.attachments.slice(0, 5) : [];
  // 前の質問で添付した PDF・画像（画面が覚えておいて付け直す。lib/chishokanAi/attachCarry.ts）
  const carried: Attach[] = (Array.isArray(body?.carried) ? body.carried : [])
    .filter((a: Attach) => a && typeof a.name === 'string' && typeof a.data === 'string' && isHeavy(a))
    .slice(0, CARRY_MAX_FILES);
  const carry = normalizeContext(body?.context);
  // コンテキスト欄の項目（質問のたびに全部渡す）
  const pinned = normalizePinnedForApi(body?.pinned);
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
      text: buildChishokanAiPrompt({ dept: session.campus, name: session.name, policy, index, tasks: taskListForPrompt(tasks), images: imageGenerationEnabled() }),
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
    MATH_QUIZ_TOOL,
    // 英語の単語テスト（教材の元データから選ぶ。2026-11-21）
    ENGLISH_WORD_QUIZ_TOOL,
    PROPOSE_CONTEXT_TOOL,
    TASK_EVAL_TOOL,
    // 会議の記録（議事録・決定事項・ToDo・事前共有）を読む道具と、議題の追加の案
    MEETING_RECORDS_TOOL,
    PROPOSE_AGENDA_TOOL,
    // 画像を作る道具（OpenAI か Google の API キーがあり、止めていないときだけ。2026-11-19 から停止。調整中）
    ...(imageGenerationEnabled() ? [GENERATE_IMAGE_TOOL] : []),
    // NEPへの作成依頼の案（画像・挿絵・チラシなどの制作は NEP に頼む。押すまで送らない）
    PROPOSE_NEP_REQUEST_TOOL,
    // 中学校のテスト問題（定期テスト・実力テスト・入試問題）の保存と検索（2026-11-20）
    SEARCH_TEST_PAPERS_TOOL,
  ] as unknown as Anthropic.Tool[];
  let tasksStarted = 0;
  // 計算の道具は、作業の手順書が使うときだけ足す（回答の途中で手順書を開いたら、次の往復から足す）。
  let codeExecution = !!activeTask?.codeExecution;
  let codeRuns = 0;
  let templateReads = 0;
  let slidesMade = 0;
  let mathMade = 0;
  let englishMade = 0;
  // 作った画像（会話ログ用）と、この回答で作った画像（続けて直すときの元にする）
  const imagesMade: CreatedDoc[] = [];
  // 議題の追加の案（1回の回答で3つまで）
  const agendaProposals: string[] = [];
  // NEPへの作成依頼の案（1回の回答で3つまで）
  const nepProposals: string[] = [];
  // テスト問題の保存（1回の回答で2件まで）と検索（3回まで）
  const testFound: string[] = [];
  let testSearches = 0;
  let meetingReads = 0;
  // 部門会議の事前共有を聞かれて読んだか（回答の最後に「議題を追加する」を出して、議題の追加を促す）
  let preshareAsked = false;
  const turnImages: ImageSource[] = [];
  // 作る道具が失敗したか（失敗のあとに呼び直したとき、「作れていた」と取り違えさせない）
  let mathFailed = false;
  const proposals: string[] = [];
  // 回答の確かめ：作り話のリンク・選択肢で止めた・空の回答
  const fakeLinks: string[] = [];
  let fakeRetried = false;
  let choicesStop = false;
  let emptyRetried = false;
  let lastStop = '';
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
  // 使い方の傾向・費用の目安として会話ログに残す（往復の合計）
  const tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  let failed = false;
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
        const pinnedBlock = buildPinnedBlock(pinned);

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
                  ...(pinnedBlock ? [{ type: 'text' as const, text: pinnedBlock }] : []),
                  ...(carryBlock ? [{ type: 'text' as const, text: carryBlock }] : []),
                  ...(taskBlock ? [{ type: 'text' as const, text: taskBlock }] : []),
                  ...drive.blocks,
                  ...(carried.length ? [{ type: 'text' as const, text: carriedNote(carried.map((a) => String(a.name).slice(0, 80))) }, ...attachBlocks(carried)] : []),
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
          // トークン（途中で止めたときも数えられるように、届いた順に覚えておく）
          const ru = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
          for await (const ev of stream) {
            if (ev.type === 'message_start') {
              const mu = ev.message.usage;
              ru.input = mu.input_tokens ?? 0;
              ru.cacheRead = mu.cache_read_input_tokens ?? 0;
              ru.cacheWrite = mu.cache_creation_input_tokens ?? 0;
              ru.output = mu.output_tokens ?? 0;
            } else if (ev.type === 'message_delta' && ev.usage) {
              ru.output = ev.usage.output_tokens ?? ru.output;
            }
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
              let text = ev.delta.text;
              // 選択肢で聞き返したら、その回答はそこで終える（返事を待つ。同じ回答の中で作り始めない）
              const end = closedChoicesEnd(roundText + text);
              if (end >= 0) {
                text = (roundText + text).slice(roundText.length, end);
                choicesStop = true;
              }
              const piece = `${sep}${text}`;
              roundText += text;
              full += piece;
              send({ t: 'text', v: piece });
              if (choicesStop) break; // ループを抜けると、この往復の生成は止まる（SDK が中断する）
            }
          }
          if (choicesStop) {
            tokens.input += ru.input;
            tokens.cacheRead += ru.cacheRead;
            tokens.cacheWrite += ru.cacheWrite;
            tokens.output += ru.output;
            usage.push(`in=${ru.input} cache_read=${ru.cacheRead} cache_write=${ru.cacheWrite} out=${ru.output} (選択肢で止めた)`);
            lastStop = 'choices';
            break;
          }
          const msg = await stream.finalMessage();
          const u = msg.usage;
          tokens.input += u.input_tokens ?? 0;
          tokens.cacheRead += u.cache_read_input_tokens ?? 0;
          tokens.cacheWrite += u.cache_creation_input_tokens ?? 0;
          tokens.output += u.output_tokens ?? 0;
          usage.push(
            `in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`,
          );
          if (msg.stop_reason === 'max_tokens') cut = 'length';
          // 計算の道具が長く続くと、Anthropic 側で一度止まる（pause_turn）。そのまま送り返すと続きから再開する。
          if (msg.stop_reason === 'pause_turn') {
            convo.push({ role: 'assistant', content: msg.content });
            continue;
          }
          if (msg.stop_reason !== 'tool_use') {
            lastStop = msg.stop_reason ?? '';
            const canRetry = round < MAX_ROUNDS - 1 && !ac.signal.aborted && Date.now() - requestStarted < TOOL_BUDGET_MS;
            // 空の回答（文字も道具も無いまま終わった）：1回だけ作り直させる
            // （空の回答は送り返せないので、同じ問い合わせをもう一度送る。最後の質問の後ろに、答えるよう一言だけ足す）
            if (!full.trim() && !emptyRetried && canRetry && msg.stop_reason !== 'max_tokens') {
              emptyRetried = true;
              const last = convo[convo.length - 1];
              if (last?.role === 'user' && Array.isArray(last.content)) {
                last.content = [...last.content, { type: 'text', text: EMPTY_ANSWER_PROMPT }] as Anthropic.ContentBlockParam[];
              }
              continue;
            }
            // 作り話のリンク：道具で作っていないファイルの URL を消して知らせ、1回だけ作り直させる
            const fakes = full ? unknownGoogleLinks(full, knownText(system, convo)) : [];
            if (fakes.length) {
              fakeLinks.push(...fakes.filter((f) => !fakeLinks.includes(f)));
              full = redactLinks(full, fakes);
              send({ t: 'redact', urls: fakes });
              const retry = !fakeRetried && canRetry;
              send({ t: 'notice', v: fakeLinkNotice(retry) });
              if (retry) {
                fakeRetried = true;
                convo.push({ role: 'assistant', content: msg.content });
                convo.push({ role: 'user', content: [{ type: 'text', text: fakeLinkPrompt(fakes) }] });
                continue;
              }
            }
            break;
          }

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
                out = createdDocs.some((d) => !d.ok) ? FAILED_AGAIN : 'スライドは1回の回答で1つまでです。前の呼び出しの結果に出たURLを伝えてください。';
              } else {
                const r = await runCreateSlides(input, { campus: session.campus, user: session.name }, ac.signal);
                createdDocs.push(r.created);
                slidesMade++;
                out = r.toolResult;
              }
            } else if (block.name === MATH_MATERIAL_TOOL.name || block.name === MATH_QUIZ_TOOL.name) {
              if (mathMade >= 1) {
                out = mathFailed ? FAILED_AGAIN : '数学の教材のファイルは1回の回答で1組までです。前の呼び出しの結果に出たURLを伝えてください。';
              } else {
                const run = block.name === MATH_QUIZ_TOOL.name ? runCreateMathQuiz : runCreateMathMaterial;
                const r = await run(input, { campus: session.campus, user: session.name }, ac.signal);
                createdDocs.push(...r.created);
                mathFailed = r.created.some((d) => !d.ok);
                // 入力の誤り（保存の前の確かめで止まった）なら、直して呼び直せるように数えない
                if (!r.inputError) mathMade++;
                out = r.toolResult;
              }
            } else if (block.name === ENGLISH_WORD_QUIZ_TOOL.name) {
              // 英語の単語テストは1回の回答で2組まで（「Part1 と Part2 で別々に」くらい）
              if (englishMade >= 2) {
                out = '英語の単語テストのファイルは1回の回答で2組までです。前の呼び出しの結果に出たURLを伝えてください。';
              } else {
                const r = await runCreateEnglishWordQuiz(input, { campus: session.campus, user: session.name }, ac.signal);
                createdDocs.push(...r.created);
                if (!r.inputError) englishMade++;
                out = r.toolResult;
              }
            } else if (block.name === GENERATE_IMAGE_TOOL.name) {
              if (imagesMade.filter((d) => d.ok).length >= IMAGE_MAX_PER_TURN) {
                out = `画像は1回の回答で${IMAGE_MAX_PER_TURN}枚までです。作った画像のリンクを伝えてください。`;
              } else {
                // 直す元にできる画像：添付・前の添付・この回答で作った画像
                const sources: ImageSource[] = [
                  ...turnImages,
                  ...[...attachments, ...carried]
                    .filter((a) => a && a.kind === 'image' && typeof a.data === 'string')
                    .map((a) => ({ name: String(a.name), mime: String(a.mime), data: a.data })),
                ];
                const r = await runGenerateImage(input, { campus: session.campus, user: session.name, email: session.email }, sources, ac.signal);
                if (!r.inputError || r.created.ok) imagesMade.push(r.created);
                if (r.image) {
                  turnImages.unshift({ name: r.image.name, mime: r.image.mime, data: r.image.data });
                  send({ t: 'image', name: r.image.name, url: r.image.url, mime: r.image.mime, data: r.image.data });
                }
                out = r.toolResult;
              }
            } else if (block.name === MEETING_RECORDS_TOOL.name) {
              // 会議の記録は1回の回答で3回まで読む（部門・種類を変えて読み直すくらい）
              if (meetingReads >= 3) {
                out = '会議の記録はもう読んでいます。読んだ範囲で答えてください。';
              } else {
                meetingReads++;
                const r = await runMeetingRecords(input, ac.signal);
                if (asksAboutPreshare(r.what, lastUserText)) {
                  preshareAsked = true;
                  // 回答の下に、会議ごとの［意見を足す］［修正する］を出す
                  if (r.preshares.length) send({ t: 'preshare', items: r.preshares });
                }
                out = r.text;
              }
            } else if (block.name === PROPOSE_AGENDA_TOOL.name) {
              if (agendaProposals.length >= 3) {
                out = '議題の追加の案は1回の回答で3つまでです。出した案を職員に見てもらってください。';
              } else {
                const r = await runProposeAgenda(input, ac.signal);
                if (r.proposal) {
                  send({ t: 'agenda', ...r.proposal });
                  agendaProposals.push(`${r.proposal.dept}「${r.proposal.item}」`);
                }
                out = r.text;
              }
            } else if (block.name === PROPOSE_NEP_REQUEST_TOOL.name) {
              const c = checkNepRequest(input);
              if (nepProposals.length >= NEP_MAX_PER_TURN) {
                out = `作成依頼の案は1回の回答で${NEP_MAX_PER_TURN}つまでです。出した案を職員に見てもらってください。`;
              } else if (!c.ok) {
                out = c.message;
              } else {
                send({ t: 'nep', ...c.value });
                nepProposals.push(c.value.title);
                out = nepRequestToolResult(c.value);
              }
            } else if (block.name === SEARCH_TEST_PAPERS_TOOL.name) {
              // 保存したテスト問題を探す（保存は画面の［🗄 テスト問題を保存］の小窓から。AI は保存しない）
              if (testSearches >= 3) {
                out = 'テスト問題はもう探しています。見つかった範囲で答えてください。';
              } else {
                testSearches++;
                const r = await runSearchTestPapers(input, ac.signal);
                testFound.push(r.note);
                out = r.text;
              }
            } else if (block.name === TASK_EVAL_TOOL.name) {
              // 校舎の重要タスク評価（AI壁打ちと同じ評価シート・基準）。行動計画を見直すときに読む
              const r = await runTaskEvaluation(input, { campus: session.campus });
              out = r.text;
            } else if (block.name === PROPOSE_CONTEXT_TOOL.name) {
              // 直し案は画面に送るだけ（職員が「置き換える」「追加する」を押すまで変わらない）
              const c = checkProposal(input, pinned);
              if (proposals.length >= PIN_MAX_PROPOSALS) {
                out = `直し案は1回の回答で${PIN_MAX_PROPOSALS}つまでです。出した案を職員に見てもらってください。`;
              } else if (!c.ok) {
                out = c.message;
              } else {
                send({ t: 'pin', ...c.proposal });
                proposals.push(c.proposal.id ? `${c.proposal.id}「${c.proposal.name}」` : `新「${c.proposal.name}」`);
                out = proposalToolResult(c.proposal);
              }
            } else if (block.name === CREATE_DOC_TOOL.name) {
              if (createdDocs.length >= 1) {
                out = createdDocs.some((d) => !d.ok) ? FAILED_AGAIN : '文書は1回の回答で1つまでです。前の呼び出しの結果に出たURLを伝えてください。';
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
              block.name === CREATE_DOC_TOOL.name || block.name === CREATE_SLIDES_TOOL.name || block.name === MATH_MATERIAL_TOOL.name || block.name === MATH_QUIZ_TOOL.name
                ? `${block.name}:${String(input.title ?? '')}`
                : block.name === ENGLISH_WORD_QUIZ_TOOL.name
                  ? `${block.name}:${[input.grade, input.unit ? `Unit${input.unit}` : '', Array.isArray(input.sections) ? input.sections.join('・') : '', input.source, input.count].filter(Boolean).join(' ')}`
                : block.name === PROPOSE_CONTEXT_TOOL.name
                  ? `${block.name}:${String(input.id || input.name || '')}`
                  : block.name === SEARCH_TEST_PAPERS_TOOL.name
                    ? `${block.name}:${[input.kind, input.year, input.school, input.grade, input.subject, input.round ? `第${input.round}回` : '', input.entrance_type, input.query].filter(Boolean).join(' ')}`
                    : `${block.name}:${String(input.path ?? input.query ?? input.folder ?? input.file ?? input.task ?? input.template ?? input.school ?? input.name ?? input.dept ?? '')}`,
            );
            results.push({ type: 'tool_result', tool_use_id: block.id, content: out });
          }
          convo.push({ role: 'user', content: results });
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          console.error('[chishokan-ai] error', e);
          failed = true;
          send({ t: 'error', v: 'エラーが発生しました。もう一度お試しください。' });
        }
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener?.('abort', onClientAbort);
        if (timedOut) cut = 'time';

        // 部門会議の事前共有を聞かれたら、回答の最後に「議題を追加する」を出して議題の追加を促す（AI が付け忘れたとき）。
        if (!failed && !clientGone && !cut && needsAgendaChoice(full, { asked: preshareAsked, proposed: agendaProposals.length > 0 })) {
          const add = `\n\n${AGENDA_CHOICE_BLOCK}`;
          full += add;
          send({ t: 'text', v: add });
        }

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

        const flags = [
          continuation ? '続き' : '',
          failed ? 'エラー' : '',
          clientGone ? '停止' : '',
          cut === 'time' ? '時間切れ' : cut === 'length' ? '長さで切れた' : '',
          fakeLinks.length ? `作り話のリンク${fakeLinks.length}件${fakeRetried ? '→作り直し' : ''}` : '',
          !full.trim() && !clientGone && !failed ? `空の回答（${lastStop || '理由不明'}${emptyRetried ? '・作り直しても空' : ''}）` : '',
        ]
          .filter(Boolean)
          .join('・');
        try {
          console.log(
            '[chishokan-ai]',
            `rounds=${usage.length}`,
            usage.join(' | '),
            `tools=${opened.join(',')}`,
            `carry=${carry.reads.length}+${carry.texts.length}`,
            pinned.length ? `pinned=${pinned.length}` : '',
            flags ? `flags=${flags}` : '',
            activeTask ? `task=${activeTask.id}` : '',
            deep ? 'thinking=adaptive' : '',
            codeRuns ? `code_runs=${codeRuns}` : '',
            gaps.length ? `gaps=${gaps.join('／')}` : '',
          );
        } catch {}
        const attachNote =
          (attachments.length ? `（添付: ${attachments.map((a) => a.name).join('、')}）` : '') +
          (carried.length ? `（前の添付を付け直し: ${carried.map((a) => a.name).join('、')}）` : '');
        const allReads = [...driveLinkReads, ...driveToolReads];
        const driveNote = allReads.length
          ? `（ドライブ: ${allReads.map((r) => `${r.name}${r.ok ? '' : `＝読めず:${r.note}`}`).join('、')}）`
          : '';
        const convoNote = conversationId ? `（会話: ${conversationId}${turn ? `・${turn}回目` : ''}）` : '';
        const taskNote = activeTask ? `（作業: ${activeTask.id}）` : '';
        const gapNote = gaps.length ? `（資料に無い: ${gaps.join('／')}）` : '';
        const k = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
        const statNote = `（${Math.round((Date.now() - requestStarted) / 1000)}秒・往復${usage.length}・トークン 入力${k(tokens.input)}/キャッシュ読${k(tokens.cacheRead)}/キャッシュ書${k(tokens.cacheWrite)}/出力${k(tokens.output)}${deep ? '・じっくり考える' : ''}${codeRuns ? `・計算${codeRuns}回` : ''}${choicesStop ? '・選択肢で止めた' : ''}${emptyRetried && full.trim() ? '・空の回答を作り直した' : ''}）`;
        // コンテキスト欄の項目（名前と字数だけ。全文は追加・置き換えのときに context-log で1回だけ残す）
        const pinNote = pinned.length ? `（コンテキスト: ${pinned.map((p) => `${p.id}「${p.name}」${p.text.length}字`).join('、')}）` : '';
        const proposalNote = proposals.length ? `（コンテキストの直し案: ${proposals.join('、')}）` : '';
        const nepNote = nepProposals.length ? `（NEPへの作成依頼の案: ${nepProposals.join('、')}）` : '';
        const testNote = testFound.length ? `（テスト問題を検索: ${testFound.join('、')}）` : '';
        const fakeNote = fakeLinks.length ? `（作り話のリンク: ${fakeLinks.join('、')}）` : '';
        const madeAll = [...createdDocs, ...imagesMade];
        const docNote = madeAll.length
          ? `（作成した文書: ${madeAll.map((d) => (d.ok ? `${d.title} ${d.url}` : `${d.title}＝作れず:${d.note}`)).join('、')}）`
          : '';
        // 会話ログ：スプレッドシート「智翔館AI 会話ログ」のアカウント別のシートに、列を分けて残す（lib/chishokanAi/aiLog.ts）。
        // 再デプロイ前の Apps Script のために、従来の1つにまとめた形（input）も送る。
        const answer = stripRoleBleed(full);
        try {
          await logAi(
            {
              user: session.name,
              campus: session.campus,
              email: session.email,
              kind: '質問',
              conversationId,
              turn,
              task: activeTask?.id,
              question: `${continuation ? '（続きを書く）' : lastUserText}${attachNote}${driveNote}`,
              answer,
              sources: opened.join('\n') || 'なし',
              files: madeAll.map((d) => (d.ok ? `${d.title} ${d.url}` : `${d.title}＝作れず:${d.note}`)).join('\n'),
              context: [pinNote, proposalNote].filter(Boolean).join(''),
              flags: [flags, gapNote, fakeNote, nepNote, testNote].filter(Boolean).join(''),
              stats: statNote.replace(/^（|）$/g, ''),
            },
            {
              input: `[智翔館AI]${convoNote}${flags ? `（${flags}）` : ''}${taskNote}${gapNote} ${continuation ? '（続きを書く）' : lastUserText}${attachNote}${driveNote}${docNote}${pinNote}${proposalNote}${nepNote}${testNote}${fakeNote}\n（調べた資料: ${opened.join('、') || 'なし'}）${statNote}`,
              output: answer,
            },
            { timeoutMs: Math.max(2_000, Math.min(15_000, LIMIT_MS - (Date.now() - requestStarted) - 2_000)) },
          );
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
