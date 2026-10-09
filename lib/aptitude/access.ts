// 適性検査（/aptitude）を開ける部門。
// 性格検査の結果は機微な個人情報なので、管理部門（総務・人事・支援・管理）に限定する。
// ★部門を増やすときはここだけ直す（メニューのカード・画面のレイアウト・API のすべてがここを読む）。
// 受検画面（/exam/[token]）はログイン不要で、受検URLのトークンだけで開く。

import { ADMIN_CAMPUS } from '../core/staff';

export const APTITUDE_DEPTS = [ADMIN_CAMPUS];

export function canUseAptitude(campus: string): boolean {
  return APTITUDE_DEPTS.includes(campus);
}
