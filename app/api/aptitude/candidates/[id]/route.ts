// 適性検査：受検者1人の詳細。管理部門のみ。
//   GET    … 詳細（受検・結果・閲覧ログ）。結果があれば「結果閲覧」を記録する（同じ人の10分以内の読み直しは1件）
//   PUT    … プロフィール・採用結果・入社後の評価の更新（編集のポップアップ）
//   PATCH  … 採用結果・入社後の評価だけの更新（詳細の画面の欄。ほかの項目は変えない）
//   DELETE … 削除（一覧から消える。30日後に完全に消す）
import { deleteCandidate, getCandidate, updateCandidate, updateHire } from '@/lib/aptitude/store';
import { validateCandidate, validateHire } from '@/lib/aptitude/model';
import { invalid, reply, staffGate } from '@/lib/aptitude/api';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const g = staffGate();
  if (g.res) return g.res;
  return reply(await getCandidate(params.id, g.actor));
}

export async function PUT(req: Request, { params }: Ctx) {
  const g = staffGate();
  if (g.res) return g.res;
  const v = validateCandidate(await req.json().catch(() => ({})));
  if (!v.ok) return invalid(v.errors);
  return reply(await updateCandidate(params.id, v.value, g.actor));
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = staffGate();
  if (g.res) return g.res;
  const v = validateHire(await req.json().catch(() => ({})));
  if (!v.ok) return invalid(v.errors);
  return reply(await updateHire(params.id, v.value, g.actor));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const g = staffGate();
  if (g.res) return g.res;
  return reply(await deleteCandidate(params.id, g.actor));
}
