// Zoom ミーティングを「ホストとして開始」できる人の判定（Zoom連携）。
// 自動クラウド録画はホストが開始したときに始まるため、開始できる人を決めておく。
//   ・管理部門 … 全部門の会議
//   ・部門長権限者（給与アプリの部門管理者）… 自分の部門の会議
// 従来のログイン（部門と名前を選ぶ）は Cookie に署名が無く、部門を書き換えられる。
// 開始用URLを持つ人はホストとして会議を操作できるので、共通ログインで入った人（uid がある）にだけ許す。
//
// ★画面・API・テストのどこからでも読めるよう、ここには import を置かない（型と計算だけ）。

export type HostCandidate = {
  uid?: number; // 共通ログインで入った人だけが持つ
  campus: string; // いま使っている部門
  deptAdmin?: boolean; // 部門長権限（給与アプリの dept_admin）
};

export function canHostMeeting(
  who: HostCandidate | null | undefined,
  meetingCampus: string,
  adminCampus: string,
): boolean {
  if (!who || typeof who.uid !== 'number') return false;
  if (who.campus === adminCampus) return true;
  return who.deptAdmin === true && Boolean(meetingCampus) && who.campus === meetingCampus;
}

/**
 * 録画から作った議事録の下書き（文字起こしの全文を含む）を見られる人・作らせられる人。
 * 会議の中身そのものなので、その部門の人・事前共有した本人・管理部門に限る。
 */
export function canUseRecording(
  who: { name: string; campus: string } | null | undefined,
  row: { campus: string; user: string },
  adminCampus: string,
): boolean {
  if (!who) return false;
  if (who.campus === adminCampus) return true;
  if (row.campus && who.campus === row.campus) return true;
  return Boolean(row.user) && who.name === row.user;
}
