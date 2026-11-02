import { buildMessage, parseInput, pdfFileName, toDigest } from '@/lib/deptMinutesDigest';
import { summarizeMinutes } from '@/lib/deptMinutesDigestAi';
import { renderDigestPdf } from '@/lib/deptMinutesDigestPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// AI の要約（〜40秒）＋ PDF（〜数秒）。Apps Script の UrlFetchApp も 60 秒前後で切れるので、それより少し長め。
export const maxDuration = 90;

// 議事録1件を「社長送付用の1枚まとめ」にする。呼ぶのは Apps Script（apps_script/MinutesNotify.gs）だけ。
//   POST（Authorization: Bearer <MINUTES_DIGEST_SECRET>）
//   本文: 「部門会議議事録」シートの1行（id, ts, campus, user, title, date, place, attendees, agenda,
//         minutes, quality, editedAt, editedBy）＋ revised（修正版として送り直すとき true）
//   返り値: { ok, fileName, pdf（base64）, message（トークの本文）, pages, fontSize }
// 画面からは呼ばない（ログインの Cookie ではなく合言葉で守る）。
export async function POST(req: Request) {
  const secret = process.env.MINUTES_DIGEST_SECRET || '';
  if (!secret) return Response.json({ ok: false, reason: 'not_configured' }, { status: 503 });
  const auth = req.headers.get('authorization') || '';
  if (auth !== `Bearer ${secret}`) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const input = parseInput(await req.json().catch(() => null));
  if (!input) return Response.json({ ok: false, reason: 'empty' }, { status: 400 });

  const ai = await summarizeMinutes(input);
  if (!ai.ok) return Response.json({ ok: false, reason: ai.reason }, { status: 502 });

  try {
    const digest = toDigest(input, ai.body, new Date());
    const { pdf, pages, fontSize } = await renderDigestPdf(digest);
    return Response.json({
      ok: true,
      fileName: pdfFileName(input),
      pdf: pdf.toString('base64'),
      message: buildMessage(digest),
      pages,
      fontSize,
    });
  } catch (err) {
    console.log('[minutes-digest] pdf failed', input.id, String(err));
    return Response.json({ ok: false, reason: 'pdf_error' }, { status: 500 });
  }
}
