// 本番レベル模試（/moshi）を使える部門。左メニュー（components/Sidebar.tsx）・画面・API の3か所で使う。
// ★生徒の氏名・成績を扱うので、小中等部の職員だけが開ける。広げるときはここだけ直す。

export const MOSHI_DEPTS = ['小中等部'];

export function canUseMoshi(campus: string): boolean {
  return MOSHI_DEPTS.includes(campus);
}
