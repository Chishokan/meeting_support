// ロールで開けるアプリ（統合計画 第4段階）。総合メニュー（app/(portal)/page.tsx）と middleware.ts が読む。
//   社員（admin＝管理者・staff＝教室担当者・employee＝授業担当者）と、従来のログインの人は、これまでどおり全アプリ
//   （使えるかどうかは各アプリの部門・名前の決まり。lib/<アプリ>/access.ts など）。
//   スタッフ（teacher＝講師・アルバイト）は ROLE_APPS のアプリだけ。ほかのアプリは
//     ・総合メニューにカードを出さない
//     ・画面を URL で開くと総合メニューへ戻し、API は 403 を返す（middleware.ts）
//   スタッフに開いたアプリでも、各アプリの決まり（智翔館AIの試用メンバー・イベント申込管理の部門）はそのまま効く。
//
// ★スタッフに開くアプリを増やすときは、ROLE_APPS にアプリの id（lib/portalApps.ts の id）を足し、
//   APP_PATHS にそのアプリの画面と、画面が呼ぶ API の URL を足す（テストは `npm test`）。
//   ここに無いアプリ（新しく作ったアプリも）は、URL を知っていてもスタッフには開かない。
// ★従来のログイン（部門とお名前を選ぶ）にはロールが無く、社員として全アプリに入れる。スタッフの制限が効くのは
//   共通ログイン（メールアドレス＋パスワード）で入った人だけなので、並行運用が終わったら LEGACY_LOGIN=off にする（統合計画 第7段階）。
// ★middleware（Edge で動く）からも読むので、型のほかは import しない。

import type { HubRole } from './core/auth';

/** スタッフに開いているアプリの id（lib/portalApps.ts の id と同じ）。 */
export type RoleAppId = 'meeting' | 'chishokan-ai' | 'event';

/** 全アプリを開くロール（社員）。ロールの無い人（従来のログイン）も全アプリ。 */
const FULL_ROLES: readonly HubRole[] = ['admin', 'staff', 'employee'];

/** 社員でないロールに開くアプリ。ここにも FULL_ROLES にも無いロールには、どのアプリも開かない。 */
export const ROLE_APPS: Partial<Record<HubRole, readonly RoleAppId[]>> = {
  teacher: ['meeting', 'chishokan-ai', 'event'],
};

/** アプリの画面と、その画面が呼ぶ API の URL（前方一致。「/」の区切りまで見る）。 */
export const APP_PATHS: Record<RoleAppId, readonly string[]> = {
  // 会議DX（app/(app)/ の左メニューの画面と、その画面が呼ぶ API）
  meeting: [
    '/dashboard',
    '/dept-minutes',
    '/numbers',
    '/chat',
    '/meeting-review',
    '/report',
    '/progress',
    '/task-report',
    '/task-coach',
    '/task-eval',
    '/api/dept-minutes',
    '/api/minutes',
    '/api/numbers',
    '/api/chat',
    '/api/report',
    '/api/meeting-review',
    '/api/progress',
    '/api/task-report',
    '/api/task-coach',
    '/api/task-eval',
    '/api/share-items',
    '/api/success',
    '/api/yoko-qa', // ダッシュボードの「要項」のカード
    '/api/zoom/meetings', // 部門会議の Zoom ミーティングを開始する
    '/api/zoom/minutes', // Zoom の録画から部門会議の議事録を作る
  ],
  // 智翔館AI（app/(ai)/）
  'chishokan-ai': ['/ai', '/api/chishokan-ai'],
  // イベント申込管理（app/(event)/）
  event: ['/event', '/api/event'],
};

/**
 * ロールに関係なく開ける URL（総合メニューの「/」も。カードはロールで絞る）。
 *   ・ログイン・ログアウト（スタッフがログインしたままの端末で、社員がログインし直せるように）
 *   ・智翔館アプリのログインを使わない画面（適性検査の受検＝受検URLのトークン、門配スタッフ＝別のログイン）
 */
export const OPEN_PATHS: readonly string[] = [
  '/login',
  '/api/login',
  '/api/logout',
  '/api/auth/login',
  '/api/auth/handoff',
  '/exam',
  '/api/exam',
  '/monpai-staff',
  '/api/monpai-staff',
];

/** path が prefix と同じか、その下か（/monpai が /monpai-staff に、/event が /events に当たらないように）。 */
function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** そのロールに開いているアプリ。絞らないロール（社員・ロールの無い従来のログイン）は null。 */
function appsOf(role: string | undefined): readonly RoleAppId[] | null {
  if (!role || (FULL_ROLES as readonly string[]).includes(role)) return null;
  if (!Object.prototype.hasOwnProperty.call(ROLE_APPS, role)) return [];
  return ROLE_APPS[role as HubRole] ?? [];
}

/** そのロールで、総合メニューにアプリのカードを出すか。 */
export function roleCanUseApp(role: string | undefined, appId: string): boolean {
  const apps = appsOf(role);
  return !apps || (apps as readonly string[]).includes(appId);
}

/** そのロールで、この URL（画面・API）を開いてよいか（middleware.ts）。社員は全部通す（部門などは各画面・API が確かめる）。 */
export function roleCanOpenPath(role: string | undefined, path: string): boolean {
  const apps = appsOf(role);
  if (!apps) return true;
  if (path === '/') return true;
  if (OPEN_PATHS.some((p) => under(path, p))) return true;
  return apps.some((id) => APP_PATHS[id].some((p) => under(path, p)));
}
