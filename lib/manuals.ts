// ヘルプデスクの「マニュアル」タブに並べる資料。
// ファイルは public/manual/ に置く（アプリと一緒に本番へ出るので、版がずれない）。
// 開けるのはログインしている人だけ（middleware.ts が /manual/ を見張る）。
// ★マニュアルを作り直したら、ファイルを public/manual/ に置き換えて、ここの版・日付・大きさを直す。
//   PDF・動画の作り方は docs/manual/README.md
// ★マニュアルを足すときは、category（下の MANUAL_CATEGORIES のどれか）を必ず付ける。
//   画面では分類ごとにまとめて、目次と検索で探せるようにしている。合う分類が無ければ MANUAL_CATEGORIES に足す。

// 分類。この並びで画面に出す。
export const MANUAL_CATEGORIES = [
  { id: 'login', label: 'ログイン', desc: 'はじめに。パスワードの決め方とログインのしかた' },
  { id: 'chishokan-ai', label: '智翔館AI', desc: '質問のしかた、資料の渡し方、よく使う作業' },
  { id: 'meeting', label: '会議DX・部門会議', desc: '会議DXの画面、部門会議（事前共有・議事録）、ヘルプデスク' },
  { id: 'seiseki', label: '成績管理', desc: '本番レベル模試の名簿・受験票と成績入力' },
  { id: 'event', label: 'イベント申込管理', desc: '声掛け名簿と申込の状況（教室担当者向け）' },
] as const;

export type ManualCategoryId = (typeof MANUAL_CATEGORIES)[number]['id'];

export type ManualDoc = {
  id: string;
  category: ManualCategoryId;
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
    category: 'login',
    title: 'ログイン 利用マニュアル',
    desc: 'メールアドレスとパスワードでのログインと、はじめにパスワードを決める手順、困ったときの対処（社員全員向け）',
    kind: 'pdf',
    href: '/manual/login-basic-manual-v1.0.0.pdf',
    downloadName: 'ログイン利用マニュアル_v1.0.0.pdf',
    meta: 'v1.0.0｜PDF・A4・9ページ｜約1.1MB',
  },
  {
    id: 'login-basic-video',
    category: 'login',
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
    category: 'login',
    title: '共通ログイン 利用マニュアル（給与アプリを使う方）',
    desc: '上の内容に加えて、給与アプリ（給与・シフト、講師育成）との行き来。給与アプリも使う管理者などの方向け',
    kind: 'pdf',
    href: '/manual/login-manual-v1.0.0.pdf',
    downloadName: '共通ログイン利用マニュアル_v1.0.0.pdf',
    meta: 'v1.0.0｜PDF・A4・11ページ｜約1.2MB',
  },
  {
    id: 'login-video',
    category: 'login',
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
    category: 'chishokan-ai',
    title: '智翔館AI（試用版）利用マニュアル',
    desc: '智翔館AIの開き方・画面の見方、質問のしかたと回答の見方、資料の渡し方、コンテキスト（会話の前提）と会話の履歴・保存・書き出し、よく使う作業（チラシ・スライド・計画書・数学の教材と小テスト）、会議の記録、テスト問題の保存と検索、不具合の報告と要望の送り方。画面の写真つき',
    kind: 'pdf',
    href: '/manual/chishokan-ai-manual-v1.26.0.pdf',
    downloadName: '智翔館AI利用マニュアル_v1.26.0.pdf',
    meta: 'v1.26.0｜PDF・A4・24ページ｜約4MB',
  },
  {
    id: 'chishokan-ai-video',
    category: 'chishokan-ai',
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
    category: 'meeting',
    title: '会議DX 操作マニュアル',
    desc: '会議DXのメニュー画面・部門会議と、ヘルプデスク（要項QA・ご意見・不具合の報告・マニュアル）の使い方。画面の写真つき',
    kind: 'pdf',
    href: '/manual/meeting-dx-manual-v0.18.0.pdf',
    downloadName: '会議DX操作マニュアル_v0.18.0.pdf',
    meta: 'v0.18.0｜PDF・A4｜約5MB',
  },
  {
    id: 'meeting-flow',
    category: 'meeting',
    title: '部門会議 事前共有の確認・議題の追加・Zoom参加 マニュアル',
    desc: '部門会議の新しい流れ（事前共有 → 確認・議題の追加 → Zoom で会議・録画 → 翌朝に議事録を自動作成）のうち、会議に出る方がすること。ダッシュボードでの「議題を確認しました」、［議題の修正］と智翔館AI からの議題の追加・意見、Zoom への参加とホスト担当の［ホストとして開始］、困ったとき。画面の写真つき',
    kind: 'pdf',
    href: '/manual/meeting-flow-manual-v1.2.0.pdf',
    downloadName: '部門会議_事前共有の確認・議題の追加・Zoom参加マニュアル_v1.2.0.pdf',
    meta: 'v1.2.0｜PDF・A4・18ページ｜約2.7MB',
  },
  {
    id: 'meeting-flow-video',
    category: 'meeting',
    title: '動画：部門会議の新しい流れ',
    desc: '事前共有の確認、議題の追加（ダッシュボード・智翔館AI）、Zoom での参加と、録画から翌朝に議事録ができるまでを、画面と音声で説明します',
    kind: 'video',
    href: '/manual/meeting-flow.mp4',
    downloadName: '部門会議の新しい流れ_動画マニュアル.mp4',
    meta: '約6分｜MP4｜約12MB',
    poster: '/manual/meeting-flow-poster.jpg',
  },
  {
    id: 'seiseki-student',
    category: 'seiseki',
    title: '成績管理 生徒の追加 マニュアル',
    desc: '受験票を作るために、成績管理（本番レベル模試）の名簿に生徒を足す方法。受験番号のきまり、［＋ 生徒を追加］での1人ずつの追加（受験番号は 0301 から自動）、受験票の印刷、困ったとき。成績管理を使う職員（小中等部、総務・人事・支援・管理の職員）向け。画面の写真つき',
    kind: 'pdf',
    href: '/manual/seiseki-student-manual-v1.1.0.pdf',
    downloadName: '成績管理_生徒の追加マニュアル_v1.1.0.pdf',
    meta: 'v1.1.0｜PDF・A4・7ページ｜約1.7MB',
  },
  {
    id: 'seiseki-student-video',
    category: 'seiseki',
    title: '動画：成績管理 生徒の追加',
    desc: '受験票を作るために、成績入力の［＋ 生徒を追加］で生徒を足し、受験票を印刷するまでを、画面と音声で説明します（成績管理を使う職員向け）',
    kind: 'video',
    href: '/manual/seiseki-student.mp4',
    downloadName: '成績管理_生徒の追加_動画マニュアル.mp4',
    meta: '約2分半｜MP4｜約7.6MB',
    poster: '/manual/seiseki-student-poster.jpg',
  },
  {
    id: 'seiseki-entry',
    category: 'seiseki',
    title: '成績管理 成績入力 マニュアル',
    desc: '本番レベル模試の得点の入れ方。画面で大問ごとに入れる（Enter・Tab、教科を絞る、途中・赤いセル、Excel からの貼り付け、自動保存）、入力シート（CSV）を書き出して Excel で入れて取り込む、受験しない生徒の設定、困ったとき。得点を入れる職員向け。画面の写真つき',
    kind: 'pdf',
    href: '/manual/seiseki-entry-manual-v1.1.0.pdf',
    downloadName: '成績管理_成績入力マニュアル_v1.1.0.pdf',
    meta: 'v1.1.0｜PDF・A4・13ページ｜約1.8MB',
  },
  {
    id: 'seiseki-entry-video',
    category: 'seiseki',
    title: '動画：成績管理 成績入力',
    desc: '本番レベル模試の得点の入れ方（画面で大問ごとに入れる・教科を絞る・黄色と赤のセル、入力シート（CSV）の書き出しと取り込み、受験しない生徒）を、画面と音声で説明します（得点を入れる職員向け）',
    kind: 'video',
    href: '/manual/seiseki-entry.mp4',
    downloadName: '成績管理_成績入力_動画マニュアル.mp4',
    meta: '約3分半｜MP4｜約8.1MB',
    poster: '/manual/seiseki-entry-poster.jpg',
  },
  {
    id: 'event-list',
    category: 'event',
    title: 'イベント申込管理 教室担当者マニュアル',
    desc: 'イベントの声掛け名簿の使い方。名簿の見方と「次にすること」、スイッチでの記録（チラシ・声掛け・保護者へ案内）と保存の見方、一括で記録、絞り込みと並び順、申込の状況（申込済・名簿外の申込）、申込のキャンセル、名簿にいない生徒の追加、困ったとき。教室担当の職員（小中等部・RED個別・高等部）向け。画面の写真つき',
    kind: 'pdf',
    href: '/manual/event-list-manual-v1.1.0.pdf',
    downloadName: 'イベント申込管理_教室担当者マニュアル_v1.1.0.pdf',
    meta: 'v1.1.0｜PDF・A4・16ページ｜約3.4MB',
  },
  {
    id: 'event-list-video',
    category: 'event',
    title: '動画：イベント申込管理 声掛け名簿の使い方',
    desc: '名簿の開き方、「次にすること」と ★、スイッチでの記録と保存の見方、一括で記録、申込の状況と名簿外の申込を、画面とナレーションで説明します（教室担当者向け）',
    kind: 'video',
    href: '/manual/event-list.mp4',
    downloadName: 'イベント申込管理_声掛け名簿の使い方_動画マニュアル.mp4',
    meta: '約4分｜MP4｜約9.1MB',
    poster: '/manual/event-list-poster.jpg',
  },
];
