// 智翔館AI（/ai）を使える人。
// 2026-11-26 試用期間を終え、使える人を **太田暁・瀬戸山理恵と、管理部門の方** だけにした。
// 2026-11-26 在津先生・大谷朋美・小潟理紗を足した（在津先生は名字で判定）。
// - 管理部門：いまの部門（ログインした部門）が「総務・人事・支援・管理」の人
// - 名前は空白を除いて比べる（「太田 暁」でも同じ）
// ★使える人を足すときは AI_MEMBERS に名前を足す（職員マスタ lib/core/staff.ts と同じ書き方）。
//   試用中に使っていた環境変数 CHISHOKAN_AI_MEMBERS は、もう読まない（Vercel から消してよい）。
// メニューのカード・画面のレイアウト・API のすべてがここを読む。ほかに依存しない（テストしやすいように）。

/** 使える人（管理部門のほか）。 */
export const AI_MEMBERS = ['太田暁', '瀬戸山理恵', '大谷朋美', '小潟理紗'];
/** 名字だけで決める人（職員マスタに名前が無い人。名前が分かったら AI_MEMBERS に移す）。 */
export const AI_MEMBER_SURNAMES = ['在津'];
/** 管理部門（lib/core/staff.ts の ADMIN_CAMPUS と同じ。テストで確かめている）。 */
export const AI_ADMIN_CAMPUS = '総務・人事・支援・管理';
/** 使えない人に出す文（画面・API）。 */
export const AI_DENIED_MESSAGE = '智翔館AIは開発中です。';
// （2026-11-26：使える人の名前は出さず「開発中」とだけ出す。メニューのカードも「開発中」）

const norm = (s: string) => String(s ?? '').replace(/[\s　]+/g, '');

export function canUseChishokanAi(who: { name: string; campus: string } | null | undefined): boolean {
  if (!who) return false;
  if (norm(who.campus) === norm(AI_ADMIN_CAMPUS)) return true;
  const name = norm(who.name);
  return !!name && (AI_MEMBERS.some((m) => norm(m) === name) || AI_MEMBER_SURNAMES.some((m) => name.startsWith(norm(m))));
}
