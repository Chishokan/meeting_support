// イベント申込管理（/event）を使える部門。総合メニューのカード（lib/portalApps.ts）・レイアウト・画面・API で使う。
// ★生徒の氏名・夢・志望校と、申込フォームの回答（連絡先）を扱うので、名簿のある部門（小中等部・RED個別）と管理部門の職員だけが開ける。
//   小中等部・RED個別の職員には、自分の部門の生徒だけを返す（eventScope。API で絞る）。管理部門は全部門を見る。
//   部門を増やす・減らすときは、ここと lib/eventList/event.ts の DEPTS を直す。

import { ADMIN_CAMPUS } from '../core/staff';
import { DEPTS } from './event';

export const EVENT_DEPTS = [...DEPTS, ADMIN_CAMPUS];

export function canUseEvent(campus: string): boolean {
  return EVENT_DEPTS.includes(campus);
}

/** 見える名簿の部門。管理部門は null（全部門）。 */
export function eventScope(campus: string): string | null {
  return campus === ADMIN_CAMPUS ? null : campus;
}

/** 管理担当（全校舎の進み具合から見る人）。 */
export function isEventAdmin(campus: string): boolean {
  return campus === ADMIN_CAMPUS;
}
