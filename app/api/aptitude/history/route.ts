// 適性検査：受検履歴（受検1回＝1行）。管理部門のみ。
import { listHistory } from '@/lib/aptitude/store';
import { reply, staffGate } from '@/lib/aptitude/api';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function GET() {
  const g = staffGate();
  if (g.res) return g.res;
  return reply(await listHistory());
}
