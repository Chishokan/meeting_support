// ヘルプデスクの「マニュアル」タブに並べる資料。
// ファイルは public/manual/ に置く（アプリと一緒に本番へ出るので、版がずれない）。
// 開けるのはログインしている人だけ（middleware.ts が /manual/ を見張る）。
// ★マニュアルを作り直したら、ファイルを public/manual/ に置き換えて、ここの版・日付・大きさを直す。
//   PDF・動画の作り方は docs/manual/README.md

export type ManualDoc = {
  id: string;
  title: string;
  desc: string;
  kind: 'pdf' | 'video';
  href: string; // public/ からのパス
  downloadName: string; // 保存したときのファイル名
  meta: string; // 版・形式・大きさなど（一覧に小さく出す）
  poster?: string; // 動画の表紙
};

export const MANUALS: ManualDoc[] = [
  {
    id: 'login-basic',
    title: 'ログイン 利用マニュアル',
    desc: 'メールアドレスとパスワードでのログインと、はじめにパスワードを決める手順、困ったときの対処（社員全員向け）',
    kind: 'pdf',
    href: '/manual/login-basic-manual-v1.0.0.pdf',
    downloadName: 'ログイン利用マニュアル_v1.0.0.pdf',
    meta: 'v1.0.0｜PDF・A4・9ページ｜約1.1MB',
  },
  {
    id: 'login-basic-video',
    title: '動画：ログインの使い方',
    desc: 'パスワードの決め方と、メールアドレスでのログインを、画面と音声で説明します（社員全員向け）',
    kind: 'video',
    href: '/manual/login-basic.mp4',
    downloadName: 'ログインの使い方_動画マニュアル.mp4',
    meta: '約3分｜MP4｜約5MB',
    poster: '/manual/login-basic-poster.jpg',
  },
  {
    id: 'login',
    title: '共通ログイン 利用マニュアル（給与アプリを使う方）',
    desc: '上の内容に加えて、給与アプリ（給与・シフト、講師育成）との行き来。給与アプリも使う管理者などの方向け',
    kind: 'pdf',
    href: '/manual/login-manual-v1.0.0.pdf',
    downloadName: '共通ログイン利用マニュアル_v1.0.0.pdf',
    meta: 'v1.0.0｜PDF・A4・11ページ｜約1.2MB',
  },
  {
    id: 'login-video',
    title: '動画：共通ログインの使い方（給与アプリを使う方）',
    desc: 'パスワードの決め方、メールアドレスでのログイン、給与アプリとの行き来（給与アプリを使う方）、困ったときを、画面と音声で説明します',
    kind: 'video',
    href: '/manual/login.mp4',
    downloadName: '共通ログインの使い方_動画マニュアル.mp4',
    meta: '約3分｜MP4｜約7MB',
    poster: '/manual/login-poster.jpg',
  },
  {
    id: 'chishokan-ai',
    title: '智翔館AI（試用版）利用マニュアル',
    desc: '智翔館AIの開き方・画面の見方、質問のしかたと回答の見方、資料の渡し方、よく使う作業（チラシ・スライド・計画書・数学の教材と小テスト）、不具合の報告と要望の送り方。画面の写真つき',
    kind: 'pdf',
    href: '/manual/chishokan-ai-manual-v0.25.2.pdf',
    downloadName: '智翔館AI利用マニュアル_v0.25.2.pdf',
    meta: 'v0.25.2｜PDF・A4・18ページ｜約3MB',
  },
  {
    id: 'chishokan-ai-video',
    title: '動画：智翔館AIの使い方',
    desc: '開き方・画面の見方、質問のしかたと回答の見方、資料の渡し方、よく使う作業、不具合の報告と要望の送り方を、画面と音声で説明します',
    kind: 'video',
    href: '/manual/chishokan-ai.mp4',
    downloadName: '智翔館AIの使い方_動画マニュアル.mp4',
    meta: '約5分半｜MP4｜約15MB',
    poster: '/manual/chishokan-ai-poster.jpg',
  },
  {
    id: 'meeting-dx',
    title: '会議DX 操作マニュアル',
    desc: '会議DXのメニュー画面・部門会議と、ヘルプデスク（要項QA・ご意見・不具合の報告・マニュアル）の使い方。画面の写真つき',
    kind: 'pdf',
    href: '/manual/meeting-dx-manual-v0.18.0.pdf',
    downloadName: '会議DX操作マニュアル_v0.18.0.pdf',
    meta: 'v0.18.0｜PDF・A4｜約5MB',
  },
  {
    id: 'dept-meeting-video',
    title: '動画：部門会議の進め方',
    desc: '事前共有 → 録音 → 議事録 → 次回の事前共有の流れを、画面と音声で説明します',
    kind: 'video',
    href: '/manual/dept-meeting.mp4',
    downloadName: '部門会議の進め方_動画マニュアル.mp4',
    meta: '約5分｜MP4｜約14MB',
    poster: '/manual/dept-meeting-poster.jpg',
  },
];
