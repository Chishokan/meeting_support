// 面談記録（/interview-notes）を誰が見られるか。
// 生徒・保護者の個人的な事情を含むため、一覧と詳細は「同じ部門の記録だけ」に絞る。
// 管理部門は全部門の記録を見られる。記録の作成は全部門ができる。
// ★範囲を変えるときはここだけ直す（一覧 API と保存 API の両方がここを読む）。

import { ADMIN_CAMPUS } from '@/lib/core/staff';

export function canSeeAllInterviewNotes(campus: string): boolean {
  return campus === ADMIN_CAMPUS;
}

export function canSeeInterviewNote(viewerCampus: string, noteCampus: string): boolean {
  return canSeeAllInterviewNotes(viewerCampus) || viewerCampus === noteCampus;
}
