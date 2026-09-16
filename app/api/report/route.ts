import { getSession, type Session } from '@/lib/auth';
import { callGas, gasErrorStatus } from '@/lib/gas';
import { extractSuccessCases } from '@/lib/successCases';

export const runtime = 'nodejs';

// 報告文に「■ 成功事例（全体共有）」があれば、全社集約用シートへ1件ずつ記録する。
// あくまで転記の付随処理。失敗しても報告そのものは成功扱いにする（0件を返すだけ）。
async function shareSuccessCases(session: Session, content: string): Promise<number> {
  const cases = extractSuccessCases(content);
  if (cases.length === 0) return 0;
  const r = await callGas('saveSuccess', {
    ts: new Date().toISOString(),
    campus: session.campus,
    user: session.name,
    cases,
  });
  return r.ok ? cases.length : 0;
}

// 事前報告を Google ドキュメントへ転記する。
// Apps Script（APPS_SCRIPT_URL）に action:'appendReport' を送り、GAS 側で対象 Doc に追記する。
// APPS_SCRIPT_URL 未設定なら not_configured を返す（アプリは壊れない）。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const content = String(body?.content ?? '').trim();
  if (!content) return Response.json({ ok: false, reason: 'empty' }, { status: 400 });

  const r = await callGas('appendReport', {
    ts: new Date().toISOString(),
    campus: session.campus,
    user: session.name,
    content,
  });
  if (!r.ok) return Response.json(r, { status: gasErrorStatus(r.reason) });

  const shared = await shareSuccessCases(session, content);
  return Response.json({ ok: true, success: shared });
}
