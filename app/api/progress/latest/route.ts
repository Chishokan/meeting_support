import { getSession } from '@/lib/auth';
import { parseProgressItems } from '@/lib/progressPrompt';

export const runtime = 'nodejs';
export const maxDuration = 30;

type GasRow = { ts?: unknown; campus?: unknown; user?: unknown; content?: unknown };

// ダッシュボード用：直近の中間報告（部門・報告者・日時・項目ごとの進捗）を GAS から取得する。
// 「中間報告状況」シートを新しい順に返す（GAS action:'listProgress'）。
// 本文はここで項目と進捗だけに変換して返す（完了予定日・原因はクライアントへ渡さない）。
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured', items: [] });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'listProgress', token: process.env.APPS_SCRIPT_TOKEN || '' }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true) {
      const rows: GasRow[] = Array.isArray(j.items) ? j.items : [];
      const items = rows.map((r) => ({
        ts: String(r?.ts ?? ''),
        campus: String(r?.campus ?? ''),
        user: String(r?.user ?? ''),
        progress: parseProgressItems(String(r?.content ?? '')),
      }));
      return Response.json({ ok: true, items });
    }
    return Response.json({ ok: false, reason: (j && j.reason) || 'upstream_error', items: [] }, { status: 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error', items: [] }, { status: 502 });
  }
}
