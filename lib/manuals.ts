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
    desc: '智翔館AIの開き方・画面の見方、質問のしかたと回答の見方、資料の渡し方、コンテキスト（会話の前提）と会話の履歴・保存・書き出し、よく使う作業（チラシ・スライド・計画書・数学の教材と小テスト）、不具合の報告と要望の送り方。画面の写真つき',
    kind: 'pdf',
    href: '/manual/chishokan-ai-manual-v1.6.0.pdf',
    downloadName: '智翔館AI利用マニュアル_v1.6.0.pdf',
    meta: 'v1.6.0｜PDF・A4・21ページ｜約4MB',
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
  {
    id: 'seiseki-student',
    title: '成績管理 生徒の追加 マニュアル',
    desc: '受験票を作るために、成績管理（本番レベル模試）の名簿に生徒を足す方法。受験番号のきまり、［＋ 生徒を追加］での1人ずつの追加（受験番号は 0301 から自動）、受験票の印刷、困ったとき。成績管理を使う職員（小中等部、総務・人事・支援・管理の職員）向け。画面の写真つき',
    kind: 'pdf',
    href: '/manual/seiseki-student-manual-v1.1.0.pdf',
    downloadName: '成績管理_生徒の追加マニュアル_v1.1.0.pdf',
    meta: 'v1.1.0｜PDF・A4・7ページ｜約1.7MB',
  },
  {
    id: 'seiseki-student-video',
    title: '動画：成績管理 生徒の追加',
    desc: '受験票を作るために、成績入力の［＋ 生徒を追加］で生徒を足し、受験票を印刷するまでを、画面と音声で説明します（成績管理を使う職員向け）',
    kind: 'video',
    href: '/manual/seiseki-student.mp4',
    downloadName: '成績管理_生徒の追加_動画マニュアル.mp4',
    meta: '約2分半｜MP4｜約7.6MB',
    poster: '/manual/seiseki-student-poster.jpg',
  },
  {
    id: 'event-list',
    title: 'イベント申込管理 教室担当者マニュアル',
    desc: 'イベントの声掛け名簿の使い方。名簿の見方と「次にすること」、スイッチでの記録（チラシ・声掛け・保護者へ案内）と保存の見方、一括で記録、絞り込みと並び順、申込の状況（申込済・名簿外の申込）、名簿にいない生徒の追加、困ったとき。教室担当の職員（小中等部・RED個別・高等部）向け。画面の写真つき',
    kind: 'pdf',
    href: '/manual/event-list-manual-v1.0.0.pdf',
    downloadName: 'イベント申込管理_教室担当者マニュアル_v1.0.0.pdf',
    meta: 'v1.0.0｜PDF・A4・15ページ｜約3.1MB',
  },
  // ナレーションの mp3 がまだ無いので、字幕だけの版を置いている。音声を入れたら meta と desc を直す（docs/manual/video/event-list/README.md）
  {
    id: 'event-list-video',
    title: '動画：イベント申込管理 声掛け名簿の使い方',
    desc: '名簿の開き方、「次にすること」と ★、スイッチでの記録と保存の見方、一括で記録、申込の状況と名簿外の申込を、画面と字幕で説明します（教室担当者向け。音声はありません）',
    kind: 'video',
    href: '/manual/event-list.mp4',
    downloadName: 'イベント申込管理_声掛け名簿の使い方_動画マニュアル.mp4',
    meta: '約2分20秒｜MP4｜約5.3MB｜字幕のみ（音声なし）',
    poster: '/manual/event-list-poster.jpg',
  },
];
