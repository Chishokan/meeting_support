// 智翔館AI：中学校のテスト問題の保存（save_test_paper）と検索（search_test_papers）。Apps Script を呼ぶ。サーバ専用。
// 入力の確かめ・ファイル名・絞り込み・結果の文は testPapers.ts。保存先と記録のしかたは apps_script/Code.gs の saveTestPaper_ / listTestPapers_。

import { callGas } from './gas';
import {
  checkSaveInput,
  checkSearchInput,
  filterTestPapers,
  formatTestPapers,
  parseFilesCell,
  testFileName,
  type TestPaperRec,
} from './testPapers';

/** 保存できる添付（PDF・画像）。この質問の添付と前の添付。 */
export type PaperSource = { name: string; mime: string; kind: string; data: string };

const NOT_DEPLOYED = 'Apps Script が古いままのため保存・検索できません（管理者に Apps Script の再デプロイを頼んでください）。';
const s = (v: unknown) => String(v ?? '');

export async function runSaveTestPaper(
  input: Record<string, unknown>,
  sources: PaperSource[],
  ctx: { campus: string; user: string },
  signal?: AbortSignal,
): Promise<{ text: string; saved: boolean; note: string }> {
  const usable = sources.filter((a) => (a.kind === 'pdf' || a.kind === 'image') && typeof a.data === 'string' && a.data);
  const names = [...new Set(usable.map((a) => a.name))];
  const c = checkSaveInput(input, names);
  if (!c.ok) return { text: c.message, saved: false, note: '入力の誤り' };
  const m = c.value;
  const count: Record<string, number> = {};
  const files = m.files.map((f) => {
    const src = usable.find((a) => a.name === f.name)!;
    const n = count[f.role] ?? 0;
    count[f.role] = n + 1;
    return { role: f.role, name: testFileName(m, f.role, src.mime, n), mime: src.mime, base64: src.data };
  });
  const j = await callGas(
    {
      action: 'saveTestPaper',
      campus: ctx.campus,
      user: ctx.user,
      kind: m.kind,
      year: m.year,
      school: m.school,
      grade: m.grade,
      subject: m.subject,
      term: m.term,
      title: m.title,
      topics: m.topics,
      note: m.note,
      files,
    },
    signal,
  );
  const label = `${m.year}年度 ${m.school} ${m.grade} ${m.subject}${m.term ? ` ${m.term}` : ''}（${m.kind}）`;
  if (j.ok && j.saved !== 'testPaper') return { text: `${NOT_DEPLOYED}職員にそのことを伝える。`, saved: false, note: '再デプロイ前' };
  if (!j.ok) {
    const why = s(j.reason) === 'too_large' ? 'ファイルが大きすぎます（合わせて 20MB まで）。ページを分けて保存してください。' : `保存できませんでした（${s(j.reason) || '通信の失敗'}）。`;
    return { text: `${label} を${why}職員にそのことを伝える。「保存しました」とは書かない。`, saved: false, note: `失敗:${s(j.reason)}` };
  }
  const out = (Array.isArray(j.files) ? j.files : []) as Record<string, unknown>[];
  const failed = (Array.isArray(j.failed) ? j.failed : []) as Record<string, unknown>[];
  return {
    text:
      `保存した：${label}。登録番号 ${s(j.id)}。\n` +
      out.map((f) => `- ${s(f.role)}：${s(f.name)} ${s(f.url)}`).join('\n') +
      (failed.length ? `\n保存できなかったファイル：${failed.map((f) => s(f.name)).join('、')}（もう一度保存を頼んでもらう）` : '') +
      '\n回答には、保存した内容（種類・年度・学校・学年・教科・時期・単元）と、ファイルのリンク（上の URL をそのまま）を書く。' +
      '「保存したテストは、学校名・学年・教科・単元の言葉で探せます」と添える。',
    saved: true,
    note: label,
  };
}

export async function runSearchTestPapers(input: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; note: string }> {
  const q = checkSearchInput(input);
  const j = await callGas({ action: 'listTestPapers' }, signal);
  if (j.ok && j.saved !== 'testPaper') return { text: `${NOT_DEPLOYED}職員にそのことを伝える。`, note: '再デプロイ前' };
  if (!j.ok) return { text: '保存したテスト問題の一覧を読めませんでした（Apps Script との通信に失敗しました）。職員にそのことを伝える。', note: '読めず' };
  const rows: TestPaperRec[] = (Array.isArray(j.items) ? (j.items as Record<string, unknown>[]) : []).map((r) => ({
    id: s(r.id),
    ts: s(r.ts),
    user: s(r.user),
    campus: s(r.campus),
    kind: s(r.kind),
    year: s(r.year),
    school: s(r.school),
    grade: s(r.grade),
    subject: s(r.subject),
    term: s(r.term),
    title: s(r.title),
    topics: s(r.topics),
    note: s(r.note),
    files: parseFilesCell(s(r.files)),
  }));
  const found = filterTestPapers(rows, q);
  return { text: formatTestPapers(found, rows.length, q), note: `${found.length}/${rows.length}件` };
}
