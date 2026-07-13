// 職員マスタ（テスト運用用）。事業部ごとの担当者一覧。
// テスト運用が終わり本認証に戻す際は、login 画面・API とあわせてこのファイルの扱いを見直す。

export type StaffGroup = { campus: string; names: string[] };

export const STAFF: StaffGroup[] = [
  { campus: '小中等部', names: ['安東瑞輝', '安田浩晃', '池田貴光', '山中誠', '太田暁', '檀上徳之', '越智秀也'] },
  { campus: 'RED個別', names: ['宮ケ中葉子', '福元崇恭', '亀谷新', '瀬戸山理恵', '山田佑咲', '冨田翔太', '中山信哉'] },
  { campus: '高等部', names: ['田﨑幸治'] },
  { campus: 'LEC', names: ['大谷朋美'] },
  { campus: '管理', names: ['安藤純平', '冨松太一', '直江弘明', '小山英樹'] },
];

export function isValidStaff(campus: string, name: string): boolean {
  const g = STAFF.find((s) => s.campus === campus);
  return !!g && g.names.includes(name);
}
