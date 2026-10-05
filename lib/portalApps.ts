// 総合画面（メニュー）に並べる智翔館アプリの一覧。
// ★アプリを増やすときはここに1件足すだけでメニューに出る。
//   status: 'ready'（使える）／'soon'（準備中：カードは出すが開けない）
//   canUse: 部門で使える人を絞るときに指定する（省略すると全員）。
//   external: 別の Web アプリ（別ドメイン）を開くカード。新しいタブで開く。

import { canUseInquiryBoard, INQUIRY_BOARD_DEPTS } from './inquiryBoardAccess';
import { canUseInterview, INTERVIEW_DEPTS, type InterviewDept } from './interviewSso';

// 面談管理は別アプリ（面談予約システム）の管理画面。部門ごとに URL が分かれている。
// カードは /api/interview-sso を開き、そこから（メニューのログインのまま）管理画面へ転送する。
// 開ける部門・開く先・自動ログインの仕組みは lib/interviewSso.ts。
function interviewApp(dept: InterviewDept): PortalApp {
  const { label, campuses } = INTERVIEW_DEPTS[dept];
  return {
    id: `interview-${dept}`,
    name: `面談管理（${label}）`,
    desc: `${label}の面談予約の確認・面談枠の設定・面談記録の入力（面談予約システムの管理画面）`,
    href: `/api/interview-sso?dept=${dept}`,
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
  canUse?: (campus: string) => boolean;
  deniedNote?: string; // canUse で弾かれた人に出す一言
  external?: boolean;
};

export const PORTAL_APPS: PortalApp[] = [
  {
    id: 'meeting',
    name: '会議DX',
    desc: '会議AI・事前報告・議事録・中間報告など、会議の準備と振り返り',
    href: '/dashboard',
    status: 'ready',
  },
  {
    id: 'inquiry-board',
    name: '問合せ管理',
    desc: '問い合わせを校舎ごとに登録し、体験・面談・入塾まで追いかける台帳',
    href: '/inquiry-board',
    status: 'ready',
    canUse: canUseInquiryBoard,
    deniedNote: `${INQUIRY_BOARD_DEPTS.join('、')}のみ利用できます`,
  },
  {
    id: 'monpai',
    name: '門配管理',
    desc: '地区ごとの門配（校門前でのチラシ配布）の月間計画と実績報告',
    href: '/monpai',
    status: 'ready',
  },
  interviewApp('red'),
  interviewApp('chutobu'),
];
