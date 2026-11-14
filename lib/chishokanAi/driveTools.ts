// 智翔館AI：Google ドライブの資料を AI が自分で読むための道具（ツール定義だけ。ほかに依存しない）。
// 実行は driveFiles.ts の runDriveTool。読めるのは Apps Script の AI_READ_FOLDER_IDS の下だけ。

export const DRIVE_TOOLS = [
  {
    name: 'list_drive_folder',
    description:
      'Google ドライブのフォルダの中身（ファイル名・種類・更新日・ID）を一覧する。職員がフォルダのリンクを貼ったときや、資料を探すときに使う。' +
      'リンクが無くても、05_広告制作・10_研修会議・04_講習・15_AI利用データ は名前を渡せば開ける。そこから中のフォルダの id をたどる。' +
      '読めるのは決められたフォルダ（05_広告制作・10_研修会議・04_講習・15_AI利用データ）の中だけ。',
    input_schema: {
      type: 'object' as const,
      properties: { folder: { type: 'string', description: 'フォルダのURLかID。読めるフォルダの一番上は名前でもよい（05_広告制作／10_研修会議／04_講習／15_AI利用データ）' } },
      required: ['folder'],
    },
  },
  {
    name: 'read_drive_file',
    description:
      'Google ドライブのファイル（Googleドキュメント・スプレッドシート・スライド、Word・Excel・PowerPoint）の中身を読む。list_drive_folder の一覧のIDか、ファイルのURLを渡す。' +
      '読めるのは決められたフォルダの中だけ。',
    input_schema: {
      type: 'object' as const,
      properties: { file: { type: 'string', description: 'ファイルのURLかID' } },
      required: ['file'],
    },
  },
];
