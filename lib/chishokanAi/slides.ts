// 智翔館AI：Google スライドを作る（Apps Script の listSlideTemplates_ / describeSlideTemplate_ / createAiSlides_ を呼ぶ）。サーバ専用。
// ツール定義と入力の確認は slidesTool.ts。

import { callGas } from './gas';
import { checkSlidesInput, formatTemplateDetail, formatTemplateList, type TemplateDetail, type TemplateSummary } from './slidesTool';
import type { CreatedDoc } from './createDoc';

const REASONS: Record<string, string> = {
  not_configured: 'スライドのひな形のフォルダがまだ設定されていません（システム担当に連絡してください）',
  template_folder_failed: 'ひな形のフォルダを開けませんでした（Apps Script のアカウントに共有されているか確認してください）',
  template_not_found: 'そのひな形が見つかりません',
  folder_failed: '保存先のフォルダを開けませんでした',
  create_failed: 'スライドを作れませんでした（Apps Script の権限を確認してください）',
  empty: '題名かスライドがありません',
  timeout: 'Apps Script から時間内に返事がありませんでした。保存先のフォルダ（AI作成）にできているかもしれません',
  aborted: '途中で止めました',
};
const NOT_DEPLOYED = 'Apps Script が古いままです（再デプロイが必要）';

/** get_slide_templates：ひな形の一覧、または1つのひな形の枠の一覧を、AI に渡す文にする。 */
export async function runSlideTemplates(input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const name = typeof input?.template === 'string' ? input.template.trim() : '';
  if (!name) {
    const j = await callGas({ action: 'listSlideTemplates' }, signal);
    if (j.ok && !Array.isArray(j.templates)) return `ひな形を読めませんでした（${NOT_DEPLOYED}）。職員にそのことを伝える。`;
    if (!j.ok) return `ひな形を読めませんでした（${REASONS[String(j.reason)] ?? '読み取りに失敗しました'}）。職員にそのことを伝える。`;
    return formatTemplateList(j.templates as TemplateSummary[]);
  }
  const j = await callGas({ action: 'describeSlideTemplate', name }, signal);
  if (j.ok && !Array.isArray(j.slides)) return `ひな形を読めませんでした（${NOT_DEPLOYED}）。職員にそのことを伝える。`;
  if (!j.ok) {
    const why = REASONS[String(j.reason)] ?? '読み取りに失敗しました';
    return `ひな形「${name}」を読めませんでした（${why}）。template を省いて一覧を見直す。`;
  }
  return formatTemplateDetail(j as unknown as TemplateDetail);
}

/** create_google_slides：スライドを作り、AI に返す文と、ログ用の結果を返す。 */
export async function runCreateSlides(
  input: Record<string, unknown>,
  who: { campus: string; user: string },
  signal?: AbortSignal,
): Promise<{ toolResult: string; created: CreatedDoc }> {
  const c = checkSlidesInput(input);
  if (!c.ok) return { toolResult: c.message, created: { ok: false, title: String(input?.title ?? ''), note: c.message } };
  const v = c.value;
  const j = await callGas({ action: 'createAiSlides', template: v.template, title: v.title, slides: v.slides, campus: who.campus, user: who.user }, signal);
  // 再デプロイ前の Apps Script は未知の action に ok だけ返すので、saved の印が無ければ未対応とみなす。
  if (!j.ok || j.saved !== 'aiSlides' || typeof j.url !== 'string') {
    const why = j.ok ? NOT_DEPLOYED : REASONS[String(j.reason)] ?? 'スライドを作れませんでした';
    const detail = typeof j.detail === 'string' && j.detail ? `／詳細: ${j.detail}` : '';
    return {
      toolResult: `スライドを作れませんでした（${why}）。職員にそのことを伝え、スライドの本文とノートを回答に書く。`,
      created: { ok: false, title: `スライド：${v.title}`, note: `${why}${detail}` },
    };
  }
  const warnings = Array.isArray(j.warnings) ? (j.warnings as unknown[]).filter((w): w is string => typeof w === 'string') : [];
  const warn = warnings.length
    ? `\n作るときに気になった点（回答の「確認してほしいこと」に書く）：\n${warnings.map((w) => `- ${w}`).join('\n')}`
    : '';
  return {
    toolResult:
      `スライドを作りました（${v.slides.length}枚）。題名：${j.name ?? v.title}／URL：${j.url}${warn}\n` +
      '回答には、このURLと、担当者が確認してから使う下書きであること、文字が枠からはみ出していないか見てほしいことを書く。',
    created: { ok: true, title: `スライド：${v.title}`, url: j.url, note: `作成（${v.slides.length}枚${warnings.length ? `・注意${warnings.length}件` : ''}）` },
  };
}
