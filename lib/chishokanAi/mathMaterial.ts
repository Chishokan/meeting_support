// 智翔館AI：数学の教材を、仕上がりの書式の Word（問題・解答と解説の2つ）にして、ドライブに保存する。サーバ専用。
// 道具の定義と入力の確かめは mathMaterialTool.ts、Word を組むのは mathDoc.ts、保存は Apps Script の saveAiFiles_。

import { callGas } from './gas';
import type { CreatedDoc } from './createDoc';
import { parseFigure, textsWithoutGlyph } from './figure';
import { renderFigurePng } from './figurePng';
import { buildAnswerDocx, buildProblemDocx, type FigureRenderer } from './mathDoc';
import { checkMathMaterialInput } from './mathMaterialTool';
import { buildQuizDocx } from './mathQuizDoc';
import { checkMathQuizInput } from './mathQuizTool';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const NOT_DEPLOYED = 'Apps Script が古いままです（再デプロイが必要）';
const REASONS: Record<string, string> = {
  not_configured: 'ファイルを保存する設定がまだありません（システム担当に連絡してください）',
  folder_failed: '保存先のフォルダを開けませんでした',
  create_failed: 'ファイルを保存できませんでした（Apps Script の権限を確認してください）',
  too_large: 'ファイルが大きすぎます（図を減らしてください）',
  empty: 'ファイルがありません',
  timeout: 'Apps Script から時間内に返事がありませんでした。保存先のフォルダ（AI作成）にできているかもしれません',
  aborted: '途中で止めました',
};

/** 図の記述を PNG にする（文書の画像に出ない日本語の文字があれば notes に書く）。 */
function figureRenderer(notes: string[]): FigureRenderer {
  return async (fig) => {
    const p = parseFigure(fig as Record<string, unknown>);
    if (!p.ok) throw new Error(p.error);
    const noGlyph = textsWithoutGlyph(p.spec);
    if (noGlyph.length) notes.push(`図の「${noGlyph.slice(0, 3).join('」「')}」は、画像では文字が出ません（図の中は半角の文字・記号にする）`);
    const png = await renderFigurePng(p.spec);
    return { data: Buffer.from(png.base64, 'base64'), width: png.width, height: png.height, widthCm: png.widthCm };
  };
}

/** create_math_quiz：小テストの Word（小テスト・答え入り）を作って保存し、AI に返す文と、ログ用の結果を返す。 */
export async function runCreateMathQuiz(
  input: Record<string, unknown>,
  who: { campus: string; user: string },
  signal?: AbortSignal,
): Promise<{ toolResult: string; created: CreatedDoc[] }> {
  const c = checkMathQuizInput(input);
  if (!c.ok) return { toolResult: c.message, created: [{ ok: false, title: `小テスト：${String(input?.title ?? '')}`, note: c.message }] };
  const q = c.value;
  const notes: string[] = [];
  const render = figureRenderer(notes);
  let quiz: Buffer;
  let answers: Buffer;
  try {
    const a = await buildQuizDocx(q, render);
    const b = await buildQuizDocx(q, render, { withAnswers: true });
    quiz = a.buffer;
    answers = b.buffer;
    notes.push(...a.notes);
  } catch (e) {
    const why = `Word を組み立てられませんでした（${String((e as Error)?.message ?? e).slice(0, 120)}）`;
    return { toolResult: `${why}。職員にそのことを伝え、問題と答えを回答に書く。`, created: [{ ok: false, title: `小テスト：${q.title}`, note: why }] };
  }
  const j = await callGas(
    {
      action: 'saveAiFiles',
      campus: who.campus,
      user: who.user,
      files: [
        { name: `${q.title}.docx`, mime: DOCX_MIME, base64: quiz.toString('base64') },
        { name: `${q.title}_答え入り.docx`, mime: DOCX_MIME, base64: answers.toString('base64') },
      ],
    },
    signal,
  );
  const files = Array.isArray(j.files) ? (j.files as { name?: unknown; url?: unknown }[]) : [];
  if (!j.ok || j.saved !== 'aiFiles' || files.length < 2 || files.some((f) => typeof f.url !== 'string')) {
    const why = j.ok ? NOT_DEPLOYED : REASONS[String(j.reason)] ?? 'ファイルを保存できませんでした';
    const detail = typeof j.detail === 'string' && j.detail ? `／詳細: ${j.detail}` : '';
    return {
      toolResult: `Word のファイルを保存できませんでした（${why}）。職員にそのことを伝え、問題と答えを回答に書く。`,
      created: [{ ok: false, title: `小テスト：${q.title}`, note: `${why}${detail}` }],
    };
  }
  const [qf, af] = files as { name: string; url: string }[];
  const count = q.sheets.reduce((n, s) => n + s.sections.reduce((k, x) => k + x.items.length, 0), 0);
  const range = q.sheets.length > 1 ? `No.${q.startNo}〜No.${q.startNo + q.sheets.length - 1}` : `No.${q.startNo}`;
  const warn = notes.length ? `\n作るときに気になった点（回答の「確認してほしいこと」に書く）：\n${[...new Set(notes)].map((n) => `- ${n}`).join('\n')}` : '';
  return {
    toolResult:
      `小テストの Word を2つ作りました（${q.sheets.length}枚・${range}・全${count}問）。\n小テスト：${qf.url}\n答え入り：${af.url}${warn}\n` +
      '回答には、この2つのURLと、先生が解いて確かめる下書きであること、1枚に収まっているかを Word で確かめてほしいことを書く。',
    created: [
      { ok: true, title: `小テスト：${q.title}`, url: qf.url, note: `作成（${q.sheets.length}枚・${count}問）` },
      { ok: true, title: `小テスト：${q.title}（答え入り）`, url: af.url, note: '作成' },
    ],
  };
}

/** create_math_material：Word を2つ作って保存し、AI に返す文と、ログ用の結果を返す。 */
export async function runCreateMathMaterial(
  input: Record<string, unknown>,
  who: { campus: string; user: string },
  signal?: AbortSignal,
): Promise<{ toolResult: string; created: CreatedDoc[] }> {
  const c = checkMathMaterialInput(input);
  if (!c.ok) return { toolResult: c.message, created: [{ ok: false, title: `数学の教材：${String(input?.title ?? '')}`, note: c.message }] };
  const m = c.value;
  const notes: string[] = [];
  const render = figureRenderer(notes);
  let problem: Buffer;
  let answer: Buffer;
  try {
    const built = await buildProblemDocx(m, render);
    problem = built.buffer;
    notes.push(...built.notes);
    answer = await buildAnswerDocx(m);
  } catch (e) {
    const why = `Word を組み立てられませんでした（${String((e as Error)?.message ?? e).slice(0, 120)}）`;
    return { toolResult: `${why}。職員にそのことを伝え、問題・解答・解説を回答に書く。`, created: [{ ok: false, title: `数学の教材：${m.title}`, note: why }] };
  }
  const j = await callGas(
    {
      action: 'saveAiFiles',
      campus: who.campus,
      user: who.user,
      files: [
        { name: `${m.title}_問題.docx`, mime: DOCX_MIME, base64: problem.toString('base64') },
        { name: `${m.title}_解答・解説.docx`, mime: DOCX_MIME, base64: answer.toString('base64') },
      ],
    },
    signal,
  );
  const files = Array.isArray(j.files) ? (j.files as { name?: unknown; url?: unknown }[]) : [];
  // 再デプロイ前の Apps Script は未知の action に ok だけ返すので、saved の印が無ければ未対応とみなす。
  if (!j.ok || j.saved !== 'aiFiles' || files.length < 2 || files.some((f) => typeof f.url !== 'string')) {
    const why = j.ok ? NOT_DEPLOYED : REASONS[String(j.reason)] ?? 'ファイルを保存できませんでした';
    const detail = typeof j.detail === 'string' && j.detail ? `／詳細: ${j.detail}` : '';
    return {
      toolResult: `Word のファイルを保存できませんでした（${why}）。職員にそのことを伝え、問題・解答・解説を回答に書く。`,
      created: [{ ok: false, title: `数学の教材：${m.title}`, note: `${why}${detail}` }],
    };
  }
  const [pf, af] = files as { name: string; url: string }[];
  const warn = notes.length ? `\n作るときに気になった点（回答の「確認してほしいこと」に書く）：\n${[...new Set(notes)].map((n) => `- ${n}`).join('\n')}` : '';
  const pages = m.booklet ? '表紙・扉つき（模試の形）' : '問題のページだけ';
  return {
    toolResult:
      `Word のファイルを2つ作りました（${pages}、大問${m.problems.length}題）。\n問題：${pf.url}\n解答・解説：${af.url}${warn}\n` +
      '回答には、この2つのURLと、数学科の先生が解いて確かめる下書きであること、図の位置と改ページを Word で確かめてほしいことを書く。',
    created: [
      { ok: true, title: `数学の教材：${m.title}（問題）`, url: pf.url, note: `作成（大問${m.problems.length}${m.booklet ? '・表紙つき' : ''}）` },
      { ok: true, title: `数学の教材：${m.title}（解答・解説）`, url: af.url, note: '作成' },
    ],
  };
}
