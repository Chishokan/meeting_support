import { getSession } from '@/lib/auth';
import { streamClaude } from '@/lib/claudeStream';
import {
  buildDeptMinutesPrompt,
  buildDraftRequest,
  buildReviseRequest,
  type MeetingMeta,
} from '@/lib/deptMinutesPrompt';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 1時間の会議でも文字起こしは数万字に収まるが、事故防止に上限を置く。
// 超えた分は切り捨てず、画面側に「長すぎる」と伝えて分割してもらう。
const MAX_TRANSCRIPT = 120000;

function readMeta(v: unknown): MeetingMeta {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    title: String(o.title ?? ''),
    date: String(o.date ?? ''),
    place: String(o.place ?? ''),
    attendees: String(o.attendees ?? ''),
    agenda: String(o.agenda ?? ''),
  };
}

// 会議の文字起こし → 議事録ドラフト（mode:'draft'）／修正指示の反映（mode:'revise'）。
// どちらもテキストをそのまま流し返す（画面側で逐次表示する）。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === 'revise' ? 'revise' : 'draft';
  const meta = readMeta(body?.meta);
  const transcript = String(body?.transcript ?? '').trim();
  if (!transcript) return new Response('transcript required', { status: 400 });
  if (transcript.length > MAX_TRANSCRIPT) return new Response('transcript too long', { status: 413 });

  const draft = String(body?.draft ?? '');
  const instruction = String(body?.instruction ?? '').trim();
  if (mode === 'revise' && !instruction) return new Response('instruction required', { status: 400 });

  const userText =
    mode === 'revise'
      ? buildReviseRequest(meta, transcript, draft, instruction)
      : buildDraftRequest(meta, transcript);

  // プロンプトキャッシュ：議事録プロンプト（部門・担当で固定）にキャッシュポイントを置く。
  // 修正依頼を何度か往復しても、system 側は毎回キャッシュから読める。
  return streamClaude({
    label: 'dept-minutes',
    system: buildDeptMinutesPrompt(session.campus, session.name),
    messages: [{ role: 'user', content: userText }],
    // 議事録＋会議の質チェックの2ブロック分。長い会議でも途中で切れないよう厚めに取る。
    maxTokens: 12000,
    log: {
      user: session.name,
      campus: session.campus,
      // 文字起こし全文はログに残さない（長すぎるうえ、会話の生データが二重に溜まるため）。
      input: `[部門会議議事録/${mode}] ${meta.title || '（会議名未入力）'}｜文字起こし${transcript.length}字${instruction ? `｜修正指示：${instruction}` : ''}`,
    },
  });
}
