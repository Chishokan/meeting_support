import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import AdminUsersUI from '@/components/AdminUsersUI';

// アカウント管理（管理者のみ）。layout でログインは確認済み。
export default function AdminUsersPage() {
  const s = getSession();
  if (!s || s.role !== 'admin') redirect('/');
  return <AdminUsersUI selfId={s.uid} />;
}
