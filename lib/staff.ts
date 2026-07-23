// 職員マスタ（テスト運用用）。事業部ごとの担当者一覧。
// テスト運用が終わり本認証に戻す際は、login 画面・API とあわせてこのファイルの扱いを見直す。

export type StaffGroup = { campus: string; names: string[] };

export const STAFF: StaffGroup[] = [
  { campus: '小中等部', names: ['安東瑞輝', '安田浩晃', '池田貴光', '山中誠子', '太田暁', '檀上徳之', '越智秀也', '小潟理紗'] },
  { campus: 'RED個別', names: ['福元崇恭', '亀谷新', '瀬戸山理恵', '山田佑咲', '冨田翔太', '中山信哉'] },
  { campus: '高等部', names: ['田﨑幸治', '安田浩晃'] },
  { campus: 'LEC', names: ['大谷朋美'] },
  { campus: '英検', names: ['中山信哉'] },
  { campus: '総務・人事・支援・管理', names: ['安藤純平', '冨松太一', '直江弘明', '小山英樹', '宮ケ中葉子', '直江英恵'] },
];

// 管理部門（この部門でログインした人だけが中間報告の定例項目編集・問い合わせ回答などを行える）。
export const ADMIN_CAMPUS = '総務・人事・支援・管理';

export function isValidStaff(campus: string, name: string): boolean {
  const g = STAFF.find((s) => s.campus === campus);
  return !!g && g.names.includes(name);
}
