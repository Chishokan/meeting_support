// 総合画面（メニュー）に並べる智翔館アプリの一覧。
// ★アプリを増やすときはここに1件足すだけでメニューに出る。
//   status: 'ready'（使える）／'soon'（準備中：カードは出すが開けない）
//   canUse: 部門で使える人を絞るときに指定する（省略すると全員）。

import { canUseInquiryBoard, INQUIRY_BOARD_DEPTS } from './inquiryBoardAccess';

export type PortalApp = {
  id: string;
  name: string;
  desc: string;
  href: string;
  status: 'ready' | 'soon';
  canUse?: (campus: string) => boolean;
  deniedNote?: string; // canUse で弾かれた人に出す一言
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
    desc: '校門前でのチラシ配布の予定と実績を管理',
    href: '/monpai',
    status: 'soon',
  },
];
