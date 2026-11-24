// Zoom ミーティングを「ホストとして開始」できる人の判定（Zoom連携）。
// 自動クラウド録画はホストが開始したときに始まる。ホストとして入る人は Zoom のアカウント（公式1・公式2）
// そのものになるので、何人も入ると混乱する（そのアカウントで別の会議が進行中だと、Zoom が終了を求めてくる）。
// そのため、ホストは会議ごとに1人（ホスト担当）と決める。
//   ・ホスト担当は、事前共有で Zoom ミーティングを作るときに選ぶ（選ばなければ、事前共有した本人）
//   ・ホスト担当だけが［ホストとして開始］を押せる。ほかの人は［Zoomに参加］から入る
//   ・ホスト担当は、その部門の人・事前共有した本人・管理部門が、あとから替えられる（当日来られなくなったときなど）
// 従来のログイン（部門と名前を選ぶ）は Cookie に署名が無く、名前を書き換えられる。
// 開始用URLを持つ人はホストとして会議を操作できるので、共通ログインで入った人（uid がある）にだけ許す。
//
// ★画面・API・テストのどこからでも読めるよう、ここには import を置かない（型と計算だけ）。

/** その会議のホスト担当。決めてあればその人、無ければ事前共有した本人。 */
export function hostOf(row: { user: string }, chosen: string | undefined | null): string {
  return String(chosen ?? '').trim() || row.user;
}

/** ［ホストとして開始］を押せるか（ホスト担当の本人で、共通ログインで入っている）。 */
export function canHostMeeting(
  who: { uid?: number; name: string } | null | undefined,
  host: string,
): boolean {
  if (!who || typeof who.uid !== 'number') return false;
  return Boolean(host) && who.name === host;
}

/** ホスト担当を替えられるか（その部門の人・事前共有した本人・管理部門）。 */
export function canSetHost(
  who: { name: string; campus: string } | null | undefined,
  row: { campus: string; user: string },
  adminCampus: string,
): boolean {
  return canUseRecording(who, row, adminCampus);
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
