import { redirect } from 'next/navigation';
import { getSession } from '@/lib/core/auth';
import { canUseEvent, isEventAdmin } from '@/lib/eventList/access';
import EventListUI from '@/components/EventListUI';

export default function EventPage() {
  const s = getSession();
  if (!s) redirect('/login?next=/event');
  if (!canUseEvent(s.campus)) return null; // 案内はレイアウトが出す
  return <EventListUI admin={isEventAdmin(s.campus)} rooms={s.rooms ?? []} />;
}
