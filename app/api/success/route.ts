import { getSession } from '@/lib/auth';
import { callGas, gasErrorStatus, gasItems } from '@/lib/gas';

export const runtime = 'nodejs';
export const maxDuration = 30;

export type SuccessRow = {
  ts: string;
  campus: string;
  user: string;
  title: string;
  action: string;
  result: string;
  point: string;
};

// ダッシュボード用：全部門の成功事例を新しい順に取得する（GAS action:'listSuccess'）。
// 「成功事例」シートは「報告」からの転記時に自動で積み上がる。
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });

  const r = await callGas('listSuccess');
  if (!r.ok) return Response.json({ ...r, items: [] }, { status: gasErrorStatus(r.reason) });

  const items: SuccessRow[] = gasItems(r.data).map((row) => ({
    ts: String(row?.ts ?? ''),
    campus: String(row?.campus ?? ''),
    user: String(row?.user ?? ''),
    title: String(row?.title ?? ''),
    action: String(row?.action ?? ''),
    result: String(row?.result ?? ''),
    point: String(row?.point ?? ''),
  }));
  return Response.json({ ok: true, items });
}
