// 智翔館AI：中学校のテスト問題の保存（［🗄 テスト問題を保存］の小窓 → app/api/chishokan-ai/test-papers）と検索（AI の search_test_papers）。
// Apps Script を呼ぶ。サーバ専用。入力の確かめ・ファイル名・絞り込み・結果の文は testPapers.ts。
// 保存先と記録のしかたは apps_script/Code.gs の saveTestPaperFile_・saveTestPaperEntry_・discardTestPaperFiles_・listTestPapers_。

import { callGas } from './gas';
import {
  checkSearchInput,
  filterTestPapers,
  formatTestPapers,
  parseFilesCell,
  testFileName,
  type SavedFile,
  type TestMeta,
  type TestPaperRec,
} from './testPapers';

export const TEST_NOT_DEPLOYED = 'Apps Script が古いままのため保存・検索できません。管理者に Apps Script の再デプロイを頼んでください。';
const s = (v: unknown) => String(v ?? '');

/** ファイルを1つ保存する（種類のフォルダへ）。 */
export async function saveTestPaperFile(
  meta: TestMeta,
  file: { name: string; mime: string; data: string },
  index: number,
): Promise<{ ok: true; file: SavedFile } | { ok: false; message: string; reason: string }> {
  const name = testFileName(meta, file.name, file.mime, index);
  const j = await callGas({ action: 'saveTestPaperFile', kind: meta.kind, name, mime: file.mime, base64: file.data });
  if (j.saved !== 'testPaper') {
    return j.ok || s(j.reason) === 'unknown_action'
      ? { ok: false, message: TEST_NOT_DEPLOYED, reason: 'not_deployed' }
      : { ok: false, message: `${file.name}：保存できませんでした（${s(j.reason) || '通信の失敗'}）。もう一度押してください。`, reason: s(j.reason) };
  }
  const f = (j.file ?? {}) as Record<string, unknown>;
  if (!j.ok || !f.url) {
    const why = s(j.reason) === 'too_large' ? '大きすぎます（1つ3MBまで）' : s(j.reason) === 'bad_type' ? 'この種類のファイルは保存できません' : `保存できませんでした（${s(j.reason)}）`;
    return { ok: false, message: `${file.name}：${why}。`, reason: s(j.reason) };
  }
  return { ok: true, file: { name: s(f.name), url: s(f.url), id: s(f.id) } };
}

/** 保存したファイルをまとめて1件として記録する。 */
export async function saveTestPaperEntry(
  meta: TestMeta,
  files: SavedFile[],
  ctx: { campus: string; user: string },
): Promise<{ ok: true; id: string; files: SavedFile[] } | { ok: false; message: string }> {
  const j = await callGas({
    action: 'saveTestPaperEntry',
    campus: ctx.campus,
    user: ctx.user,
    kind: meta.kind,
    year: meta.year,
    school: meta.school,
    entranceType: meta.entranceType,
    grade: meta.kind === '入試問題' ? '' : meta.grade,
    subject: meta.subject,
    round: meta.round || '',
    memo: meta.memo,
    files,
  });
  if (j.saved !== 'testPaper') return { ok: false, message: j.ok ? TEST_NOT_DEPLOYED : '記録できませんでした（通信の失敗）。もう一度押してください。' };
  if (!j.ok) return { ok: false, message: s(j.reason) === 'no_files' ? 'ファイルが見つからず、記録できませんでした。ファイルを付け直してください。' : `記録できませんでした（${s(j.reason)}）。もう一度押してください。` };
  const out = (Array.isArray(j.files) ? j.files : []) as Record<string, unknown>[];
  return { ok: true, id: s(j.id), files: out.map((f) => ({ name: s(f.name), url: s(f.url), id: s(f.id) })) };
}

/** 保存をやめたとき、記録しなかったファイルをゴミ箱へ（Apps Script 側で、このフォルダの2時間以内のものだけに限る）。 */
export async function discardTestPaperFiles(ids: string[]): Promise<number> {
  const clean = ids.filter((x) => /^[\w-]{10,}$/.test(x)).slice(0, 10);
  if (!clean.length) return 0;
  const j = await callGas({ action: 'discardTestPaperFiles', ids: clean });
  return Number(j.trashed) || 0;
}

export async function runSearchTestPapers(input: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; note: string }> {
  const q = checkSearchInput(input);
  const j = await callGas({ action: 'listTestPapers' }, signal);
  if (j.ok && j.saved !== 'testPaper') return { text: `${TEST_NOT_DEPLOYED}職員にそのことを伝える。`, note: '再デプロイ前' };
  if (!j.ok) return { text: '保存したテスト問題の一覧を読めませんでした（Apps Script との通信に失敗しました）。職員にそのことを伝える。', note: '読めず' };
  const rows: TestPaperRec[] = (Array.isArray(j.items) ? (j.items as Record<string, unknown>[]) : []).map((r) => ({
    id: s(r.id),
    ts: s(r.ts),
    user: s(r.user),
    campus: s(r.campus),
    kind: s(r.kind),
    year: s(r.year),
    school: s(r.school),
    entranceType: s(r.entranceType),
    grade: s(r.grade),
    subject: s(r.subject),
    round: s(r.round),
    memo: s(r.memo),
    files: parseFilesCell(s(r.files)),
  }));
  const found = filterTestPapers(rows, q);
  return { text: formatTestPapers(found, rows.length, q), note: `${found.length}/${rows.length}件` };
}
