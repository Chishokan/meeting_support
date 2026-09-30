// 問合せ管理（/inquiry-board）と問い合わせQA を開ける人。
// 生徒・保護者の個人情報（氏名・電話・住所）を扱うため、次の人に限定する。
//   ・管理者（role=admin）
//   ・講師以外で、部門が INQUIRY_BOARD_DEPTS のどれか、または担当教室に問合せ管理の校舎を持つ人
// ★条件を変えるときはここだけ直す（メニュー・画面・API のすべてがここを読む）。

import { ADMIN_CAMPUS } from './core/staff';
import type { Role } from './core/roles';
import { BOARD_CAMPUSES } from './inquiryRecords';

export const INQUIRY_BOARD_DEPTS = ['小中等部', ADMIN_CAMPUS];

export type Who = { role: Role; campus: string; classrooms: string[] };

export function canUseInquiryBoard(who: Who): boolean {
  if (who.role === 'admin') return true;
  if (who.role === 'teacher') return false;
  if (INQUIRY_BOARD_DEPTS.includes(who.campus)) return true;
  return who.classrooms.some((c) => (BOARD_CAMPUSES as readonly string[]).includes(c));
}
