// 総合画面（メニュー）に並べる智翔館アプリの一覧と、それぞれを使える人。
// ★アプリを増やすときはここに1件足すだけでメニューに出る。
//   status: 'ready'（使える）／'soon'（準備中：カードは出すが開けない）
//   canUse: ロール・部門・担当教室で使える人を絞る（省略すると全員）。
//           メニューの出し分けだけでなく、各アプリの画面（layout）でも同じ関数で確かめる。
//   external: 別のシステム（ColorHRM）へのリンク。新しいタブではなく同じタブで開く。
//
// 給与・シフト管理は ColorHRM（PHP・Xサーバー）の画面へのリンク。URL は環境変数で渡す
// （COLORHRM_PAYROLL_URL / COLORHRM_SHIFT_URL。未設定なら「準備中」）。
// ColorHRM 側のログインは別（連携仕様の SSO ができるまでは、ColorHRM の画面でもう一度ログインする）。

import type { Role } from './core/roles';
import { canUseInquiryBoard, type Who } from './inquiryBoardAccess';

export type { Who };

export type PortalApp = {
  id: string;
  name: string;
  desc: string;
  href: string;
  status: 'ready' | 'soon';
  external?: boolean;
  canUse?: (who: Who) => boolean;
  deniedNote?: string; // canUse で弾かれた人に出す一言
};

const notTeacher = (who: Who) => who.role !== 'teacher';
const roles = (...rs: Role[]) => (who: Who) => rs.includes(who.role);

export const canUseMeeting = notTeacher;
export const canUseMonpai = notTeacher;

export function portalApps(): PortalApp[] {
  const payrollUrl = (process.env.COLORHRM_PAYROLL_URL ?? '').trim();
  const shiftUrl = (process.env.COLORHRM_SHIFT_URL ?? '').trim();
  return [
    {
      id: 'meeting',
      name: '会議DX',
      desc: '会議AI・事前報告・議事録・中間報告など、会議の準備と振り返り',
      href: '/dashboard',
      status: 'ready',
      canUse: canUseMeeting,
      deniedNote: '社員（管理者・教室長・社員）のみ利用できます',
    },
    {
      id: 'inquiry-board',
      name: '問合せ管理',
      desc: '問い合わせを校舎ごとに登録し、体験・面談・入塾まで追いかける台帳',
      href: '/inquiry-board',
      status: 'ready',
      canUse: canUseInquiryBoard,
      deniedNote: '小中等部・管理部門、または小中等部の校舎を担当する人のみ利用できます',
    },
    {
      id: 'monpai',
      name: '門配管理',
      desc: '地区ごとの門配（校門前でのチラシ配布）の月間計画と実績報告',
      href: '/monpai',
      status: 'ready',
      canUse: canUseMonpai,
      deniedNote: '社員（管理者・教室長・社員）のみ利用できます',
    },
    {
      id: 'payroll',
      name: '給与',
      desc: '給与明細の確認・給与計算（ColorHRM）',
      href: payrollUrl,
      status: payrollUrl ? 'ready' : 'soon',
      external: true,
      canUse: roles('admin', 'staff', 'employee', 'teacher'),
    },
    {
      id: 'shift',
      name: 'シフト管理',
      desc: 'シフトの申請・確定・勤怠（ColorHRM）',
      href: shiftUrl,
      status: shiftUrl ? 'ready' : 'soon',
      external: true,
      canUse: roles('admin', 'staff', 'employee', 'teacher'),
    },
  ];
}
