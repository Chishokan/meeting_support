// イベント申込管理（/event）を使える部門。総合メニューのカード（lib/portalApps.ts）・レイアウト・画面・API で使う。
// ★生徒の氏名・夢・志望校と、申込フォームの回答（保護者の氏名・連絡先）を扱うので、小中等部と管理部門の職員だけが開ける。
//   部門を増やす・減らすときは、ここだけ直す。

import { ADMIN_CAMPUS } from '../core/staff';

export const EVENT_DEPTS = ['小中等部', ADMIN_CAMPUS];

export function canUseEvent(campus: string): boolean {
  return EVENT_DEPTS.includes(campus);
}

/** 管理担当（全校舎の進み具合から見る人）。 */
export function isEventAdmin(campus: string): boolean {
  return campus === ADMIN_CAMPUS;
}
