// 智翔館AI：Google ドライブの資料を AI が自分で読むための道具（ツール定義だけ。ほかに依存しない）。
// 実行は driveFiles.ts の runDriveTool。読めるのは Apps Script の AI_READ_FOLDER_IDS の下だけ。

export const DRIVE_TOOLS = [
  {
    name: 'list_drive_folder',
    description:
      'Google ドライブのフォルダの中身（ファイル名・種類・更新日・ID）を一覧する。職員がフォルダのリンクを貼ったときや、一覧から資料を探すときに使う。' +
      '読めるのは決められたフォルダ（05_広告制作・10_研修会議・04_講習）の中だけ。',
    input_schema: {
      type: 'object' as const,
      properties: { folder: { type: 'string', description: 'フォルダのURLかID' } },
      required: ['folder'],
    },
  },
  {
    name: 'read_drive_file',
    description:
      'Google ドライブのファイル（Googleドキュメント・スプレッドシート・スライド、Word・Excel・PowerPoint）の中身を読む。list_drive_folder の一覧のIDか、ファイルのURLを渡す。' +
      '読めるのは決められたフォルダの中だけ。1回の回答で読むのは3件まで。',
    input_schema: {
      type: 'object' as const,
      properties: { file: { type: 'string', description: 'ファイルのURLかID' } },
      required: ['file'],
    },
  },
];
