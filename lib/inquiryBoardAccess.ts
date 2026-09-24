// 問合せ管理（/inquiry-board）と問い合わせQA を開ける部門。
// 生徒・保護者の個人情報（氏名・電話・住所）を扱うため、小中等部と管理部門に限定する。
// ★部門を増やすときはここだけ直す（画面と API の両方がここを読む）。

import { ADMIN_CAMPUS } from './staff';

export const INQUIRY_BOARD_DEPTS = ['小中等部', ADMIN_CAMPUS];

export function canUseInquiryBoard(dept: string): boolean {
  return INQUIRY_BOARD_DEPTS.includes(dept);
}
