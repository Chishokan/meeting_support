import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/auth';
import { MODEL, THINKING } from '@/lib/systemPrompt';
import { buildInquiryQaPrompt } from '@/lib/inquiryQaPrompt';
import {
  listInquiryBoard, statsByCampus, formatRows, formatStats,
  splitByMonth, currentAndPreviousYm, ymLabel,
} from '@/lib/inquiryBoard';
import { logInteraction } from '@/lib/log';
import { sanitizeHistory, stripRoleBleed } from '@/lib/sanitize';

// モデルが偽の user/assistant ターンを書き始めたら即停止させる。
const STOP = ['\n\nus', '\n\nUs', '\n\nassistant', '\n\nAssistant', '\n\nhuman', '\n\nHuman'];

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new Anthropic();

type Msg = { role: 'user' | 'assistant'; content: string };

// 問合せ管理には生徒・保護者の個人情報が含まれるため、閲覧できる部門を限定する。
// ※氏名は Apps Script でマスク済みだが、備考の自由記述までは機械的に消せない。
const ALLOWED_DEPTS = ['小中等部', '総務・人事・支援・管理'];

// 集計だけを返す（画面上部のカード用）。
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (!ALLOWED_DEPTS.includes(session.campus)) {
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  }

  const board = await listInquiryBoard();
  if (!board.ok) return Response.json({ ok: false, reason: board.reason }, { status: 200 });

  // ダッシュボードは当月と前月だけを出す。それ以前はチャットで尋ねる運用。
  const split = splitByMonth(board.rows);
  const ym = currentAndPreviousYm();

  return Response.json({
    ok: true,
    current: { ym: ym.current, label: ymLabel(ym.current), stats: statsByCampus(split.current) },
    previous: { ym: ym.previous, label: ymLabel(ym.previous), stats: statsByCampus(split.previous) },
    olderCount: split.older.length,
    unknownCount: split.unknown.length,
    total: board.rows.length,
    fetchedAt: board.fetchedAt,
  });
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  if (!ALLOWED_DEPTS.includes(session.campus)) {
    return new Response('この機能は小中等部と管理部門のみ利用できます。', { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const raw: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  const messages = sanitizeHistory(raw) as Msg[];
  if (messages.length === 0) return new Response('messages required', { status: 400 });

  // 毎回シートを読み直す（会話の途中で担当者が入力しても次の発言から反映される）。
  const board = await listInquiryBoard();
  if (!board.ok) {
    const msg =
      board.reason === 'board_not_configured'
        ? '問合せ管理シートが未設定です。Apps Script の INQUIRY_BOARD_ID を設定してください。'
        : board.reason === 'not_configured'
          ? 'APPS_SCRIPT_URL が未設定です。'
          : 'シートを読み込めませんでした。時間をおいて試すか、管理部門にご連絡ください。';
    return new Response(msg, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  // 集計は当月・前月・全期間の3本を渡す。
  // 画面は当月・前月だけだが、チャットではそれ以前も聞けるようにするため全行も渡す。
  const split = splitByMonth(board.rows);
  const ym = currentAndPreviousYm();
  const statsText = [
    `【${ymLabel(ym.current)}（当月）】`,
    formatStats(statsByCampus(split.current)),
    '',
    `【${ymLabel(ym.previous)}（前月）】`,
    formatStats(statsByCampus(split.previous)),
    '',
    '【全期間（シート全体）】',
    formatStats(statsByCampus(board.rows)),
    '',
    `※それ以前の月 ${split.older.length}件、日付を読み取れなかった行 ${split.unknown.length}件。`,
  ].join('\n');

  const systemText = buildInquiryQaPrompt({
    dept: session.campus,
    name: session.name,
    statsText,
    rowsText: formatRows(board.rows),
  });

  const encoder = new TextEncoder();
  let full = '';
  let cacheLog = '';

  // プロンプトキャッシュ：シート本文はターン間で変わらないことが多いので、
  // システム側にキャッシュポイントを置いて毎ターンの再送コストを抑える。
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
            console.log('[CACHE inquiry-qa]', cacheLog, `rows=${board.rows.length}`);
          } catch {}
        }
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        try {
          await logInteraction({
            user: session.name,
            campus: session.campus,
            input: `[問い合わせQA] ${lastUser?.content ?? ''}`,
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
