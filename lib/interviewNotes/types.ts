// 面談記録の保存行（一覧 API が返す形）。画面と API の両方で使う。

import type { InterviewMeta } from '@/lib/interviewNotes/prompt';

export type InterviewNoteRow = InterviewMeta & {
  id: string; // 記録ID。これを添えて保存し直すと元の行を上書きする
  ts: string; // 最初に保存した日時
  campus: string; // 記録者の部門（閲覧範囲の判定に使う）
  user: string; // 記録者
  note: string; // 面談記録の本文
  checks: string; // 確認事項
  editedAt: string; // 直して保存し直したときだけ入る
  editedBy: string;
};
