// 総合画面（メニュー）に並べる智翔館アプリの一覧。
// ★アプリを増やすときはここに1件足すだけでメニューに出る。
//   status: 'ready'（使える）／'soon'（準備中：カードは出すが開けない）
//   canUse: 部門で使える人を絞るときに指定する（省略すると全員）。
//   external: 別の Web アプリ（別ドメイン）へのリンク。新しいタブで開く。

import { canUseInquiryBoard, INQUIRY_BOARD_DEPTS } from './inquiryBoardAccess';
import { ADMIN_CAMPUS } from './core/staff';

// 面談管理は別アプリ（RED_Interview_reservation・面談予約システム）の管理画面。
// 部門ごとに URL が分かれている（RED部門は /red/admin、中等部は /chutobu/admin）。
// INTERVIEW_APP_URL にそのアプリの URL（例 https://xxxx.vercel.app）を入れる。未設定のあいだは「準備中」。
// ログインは面談予約システム側のもの（この智翔館アプリのログインとは別）。
const INTERVIEW_APP_URL = (process.env.INTERVIEW_APP_URL ?? '').trim().replace(/\/+$/, '');

function interviewApp(id: string, label: string, path: string, depts: string[]): PortalApp {
  return {
    id,
    name: `面談管理（${label}）`,
    desc: `${label}の面談予約の確認・面談枠の設定・面談記録の入力（面談予約システムの管理画面）`,
    href: INTERVIEW_APP_URL ? `${INTERVIEW_APP_URL}${path}` : '',
    status: INTERVIEW_APP_URL ? 'ready' : 'soon',
    external: true,
    canUse: (campus) => depts.includes(campus),
    deniedNote: `${depts.join('、')}のみ利用できます`,
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
  interviewApp('interview-red', 'RED部門', '/red/admin', ['RED個別', ADMIN_CAMPUS]),
  interviewApp('interview-chutobu', '中等部', '/chutobu/admin', ['小中等部', ADMIN_CAMPUS]),
];
