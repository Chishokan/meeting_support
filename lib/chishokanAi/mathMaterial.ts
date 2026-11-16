// 智翔館AI：数学の教材を、仕上がりの書式の Word（問題・解答と解説の2つ）にして、ドライブに保存する。サーバ専用。
// 道具の定義と入力の確かめは mathMaterialTool.ts、Word を組むのは mathDoc.ts、保存は Apps Script の saveAiFiles_。

import { callGas } from './gas';
import type { CreatedDoc } from './createDoc';
import { parseFigure, textsWithoutGlyph } from './figure';
import { renderFigurePng } from './figurePng';
import { buildAnswerDocx, buildProblemDocx, type FigureRenderer } from './mathDoc';
import { checkMathMaterialInput } from './mathMaterialTool';
import { materialScopeMessage, quizScopeMessage } from './mathScope';
import { buildQuizDocx, QuizOverflowError } from './mathQuizDoc';
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

/** Apps Script と同じ名前の整え方（保存した名前と、頼んだ名前を突き合わせるため）。 */
const cleanName = (n: string) => n.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 100);

type SaveOutcome =
  | { ok: false; why: string; detail: string }
  | { ok: true; saved: { label: string; url: string; shareError?: string }[]; failed: { label: string; detail: string }[] };

/**
 * saveAiFiles の返事を、頼んだファイルごとの結果にする。一部だけ保存できたときも、保存できた分を返す
 * （Apps Script はファイルごとに3回まで試し、できた分は files、できなかった分は failed で返す）。
 */
export function readSaveResult(j: Record<string, unknown>, wanted: { label: string; name: string }[]): SaveOutcome {
  const files = Array.isArray(j.files) ? (j.files as { name?: unknown; url?: unknown; shareError?: unknown }[]) : [];
  const failed = Array.isArray(j.failed) ? (j.failed as { name?: unknown; detail?: unknown }[]) : [];
  if (!j.ok || j.saved !== 'aiFiles' || !files.length || files.some((f) => typeof f.url !== 'string')) {
    const why = j.ok ? NOT_DEPLOYED : REASONS[String(j.reason)] ?? 'ファイルを保存できませんでした';
    return { ok: false, why, detail: typeof j.detail === 'string' ? j.detail : '' };
  }
  const out: Extract<SaveOutcome, { ok: true }> = { ok: true, saved: [], failed: [] };
  wanted.forEach((w, i) => {
    const suffix = cleanName(w.name);
    const f = files.find((x) => String(x.name ?? '').endsWith(suffix)) ?? (files.length === wanted.length ? files[i] : undefined);
    if (f) out.saved.push({ label: w.label, url: String(f.url), ...(typeof f.shareError === 'string' && f.shareError ? { shareError: f.shareError } : {}) });
    else {
      const x = failed.find((y) => String(y.name ?? '').endsWith(suffix));
      out.failed.push({ label: w.label, detail: typeof x?.detail === 'string' ? x.detail : '' });
    }
  });
  return out;
}

/** 一部だけ保存できた・共有を設定できなかったときに、AI に伝える文。 */
function partialNote(o: Extract<SaveOutcome, { ok: true }>): string {
  const notes: string[] = [];
  if (o.failed.length) {
    notes.push(
      `「${o.failed.map((f) => f.label).join('」「')}」は保存できませんでした（ドライブの一時的なエラー${o.failed[0].detail ? `：${o.failed[0].detail.slice(0, 80)}` : ''}）。` +
        'この回答では呼び直さない。回答に、保存できたファイルのURLと、保存できなかったファイルがあること、もう一度頼めば作り直せることを書き、中身（問題と答え）も回答に書く。',
    );
  }
  if (o.saved.some((f) => f.shareError)) notes.push('リンクの共有を設定できなかったファイルがあります。開けないときは、ドライブの「AI作成」フォルダから開いてもらう。');
  return notes.length ? `\n${notes.join('\n')}` : '';
}

/** 作る道具の結果。inputError は、入力の誤りで保存の前に止まったとき（直して呼び直せる）。 */
export type MathRunResult = { toolResult: string; created: CreatedDoc[]; inputError?: boolean };

/** 図の記述を PNG にする（文書の画像に出ない日本語の文字があれば notes に書く）。 */
function figureRenderer(notes: string[]): FigureRenderer {
  return async (fig, opts) => {
    const p = parseFigure(fig as Record<string, unknown>);
    if (!p.ok) throw new Error(p.error);
    const noGlyph = textsWithoutGlyph(p.spec);
    if (noGlyph.length) notes.push(`図の「${noGlyph.slice(0, 3).join('」「')}」は、画像では文字が出ません（図の中は半角の文字・記号にする）`);
    const png = await renderFigurePng(p.spec, opts);
    return { data: Buffer.from(png.base64, 'base64'), width: png.width, height: png.height, widthCm: png.widthCm };
  };
}

/** create_math_quiz：小テストの Word（小テスト・答え入り）を作って保存し、AI に返す文と、ログ用の結果を返す。 */
export async function runCreateMathQuiz(
  input: Record<string, unknown>,
  who: { campus: string; user: string },
  signal?: AbortSignal,
): Promise<MathRunResult> {
  const c = checkMathQuizInput(input);
  if (!c.ok) return { toolResult: c.message, created: [{ ok: false, title: `小テスト：${String(input?.title ?? '')}`, note: c.message }], inputError: true };
  const q = c.value;
  // 小学校・中学校の小テストに、高校で習う書き方・方法が無いか（入力の誤りとして返し、書き直してもらう）
  const scopeQ = quizScopeMessage(q);
  if (scopeQ) return { toolResult: scopeQ, created: [{ ok: false, title: `小テスト：${q.title}`, note: `中学の範囲外の書き方で作り直し（${scopeQ.slice(0, 80)}）` }], inputError: true };
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
    // 1枚に収まらない：問題を減らすか枚を分けて、呼び直してもらう（入力の誤りとして扱い、「1回に1組」に数えない）
    if (e instanceof QuizOverflowError) {
      return { toolResult: e.message, created: [{ ok: false, title: `小テスト：${q.title}`, note: `1枚に収まらず作り直し（${e.message.slice(0, 60)}）` }], inputError: true };
    }
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
  const o = readSaveResult(j, [
    { label: '小テスト', name: `${q.title}.docx` },
    { label: '答え入り', name: `${q.title}_答え入り.docx` },
  ]);
  if (!o.ok) {
    return {
      toolResult: `Word のファイルを保存できませんでした（${o.why}）。この回答では呼び直さない。職員にそのことを伝え、問題と答えを回答に書く。`,
      created: [{ ok: false, title: `小テスト：${q.title}`, note: `${o.why}${o.detail ? `／詳細: ${o.detail}` : ''}` }],
    };
  }
  const count = q.sheets.reduce((n, s) => n + s.sections.reduce((k, x) => k + x.items.length, 0), 0);
  const range = q.sheets.length > 1 ? `No.${q.startNo}〜No.${q.startNo + q.sheets.length - 1}` : `No.${q.startNo}`;
  const warn = notes.length ? `\n作るときに気になった点（回答の「確認してほしいこと」に書く）：\n${[...new Set(notes)].map((n) => `- ${n}`).join('\n')}` : '';
  const head = o.failed.length ? `小テストの Word のうち、${o.saved.length}つを保存しました` : `小テストの Word を${o.saved.length}つ作りました`;
  return {
    toolResult:
      `${head}（${q.sheets.length}枚・${range}・全${count}問）。\n${o.saved.map((f) => `${f.label}：${f.url}`).join('\n')}${warn}${partialNote(o)}\n` +
      '回答には、このURLと、先生が解いて確かめる下書きであること、1枚に収まっているかを Word で確かめてほしいことを書く。',
    created: [
      ...o.saved.map((f) => ({ ok: true, title: `小テスト：${q.title}${f.label === '答え入り' ? '（答え入り）' : ''}`, url: f.url, note: f.label === '小テスト' ? `作成（${q.sheets.length}枚・${count}問）` : '作成' })),
      ...o.failed.map((f) => ({ ok: false, title: `小テスト：${q.title}（${f.label}）`, note: `保存できず${f.detail ? `／詳細: ${f.detail}` : ''}` })),
    ],
  };
}

/** create_math_material：Word を2つ作って保存し、AI に返す文と、ログ用の結果を返す。 */
export async function runCreateMathMaterial(
  input: Record<string, unknown>,
  who: { campus: string; user: string },
  signal?: AbortSignal,
): Promise<MathRunResult> {
  const c = checkMathMaterialInput(input);
  if (!c.ok) return { toolResult: c.message, created: [{ ok: false, title: `数学の教材：${String(input?.title ?? '')}`, note: c.message }], inputError: true };
  const m = c.value;
  // 小学校・中学校の教材に、高校で習う書き方・方法が無いか（2026-11-16：模試の解説に点と傾きの式・絶対値の記号が出た）
  const scopeM = materialScopeMessage(m);
  if (scopeM) return { toolResult: scopeM, created: [{ ok: false, title: `数学の教材：${m.title}`, note: `中学の範囲外の書き方で作り直し（${scopeM.slice(0, 80)}）` }], inputError: true };
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
  // 再デプロイ前の Apps Script は未知の action に ok だけ返すので、saved の印が無ければ未対応とみなす（readSaveResult）。
  const o = readSaveResult(j, [
    { label: '問題', name: `${m.title}_問題.docx` },
    { label: '解答・解説', name: `${m.title}_解答・解説.docx` },
  ]);
  if (!o.ok) {
    return {
      toolResult: `Word のファイルを保存できませんでした（${o.why}）。この回答では呼び直さない。職員にそのことを伝え、問題・解答・解説を回答に書く。`,
      created: [{ ok: false, title: `数学の教材：${m.title}`, note: `${o.why}${o.detail ? `／詳細: ${o.detail}` : ''}` }],
    };
  }
  const warn = notes.length ? `\n作るときに気になった点（回答の「確認してほしいこと」に書く）：\n${[...new Set(notes)].map((n) => `- ${n}`).join('\n')}` : '';
  const pages = m.booklet ? '表紙・扉つき（模試の形）' : '問題のページだけ';
  const head = o.failed.length ? `Word のファイルのうち、${o.saved.length}つを保存しました` : `Word のファイルを${o.saved.length}つ作りました`;
  return {
    toolResult:
      `${head}（${pages}、大問${m.problems.length}題）。\n${o.saved.map((f) => `${f.label}：${f.url}`).join('\n')}${warn}${partialNote(o)}\n` +
      '回答には、このURLと、数学科の先生が解いて確かめる下書きであること、図の位置と改ページを Word で確かめてほしいことを書く。',
    created: [
      ...o.saved.map((f) => ({ ok: true, title: `数学の教材：${m.title}（${f.label}）`, url: f.url, note: f.label === '問題' ? `作成（大問${m.problems.length}${m.booklet ? '・表紙つき' : ''}）` : '作成' })),
      ...o.failed.map((f) => ({ ok: false, title: `数学の教材：${m.title}（${f.label}）`, note: `保存できず${f.detail ? `／詳細: ${f.detail}` : ''}` })),
    ],
  };
}
