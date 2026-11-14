// 智翔館AI：要望。既存の「問い合わせ」（Apps Script の saveInquiry）に、種別「智翔館AIへの要望」で入れる。
// ヘルプデスクの「ご意見・不具合」に一覧が出て、管理者が回答を書ける。見本の画像も付けられる（Drive に保存される）。
// 中身の組み立ては lib/chishokanAi/request.ts。Apps Script の再デプロイは要らない（saveInquiry は前からある）。

import { getSession } from '@/lib/core/auth';
import { canUseChishokanAi } from '@/lib/chishokanAi/access';
import { callGas } from '@/lib/chishokanAi/gas';
import { checkRequest, formatRequest, REQUEST_CATEGORY } from '@/lib/chishokanAi/request';

export const runtime = 'nodejs';
export const maxDuration = 30;

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_CHARS = 3_000_000; // base64 の長さ（画面で縮小してから送る）

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, message: 'ログインし直してください。' }, { status: 401 });
  if (!canUseChishokanAi(session.name)) return Response.json({ ok: false, message: '試用メンバーではありません。' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const c = checkRequest(body);
  if (!c.ok) return Response.json({ ok: false, message: c.message }, { status: 400 });
  const content = formatRequest(c.input);

  const payload: Record<string, unknown> = {
    action: 'saveInquiry',
    ts: new Date().toISOString(),
    campus: session.campus,
    user: session.name,
    category: REQUEST_CATEGORY,
    content,
  };
  const img = body?.image;
  if (img && typeof img.data === 'string' && img.data.length <= MAX_IMAGE_CHARS && IMAGE_MIMES.includes(String(img.mime))) {
    payload.imageData = img.data;
    payload.imageMime = String(img.mime);
    payload.imageName = `chishokan-ai-request_${Date.now()}.${String(img.mime).split('/')[1] === 'jpeg' ? 'jpg' : String(img.mime).split('/')[1]}`;
  }

  console.log('[chishokan-ai request]', JSON.stringify({ user: session.name, campus: session.campus, kind: c.input.kind, content }));
  if (!process.env.APPS_SCRIPT_URL) {
    return Response.json({ ok: false, message: '要望の送り先が設定されていません（システム担当に連絡してください）。' }, { status: 503 });
  }
  const j = await callGas(payload);
  if (!j.ok) return Response.json({ ok: false, message: '要望を保存できませんでした。時間をおいてもう一度送ってください。' }, { status: 502 });
  return Response.json({ ok: true });
}
