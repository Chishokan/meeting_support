// 総合画面（メニュー）に並べる智翔館アプリの一覧。
// ★アプリを増やすときはここに1件足すだけでメニューに出る。
//   status: 'ready'（使える）／'soon'（準備中：カードは出すが開けない）
//   canUse: 部門（や名前）で使える人を絞るときに指定する（省略すると全員）。
//   external: 別の Web アプリ（別ドメイン）を開くカード。新しいタブで開く。

import { canUseInquiryBoard, INQUIRY_BOARD_DEPTS } from './inquiryBoardAccess';
import { canUseInterview, interviewAppUrl, INTERVIEW_DEPTS, type InterviewDept } from './interviewApp';
import { APTITUDE_DEPTS, canUseAptitude } from './aptitude/access';
import { canUseChishokanAi } from './chishokanAi/access';
import { hubConfigured } from './core/hub';
import { canUseColor } from './colorAccess';
import type { HubRole } from './core/auth';

// 面談管理は別アプリ（面談予約システム）の管理画面。部門ごとに URL が分かれている。
// 管理画面にはログインの仕組みが無く、カードは管理画面の URL をそのまま開く。
// 開ける部門・開く先は lib/interviewApp.ts。
function interviewApp(dept: InterviewDept): PortalApp {
  const { label, campuses } = INTERVIEW_DEPTS[dept];
  return {
    id: `interview-${dept}`,
    name: `面談管理（${label}）`,
    desc: '面談予約の確認・面談枠の設定・面談記録',
    href: `${interviewAppUrl()}/${dept}/admin`,
    status: 'ready',
    external: true,
    canUse: (campus) => canUseInterview(dept, campus),
    deniedNote: `${campuses.join('、')}のみ利用できます`,
  };
}

export type PortalApp = {
  id: string;
  name: string;
  desc: string;
  href: string;
  status: 'ready' | 'soon';
  canUse?: (campus: string, name: string, role?: HubRole) => boolean;
  deniedNote?: string; // canUse で弾かれた人に出す一言
  hideIfDenied?: boolean; // canUse で弾かれた人にはカードそのものを出さない
  external?: boolean;
};

export const PORTAL_APPS: PortalApp[] = [
  {
    id: 'chishokan-ai',
    name: '智翔館AI（試用版）',
    desc: '社内の資料をもとに答えるAI。資料づくりや文章の手直しにも',
    href: '/ai',
    status: 'ready',
    canUse: (_campus, name) => canUseChishokanAi(name),
    deniedNote: '試用中です（試用メンバーのみ利用できます）',
  },
  {
    id: 'meeting',
    name: '会議DX',
    desc: '部門会議・全体会議の事前共有、議事録、数値報告',
    href: '/dashboard',
    status: 'ready',
  },
  {
    id: 'kenshu',
    name: '全体研修会アンケート',
    desc: '10/31（土）全体研修会の事前アンケート',
    href: '/kenshu',
    status: 'ready',
  },
  {
    id: 'inquiry-board',
    name: '問合せ管理',
    desc: '問い合わせを入塾まで追いかける台帳',
    href: '/inquiry-board',
    status: 'ready',
    canUse: canUseInquiryBoard,
    deniedNote: `${INQUIRY_BOARD_DEPTS.join('、')}のみ利用できます`,
  },
  {
    id: 'monpai',
    name: '門配管理',
    desc: '門配の月間計画と実績報告',
    href: '/monpai',
    status: 'ready',
  },
  interviewApp('red'),
  interviewApp('chutobu'),
  {
    id: 'aptitude',
    name: '適性検査',
    desc: '採用選考の適性検査（受検URLの発行・結果の確認）',
    href: '/aptitude',
    status: 'ready',
    canUse: canUseAptitude,
    deniedNote: `${APTITUDE_DEPTS.join('、')}のみ利用できます`,
  },
  {
    id: 'helpdesk',
    name: 'ヘルプデスク',
    desc: '要項の確認、操作マニュアル、ご意見・不具合の報告',
    href: '/helpdesk',
    status: 'ready',
  },
  // 給与アプリ（Color HRM）へ、ログインしたまま移る（統合計画 第3段階）。
// 給与アプリを使う人（管理者と COLOR_APP_MEMBERS。lib/colorAccess.ts）にだけ出す。
  // /api/auth/to-color が一回限りのリンクを発行して移す。従来の入り方でログインした人は、ログインし直しになる。
  {
    id: 'color-pay',
    name: '給与・シフト',
    desc: 'シフトの提出・確認、勤怠、給与明細（給与アプリ）。ログインしたまま開きます',
    href: '/api/auth/to-color?next=pay',
    status: hubConfigured() ? 'ready' : 'soon',
    external: true,
    canUse: (_campus, name, role) => canUseColor(name, role),
    hideIfDenied: true,
  },
  {
    id: 'color-hrm',
    name: '講師育成（キャリアパス）',
    desc: '講師の研修・カラー・目標の管理（給与アプリの採用・育成）。ログインしたまま開きます',
    href: '/api/auth/to-color?next=hrm',
    status: hubConfigured() ? 'ready' : 'soon',
    external: true,
    canUse: (_campus, name, role) => canUseColor(name, role),
    hideIfDenied: true,
  },
];