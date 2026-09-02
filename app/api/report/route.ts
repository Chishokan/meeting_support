import { getSession, type Session } from '@/lib/auth';
import { extractSuccessCases } from '@/lib/successCases';

export const runtime = 'nodejs';

// 報告文に「■ 成功事例（全体共有）」があれば、全社集約用シートへ1件ずつ記録する。
// あくまで転記の付随処理。失敗しても報告そのものは成功扱いにする（0件を返すだけ）。
async function shareSuccessCases(url: string, session: Session, content: string): Promise<number> {
  const cases = extractSuccessCases(content);
  if (cases.length === 0) return 0;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveSuccess',
        token: process.env.APPS_SCRIPT_TOKEN || '',
        ts: new Date().toISOString(),
        campus: session.campus,
        user: session.name,
        cases,
      }),
    });
    const j = await res.json().catch(() => null);
    return res.ok && j && j.ok === true ? cases.length : 0;
  } catch {
    return 0;
  }
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

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured' });

  const payload = {
    action: 'appendReport',
    token: process.env.APPS_SCRIPT_TOKEN || '',
    ts: new Date().toISOString(),
    campus: session.campus,
    user: session.name,
    content,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // GAS(ContentService)は失敗時も HTTP 200 を返すため、本文の ok/reason を必ず確認する。
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true) {
      const shared = await shareSuccessCases(url, session, content);
      return Response.json({ ok: true, success: shared });
    }
    return Response.json(
      { ok: false, reason: (j && j.reason) || 'upstream_error' },
      { status: 502 },
    );
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }
}
