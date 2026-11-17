// 成績管理（本番レベル模試。/moshi）を使える部門。総合メニューのカード（lib/portalApps.ts）・
// 成績管理のレイアウト（app/(seiseki)/layout.tsx）・各画面・API で使う。
// ★生徒の氏名・成績を扱うので、いまは管理部門（総務・人事・支援・管理）だけが開ける。
//   小中等部に広げるときは、ここに '小中等部' を足すだけでよい（メニュー・画面・API のすべてがここを読む）。

import { ADMIN_CAMPUS } from '../core/staff';

export const MOSHI_DEPTS = [ADMIN_CAMPUS];

export function canUseMoshi(campus: string): boolean {
  return MOSHI_DEPTS.includes(campus);
}
