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
    id: 'meeting-dx',
    title: '会議DX 操作マニュアル',
    desc: '会議DXのメニュー画面・部門会議と、ヘルプデスク（要項QA・ご意見・不具合の報告・マニュアル）の使い方。画面の写真つき',
    kind: 'pdf',
    href: '/manual/meeting-dx-manual-v0.18.0.pdf',
    downloadName: '会議DX操作マニュアル_v0.18.0.pdf',
    meta: 'v0.18.0｜PDF・A4｜約5MB',
  },
  {
    id: 'monpai',
    title: '門配管理 操作マニュアル',
    desc: '門配の月間計画（AIの計画案を含む）・実績報告・集計と、配布物の在庫・学校マスタの使い方。画面の写真つき',
    kind: 'pdf',
    href: '/manual/monpai-manual-v0.18.0.pdf',
    downloadName: '門配管理操作マニュアル_v0.18.0.pdf',
    meta: 'v0.18.0｜PDF・A4｜約3MB',
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
