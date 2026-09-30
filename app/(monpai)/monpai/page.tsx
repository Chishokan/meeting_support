import MonpaiBoardUI from '@/components/MonpaiBoardUI';
import { STAFF } from '@/lib/core/staff';

export default function MonpaiPage() {
  const staffNames = Array.from(new Set(STAFF.flatMap((g) => g.names)));
  return <MonpaiBoardUI staffNames={staffNames} />;
}
