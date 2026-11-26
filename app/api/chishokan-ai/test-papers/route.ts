// 智翔館AI：中学校のテスト問題（定期テスト・実力テスト・入試問題）を、チャットの［🗄 テスト問題を保存］の小窓から保存する。
//   GET              … 保存できるか（Apps Script が新しいか）を小窓を開いたときに確かめる
//   POST step:'file'  … { meta, file:{ name, mime, data }, index }：ファイルを1つ保存する
//                       （アプリが1回に受け取れる大きさに上限（約4.5MB）があるため、1つずつ送る。1つ3MBまで。画像は画面で縮めてある）
//   POST step:'entry' … { meta, files:[{ name, url, id }] }：全部のファイルを保存できたら、1件として「中学校テスト問題」シートに記録する
//   POST step:'discard' … { ids }：保存をやめたとき、記録しなかったファイルをゴミ箱へ（Apps Script 側で、このフォルダの2時間以内のものだけ）
// 保存先はドライブ「15_AI利用データ/中学校テスト問題/<種類>」。共有の設定は変えない。検索は AI の search_test_papers。
// 決まり（選べる学校・入力の確かめ・ファイル名）は lib/chishokanAi/testPapers.ts。

import { getSession, verifiedEmail } from '@/lib/core/auth';
import { AI_DENIED_MESSAGE, canUseChishokanAi } from '@/lib/chishokanAi/access';
import { callGas } from '@/lib/chishokanAi/gas';
import { logAi } from '@/lib/chishokanAi/aiLog';
import { checkFile, checkMeta, checkSavedFiles, testLabel } from '@/lib/chishokanAi/testPapers';
import { TEST_NOT_DEPLOYED, discardTestPaperFiles, saveTestPaperEntry, saveTestPaperFile } from '@/lib/chishokanAi/testPapersRun';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bad = (message: string, status = 400) => Response.json({ ok: false, message }, { status });

function guard() {
  const session = getSession();
  if (!session) return { error: bad('ログインし直してください。', 401) };
  if (!canUseChishokanAi(session)) return { error: bad(AI_DENIED_MESSAGE, 403) };
  return { session };
}

export async function GET() {
  const g = guard();
  if (g.error) return g.error;
  const s = g.session!;
  // 再デプロイ前の Apps Script は知らない action を「会話ログ」に書くので、何の行か分かるようにしておく
  const j = await callGas({ action: 'listTestPapers', campus: s.campus, user: s.name, input: '[智翔館AI] テスト問題の保存の小窓を開いた（Apps Script の再デプロイ前）', output: '' });
  if (j.ok && j.saved !== 'testPaper') return Response.json({ ok: true, ready: false, message: TEST_NOT_DEPLOYED });
  if (!j.ok) return Response.json({ ok: true, ready: false, message: '保存先（Apps Script）につながりませんでした。時間をおいて開き直してください。' });
  const items = (Array.isArray(j.items) ? j.items : []) as Record<string, unknown>[];
  // 入試問題（私立）の学校名の候補：これまでに入れた名前（書き方をそろえやすくする）
  const privateSchools = [...new Set(items.filter((r) => r.kind === '入試問題' && r.entranceType === '私立').map((r) => String(r.school ?? '').trim()).filter(Boolean))].slice(0, 50);
  return Response.json({ ok: true, ready: true, count: items.length, privateSchools });
}

export async function POST(req: Request) {
  const g = guard();
  if (g.error) return g.error;
  const session = g.session!;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return bad('送る中身が足りません。');
  const step = String((body as Record<string, unknown>).step ?? '');

  if (step === 'discard') {
    const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map(String) : [];
    const trashed = await discardTestPaperFiles(ids);
    return Response.json({ ok: true, trashed });
  }

  const m = checkMeta(body.meta);
  if (!m.ok) return bad(m.message);
  const meta = m.value;

  if (step === 'file') {
    const f = checkFile(body.file);
    if (!f.ok) return bad(f.message);
    const index = Math.max(0, Math.min(99, Math.floor(Number(body.index) || 0)));
    const r = await saveTestPaperFile(meta, f.value, index);
    if (!r.ok) return Response.json({ ok: false, message: r.message, notDeployed: r.reason === 'not_deployed' }, { status: 502 });
    return Response.json({ ok: true, file: r.file });
  }

  if (step === 'entry') {
    const files = checkSavedFiles(body.files);
    if (!files.length) return bad('保存したファイルがありません。ファイルを付けてください。');
    const r = await saveTestPaperEntry(meta, files, { campus: session.campus, user: session.name });
    if (!r.ok) return Response.json({ ok: false, message: r.message }, { status: 502 });
    const label = testLabel(meta);
    void logAi(
      {
        user: session.name,
        campus: session.campus,
        email: verifiedEmail() ?? '',
        kind: 'テスト問題',
        conversationId: typeof body.conversationId === 'string' ? body.conversationId.slice(0, 40) : '',
        question: `保存：${label}${meta.listed ? '' : '（一覧に無い学校）'}${meta.memo ? `｜メモ：${meta.memo.slice(0, 80)}` : ''}`,
        files: r.files.map((f) => `${f.name} ${f.url}`).join('\n'),
      },
      { input: `[智翔館AI テスト問題の保存] ${label}`, output: r.files.map((f) => f.url).join(' ') },
      { timeoutMs: 8000 },
    );
    return Response.json({ ok: true, id: r.id, label, files: r.files });
  }

  return bad('送る中身が足りません。');
}
