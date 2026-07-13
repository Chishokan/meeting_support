import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import ChatUI from '@/components/ChatUI';

export default function ChatPage() {
  const s = getSession();
  if (!s) redirect('/login');
  return <ChatUI name={s.name} campus={s.campus} />;
}
