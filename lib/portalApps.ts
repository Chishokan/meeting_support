// 総合画面（メニュー）に並べる智翔館アプリの一覧。
// ★アプリを増やすときはここに1件足すだけでメニューに出る。
//   status: 'ready'（使える）／'soon'（準備中：カードは出すが開けない）
//   canUse: 部門で使える人を絞るときに指定する（省略すると全員）。
//   external: 別の Web アプリ（別ドメイン）を開くカード。新しいタブで開く。

import { canUseInquiryBoard, INQUIRY_BOARD_DEPTS } from './inquiryBoardAccess';
import { canUseInterview, interviewAppUrl, INTERVIEW_DEPTS, type InterviewDept } from './interviewApp';
import { APTITUDE_DEPTS, canUseAptitude } from './aptitude/access';

// 面談管理は別アプリ（面談予約システム）の管理画面。部門ごとに URL が分かれている。
// 管理画面にはログインの仕組みが無く、カードは管理画面の URL をそのまま開く。
// 開ける部門・開く先は lib/interviewApp.ts。
function interviewApp(dept: InterviewDept): PortalApp {
  const { label, campuses } = INTERVIEW_DEPTS[dept];
  return {
    id: `interview-${dept}`,
    name: `面談管理（${label}）`,
    desc: `${label}の面談予約の確認・面談枠の設定・面談記録の入力（面談予約システムの管理画面）`,
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
  canUse?: (campus: string) => boolean;
  deniedNote?: string; // canUse で弾かれた人に出す一言
  external?: boolean;
};

export const PORTAL_APPS: PortalApp[] = [
  {
    id: 'meeting',
    name: '会議DX',
    desc: '部門会議（事前共有 → 録音 → 議事録 → 次回の事前共有）と、全体会議の数値報告・事前報告・振り返り',
    href: '/dashboard',
    status: 'ready',
  },
  {
    id: 'kenshu',
    name: '全体研修会アンケート',
    desc: '10/31（土）全体研修会の事前アンケート。この1年で、仕事と人生・プライベートで達成したいこと・やってみたいことを書き出す',
    href: '/kenshu',
    status: 'ready',
  },
  {
    id: 'inquiry-board',
    name: '問合せ管理',
    desc: '問い合わせを校舎ごとに登録し、体験・面談・入塾まで追いかける台帳。台帳の内容をAIに聞くこともできる',
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
  {
    id: 'aptitude',
    name: '適性検査',
    desc: '講師（学生パート）・事務スタッフ・社員の採用選考の適性検査。受検URLの発行・紙回答の入力・結果の確認',
    href: '/aptitude',
    status: 'ready',
    canUse: canUseAptitude,
    deniedNote: `${APTITUDE_DEPTS.join('、')}のみ利用できます`,
  },
  {
    id: 'helpdesk',
    name: 'ヘルプデスク',
    desc: '要項QA（申込方法・支払い・日程を要項から確認）、操作マニュアルのダウンロード、アプリへのご意見・不具合の報告',
    href: '/helpdesk',
    status: 'ready',
  },
];
