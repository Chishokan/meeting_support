import MonpaiBoardUI from '@/components/MonpaiBoardUI';
import { STAFF } from '@/lib/core/staff';
import { listStaff } from '@/lib/monpai/store';

export default async function MonpaiPage() {
  // 担当欄の候補：社員（職員マスタ）＋門配スタッフ（名簿でログインできる人）
  const r = await listStaff();
  const part = r.ok ? r.items.filter((s) => s.active).map((s) => s.name) : [];
  const staffNames = Array.from(new Set([...STAFF.flatMap((g) => g.names), ...part]));
  return <MonpaiBoardUI staffNames={staffNames} />;
}
