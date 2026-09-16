import { getSession } from '@/lib/auth';
import { callGas, gasErrorStatus, gasItems } from '@/lib/gas';
import { parseProgressItems } from '@/lib/progressPrompt';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ダッシュボード用：直近の中間報告（部門・報告者・日時・項目ごとの進捗）を GAS から取得する。
// 「中間報告状況」シートを新しい順に返す（GAS action:'listProgress'）。
// 本文はここで項目と進捗だけに変換して返す（完了予定日・原因はクライアントへ渡さない）。
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });

  const r = await callGas('listProgress');
  if (!r.ok) return Response.json({ ...r, items: [] }, { status: gasErrorStatus(r.reason) });

  const items = gasItems(r.data).map((row) => ({
    ts: String(row?.ts ?? ''),
    campus: String(row?.campus ?? ''),
    user: String(row?.user ?? ''),
    progress: parseProgressItems(String(row?.content ?? '')),
  }));
  return Response.json({ ok: true, items });
}
