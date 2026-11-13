// 智翔館AI：Google ドキュメントの下書きを作る（Apps Script の createAiDoc_ を呼ぶ）。サーバ専用。
// 本文の ```図 の枠は、ここで PNG にして [図:n] の印に置きかえ、Apps Script がその位置に画像として入れる（figure.ts・figurePng.ts）。

import { checkDocInput } from './createDocTool';
import { callGas } from './gas';
import { extractFigures } from './figure';
import { renderFigurePng } from './figurePng';

/** 1つの文書に入れる図の数の上限（Apps Script に送る量を抑える）。 */
const MAX_FIGURES = 12;
/** ドキュメントの1cmあたりの大きさ（Apps Script の InlineImage は px で指定する。96dpi） */
const PX_PER_CM = 37.8;

const REASONS: Record<string, string> = {
  not_configured: '文書を作る設定がまだありません（システム担当に連絡してください）',
  folder_failed: '保存先のフォルダを開けませんでした',
  create_failed: 'ドキュメントを作れませんでした（Apps Script の権限を確認してください）',
  too_long: '本文が長すぎます',
  empty: '題名か本文がありません',
  timeout: 'Apps Script から時間内に返事がありませんでした。保存先のフォルダ（AI作成）にできているかもしれません',
  aborted: '途中で止めました',
};

export type CreatedDoc = { ok: boolean; title: string; url?: string; note: string };

/** ツールの入力から文書を作り、AIに返す文と、ログ用の結果を返す。 */
export async function runCreateDoc(input: Record<string, unknown>, who: { campus: string; user: string }, signal?: AbortSignal):
  Promise<{ toolResult: string; created: CreatedDoc }> {
  const c = checkDocInput(input);
  if (!c.ok) return { toolResult: c.message, created: { ok: false, title: String(input?.title ?? ''), note: c.message } };
  // 図を画像にする（読めない図・描けない図は、その旨の行にして、AI に理由を返す）
  const fig = extractFigures(c.markdown);
  const notes = [...fig.errors];
  const images: { base64: string; width: number; height: number; caption: string }[] = [];
  for (let i = 0; i < fig.figures.length; i++) {
    if (i >= MAX_FIGURES) { notes.push(`図は1つの文書に${MAX_FIGURES}個まで（${i + 1}個目から入れていません）`); break; }
    try {
      const png = await renderFigurePng(fig.figures[i]);
      const w = Math.round(png.widthCm * PX_PER_CM);
      images.push({ base64: png.base64, width: w, height: Math.round((w * png.height) / png.width), caption: png.caption });
    } catch (e) {
      notes.push(`図${i + 1}を画像にできませんでした（${String((e as Error).message ?? e).slice(0, 80)}）`);
      images.push({ base64: '', width: 0, height: 0, caption: fig.figures[i].caption ?? '' });
    }
  }
  const j = await callGas({ action: 'createAiDoc', title: c.title, markdown: fig.markdown, images, campus: who.campus, user: who.user }, signal);
  // 再デプロイ前の Apps Script は未知の action に ok だけ返すので、saved の印が無ければ未対応とみなす。
  if (!j.ok || j.saved !== 'aiDoc' || typeof j.url !== 'string') {
    const why = j.ok ? 'Apps Script が古いままです（再デプロイが必要）' : REASONS[String(j.reason)] ?? '文書を作れませんでした';
    // 詳しい理由（Apps Script のエラー文）は会話ログにだけ残す。職員と AI には分かりやすい言葉だけを伝える。
    const detail = typeof j.detail === 'string' && j.detail ? `／詳細: ${j.detail}` : '';
    return { toolResult: `文書を作れませんでした（${why}）。職員にそのことを伝え、本文を回答に書いてコピーしてもらう。`, created: { ok: false, title: c.title, note: `${why}${detail}` } };
  }
  const figNote = images.length ? `（図${images.filter((x) => x.base64).length}個を画像で入れました）` : '';
  const warn = notes.length ? `\n図について気になった点（回答の「確認してほしいこと」に書く）：\n${notes.map((n) => `- ${n}`).join('\n')}` : '';
  return {
    toolResult: `文書を作りました${figNote}。題名：${j.name ?? c.title}／URL：${j.url}${warn}\n回答の最後に、このURLと「担当者が確認してから使う下書き」であることを書く。`,
    created: { ok: true, title: c.title, url: j.url, note: `作成${images.length ? `（図${images.length}）` : ''}` },
  };
}
