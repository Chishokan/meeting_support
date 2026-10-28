import { getSession } from '@/lib/core/auth';
import {
  checkTranscribeSetup,
  geminiKeyCount,
  isTranscribeConfigured,
  transcribeAudio,
  transcribeRpm,
} from '@/lib/transcribe';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 録音データ（音声ファイル）を1区間ずつ受け取り、Gemini で文字起こしして返す。
// 長い会議は画面側（components/DeptMinutesUI.tsx）で区間に分けて順番に送る。
// サーバ関数の実行時間・リクエストサイズの上限に収めるための分割なので、
// 区間の長さを変えるときは lib/audioChunk.ts の SEGMENT_SECONDS を直すこと。

// 文字起こしが使える設定かを画面へ伝える（未設定ならテキスト貼り付けを案内する）。
// ?check=1 を付けると、実際に Gemini へ問い合わせてキーとモデル名まで確かめる
//（画面の「接続テスト」ボタン用。音声を送る前に設定ミスを見つけるためのもの）。
export async function GET(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  if (new URL(req.url).searchParams.get('check') === '1') {
    const r = await checkTranscribeSetup();
    return Response.json({ configured: isTranscribeConfigured(), ...r });
  }
  // rpm（キー1本あたり1分間の上限）と keys（本数）は、画面が送信の間隔を決めるために使う。
  // 別プロジェクトのキーを足すと上限は本数ぶん増えるので、画面は rpm × keys まで送る。
  return Response.json({
    ok: true,
    configured: isTranscribeConfigured(),
    rpm: transcribeRpm(),
    keys: geminiKeyCount(),
  });
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (!isTranscribeConfigured()) return Response.json({ ok: false, reason: 'not_configured' });

  let form: FormData;
  let audio: unknown;
  try {
    form = await req.formData();
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

  // どのキーで送るかは画面が決める（1つのタブが順番に送るので、本数ぶんを均等に使える）。
  // サーバ側の記憶は呼び出しごとに消えることがあり、そこに任せると毎回1本目へ偏ってしまう。
  const keyNo = Number(form.get('keyNo'));
  const r = await transcribeAudio(audio, name, Number.isFinite(keyNo) ? keyNo : undefined);
  if (r.ok) return Response.json({ ok: true, text: r.text });
  // 理由のほかに、短い手がかり（HTTP 429 / RESOURCE_EXHAUSTED など）と
  // 「何秒待てば通るか」も返す。画面はこれを見て待ち時間を決め、原因も表示する。
  // not_configured は画面が案内を出すための状態なので 200 で返す（通信エラーと区別する）。
  // キーが複数あるときは、何本試して落ちたかも手がかりに足す。
  const detail = r.keysTried && r.keysTried > 1 ? `${r.detail || ''}・キー${r.keysTried}本すべて` : r.detail;
  return Response.json(
    { ok: false, reason: r.reason, detail, retryAfterSec: r.retryAfterSec },
    { status: r.reason === 'not_configured' ? 200 : 502 },
  );
}
