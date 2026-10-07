import { getSession } from '@/lib/core/auth';
import { checkTranscribeSetup, isTranscribeConfigured, transcribeAudio } from '@/lib/transcribe';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 面談の録音を1区間ずつ受け取り、Gemini で文字起こしして返す。
// 仕組みは部門会議議事録（app/api/dept-minutes/transcribe/route.ts）と同じで、
// 違うのは Gemini への説明（面談の録音であること・話者の付け方）だけ。
// 区間に分けて送るのは画面側（lib/useAudioTranscriber.ts）。

// 文字起こしが使える設定か（?check=1 で実際に Gemini へ問い合わせる）。
export async function GET(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  if (new URL(req.url).searchParams.get('check') === '1') {
    const r = await checkTranscribeSetup();
    return Response.json({ configured: isTranscribeConfigured(), ...r });
  }
  return Response.json({ ok: true, configured: isTranscribeConfigured() });
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (!isTranscribeConfigured()) return Response.json({ ok: false, reason: 'not_configured' });

  let audio: unknown;
  try {
    const form = await req.formData();
    audio = form.get('audio');
  } catch {
    return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json({ ok: false, reason: 'empty' }, { status: 400 });
  }

  // 実行環境によっては File がグローバルに無いため、instanceof ではなく name の有無で判断する。
  const given = (audio as { name?: unknown }).name;
  const name = typeof given === 'string' && given ? given : 'segment.wav';

  const r = await transcribeAudio(audio, name, 'interview');
  if (r.ok) return Response.json({ ok: true, text: r.text });
  return Response.json(
    { ok: false, reason: r.reason, detail: r.detail, retryAfterSec: r.retryAfterSec },
    { status: r.reason === 'not_configured' ? 200 : 502 },
  );
}
