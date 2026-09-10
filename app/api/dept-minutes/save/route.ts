import { getSession } from '@/lib/auth';
import { extractDecisions, extractMinutes, extractQuality } from '@/lib/deptMinutesParse';

export const runtime = 'nodejs';
export const maxDuration = 30;

// 入力者が確認・編集した議事録を保存する。
// Apps Script（APPS_SCRIPT_URL）に action:'saveDeptMinutes' を送り、GAS 側で
//   ・「部門会議議事録」シートに1会議1行
//   ・「部門決定事項」シートに1決定1行（部門横断の見える化のもと）
// を記録する。APPS_SCRIPT_URL 未設定でもアプリは壊れない（画面側は localStorage に保持済み）。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const content = String(body?.content ?? '').trim();
  if (!content) return Response.json({ ok: false, reason: 'empty' }, { status: 400 });

  const meta = (body?.meta ?? {}) as Record<string, unknown>;
  // 保存するのは入力者が確認した最終テキスト。決定事項はそこから抜き出す
  //（AIの生成時ではなく保存時に抜くので、人が直した内容がそのまま集計に載る）。
  const minutes = extractMinutes(content);
  const quality = extractQuality(content);
  const decisions = extractDecisions(content);

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured', decisions: decisions.length });

  const payload = {
    action: 'saveDeptMinutes',
    token: process.env.APPS_SCRIPT_TOKEN || '',
    ts: new Date().toISOString(),
    campus: session.campus,
    user: session.name,
    title: String(meta.title ?? ''),
    date: String(meta.date ?? ''),
    place: String(meta.place ?? ''),
    attendees: String(meta.attendees ?? ''),
    agenda: String(meta.agenda ?? ''),
    minutes,
    quality,
    decisions,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // GAS(ContentService)は失敗時も HTTP 200 を返すため、本文の ok/reason を必ず確認する。
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true) {
      return Response.json({ ok: true, decisions: decisions.length });
    }
    return Response.json({ ok: false, reason: (j && j.reason) || 'upstream_error' }, { status: 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }
}
