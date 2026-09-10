import { getSession } from '@/lib/auth';
import { isTranscribeConfigured, transcribeAudio } from '@/lib/transcribe';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 録音データ（音声ファイル）を1区間ずつ受け取り、Gemini で文字起こしして返す。
// 長い会議は画面側（components/DeptMinutesUI.tsx）で区間に分けて順番に送る。
// サーバ関数の実行時間・リクエストサイズの上限に収めるための分割なので、
// 区間の長さを変えるときは lib/audioChunk.ts の SEGMENT_SECONDS を直すこと。

// 文字起こしが使える設定かを画面へ伝える（未設定ならテキスト貼り付けを案内する）。
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
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

  const r = await transcribeAudio(audio, name);
  if (r.ok) return Response.json({ ok: true, text: r.text });
  // not_configured は画面が案内を出すための状態なので 200 で返す（通信エラーと区別する）。
  return Response.json({ ok: false, reason: r.reason }, { status: r.reason === 'not_configured' ? 200 : 502 });
}
