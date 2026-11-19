// 智翔館AI：職員に頼まれたときに、Google ドキュメントの下書きを作る道具（AIに渡すツール）。
// 中身は Apps Script（apps_script/Code.gs の createAiDoc_）が作り、00_進行中/AI作成 に置いてURLを返す。
// ここは他に依存しない部分（ツール定義・入力の確認）。呼び出しは createDoc.ts。

export const CREATE_DOC_TOOL = {
  name: 'create_google_doc',
  description:
    '職員がはっきり「文書を作って」「ドキュメントにして」と頼んだときだけ使う。計画書・報告書・案内文・まとめなどの下書きを Google ドキュメントで作り、URLを返す。' +
    '本文は Markdown（# 見出し、- 箇条書き、1. 番号、| 表 |、段落）で書く。[改ページ] だけの行で次のページに送る（問題と解答を分けるときなど）。数学の図は ```図 の枠（JSON）で書けば画像になって入る。1回の回答で1つまで。' +
    '作る前に、方針に沿っているか（10_理念・方針/方針チェック観点_2026.md）を確かめ、数字・日付は資料にあるものだけを使う。' +
    '本文には文書の中身だけを書く（この文書のURLの行や「道具の実行結果をご確認ください」のような、回答あての言葉は書かない。URLは回答に書く）。',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: '文書の題名（80文字まで。例：冬期講習 外部生募集計画（駅前校））' },
      markdown: { type: 'string', description: '本文（Markdown。30,000文字まで）' },
    },
    required: ['title', 'markdown'],
  },
};

export const MAX_TITLE = 80;
export const MAX_BODY = 30_000;

/**
 * 本文から、回答あての行を外す。
 * 2026-11-17 の台本（Google ドキュメント）の末尾に、回答の書式の「URL: ※道具の実行結果をご確認ください」が本文として入っていた。
 * 実際のURL（http…）が書かれていない「URL：」「リンク：」の行と、「道具の実行結果」を指す行を外す。
 */
export function stripReplyLines(markdown: string): string {
  const lines = markdown.split('\n');
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (/道具の(実行)?結果/.test(t)) return false;
    const m = /^(?:[-*・]\s*)?(?:\*\*)?(?:URL|ＵＲＬ|リンク|文書のURL|この文書のURL)(?:\*\*)?\s*[:：]\s*(.*)$/i.exec(t);
    if (m && !/https?:\/\//.test(m[1])) return false;
    return true;
  });
  return kept.join('\n').replace(/\n{3,}$/, '\n\n').trimEnd();
}

/** AIが渡した入力を確かめる。問題があれば、AIに返す理由の文を返す。 */
export function checkDocInput(input: Record<string, unknown>): { ok: true; title: string; markdown: string } | { ok: false; message: string } {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const markdown = typeof input?.markdown === 'string' ? stripReplyLines(input.markdown) : '';
  if (!title) return { ok: false, message: '題名がありません。' };
  if (!markdown.trim()) return { ok: false, message: '本文がありません。' };
  if (markdown.length > MAX_BODY) return { ok: false, message: `本文が長すぎます（${MAX_BODY}文字まで）。要点を絞ってください。` };
  return { ok: true, title: title.slice(0, MAX_TITLE), markdown };
}
