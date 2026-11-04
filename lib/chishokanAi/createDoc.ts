// 智翔館AI：Google ドキュメントの下書きを作る（Apps Script の createAiDoc_ を呼ぶ）。サーバ専用。

import { checkDocInput } from './createDocTool';
import { callGas } from './gas';

const REASONS: Record<string, string> = {
  not_configured: '文書を作る設定がまだありません（システム担当に連絡してください）',
  folder_failed: '保存先のフォルダを開けませんでした',
  too_long: '本文が長すぎます',
  empty: '題名か本文がありません',
};

export type CreatedDoc = { ok: boolean; title: string; url?: string; note: string };

/** ツールの入力から文書を作り、AIに返す文と、ログ用の結果を返す。 */
export async function runCreateDoc(input: Record<string, unknown>, who: { campus: string; user: string }):
  Promise<{ toolResult: string; created: CreatedDoc }> {
  const c = checkDocInput(input);
  if (!c.ok) return { toolResult: c.message, created: { ok: false, title: String(input?.title ?? ''), note: c.message } };
  const j = await callGas({ action: 'createAiDoc', title: c.title, markdown: c.markdown, campus: who.campus, user: who.user });
  // 再デプロイ前の Apps Script は未知の action に ok だけ返すので、saved の印が無ければ未対応とみなす。
  if (!j.ok || j.saved !== 'aiDoc' || typeof j.url !== 'string') {
    const why = j.ok ? 'Apps Script が古いままです（再デプロイが必要）' : REASONS[String(j.reason)] ?? '文書を作れませんでした';
    return { toolResult: `文書を作れませんでした（${why}）。職員にそのことを伝え、本文を回答に書いてコピーしてもらう。`, created: { ok: false, title: c.title, note: why } };
  }
  return {
    toolResult: `文書を作りました。題名：${j.name ?? c.title}／URL：${j.url}\n回答の最後に、このURLと「担当者が確認してから使う下書き」であることを書く。`,
    created: { ok: true, title: c.title, url: j.url, note: '作成' },
  };
}
