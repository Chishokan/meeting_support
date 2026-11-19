// 智翔館AI：NEPへの作成依頼（AI が出した案の［この内容でNEPへ作成依頼を出す］を押したとき）。
// 既存の「問い合わせ」（Apps Script の saveInquiry）に、種別「NEPへの制作依頼」で入れる。ヘルプデスクの「ご意見・不具合」に一覧が出て、
// NEP（管理者）が返事を書ける。Apps Script の再デプロイは要らない（saveInquiry は前からある）。
// 案の作り方は lib/chishokanAi/nepRequest.ts（propose_nep_request）。

import { getSession, verifiedEmail } from '@/lib/core/auth';
import { canUseChishokanAi } from '@/lib/chishokanAi/access';
import { callGas } from '@/lib/chishokanAi/gas';
import { logAi } from '@/lib/chishokanAi/aiLog';
import { checkNepRequest, formatNepRequest, NEP_REQUEST_CATEGORY } from '@/lib/chishokanAi/nepRequest';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, message: 'ログインし直してください。' }, { status: 401 });
  if (!canUseChishokanAi(session.name)) return Response.json({ ok: false, message: '試用メンバーではありません。' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const c = checkNepRequest(body ?? {});
  if (!c.ok) return Response.json({ ok: false, message: c.message }, { status: 400 });
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.slice(0, 40) : '';
  const content = formatNepRequest(c.value, { conversationId });
  if (!process.env.APPS_SCRIPT_URL) {
    return Response.json({ ok: false, message: '依頼の送り先が設定されていません（システム担当に連絡してください）。' }, { status: 503 });
  }
  const j = await callGas({ action: 'saveInquiry', ts: new Date().toISOString(), campus: session.campus, user: session.name, category: NEP_REQUEST_CATEGORY, content });
  if (!j.ok) return Response.json({ ok: false, message: '依頼を送れませんでした。時間をおいてもう一度押してください。' }, { status: 502 });
  void logAi(
    {
      user: session.name,
      campus: session.campus,
      email: verifiedEmail() ?? '',
      kind: '制作依頼',
      conversationId,
      question: `${c.value.kind}｜${c.value.title}｜納品希望 ${c.value.due}`,
    },
    { input: `[智翔館AI NEPへの制作依頼] ${c.value.title}`, output: 'sent' },
    { timeoutMs: 8000 },
  );
  return Response.json({ ok: true });
}
