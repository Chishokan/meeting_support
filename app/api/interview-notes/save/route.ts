import { getSession } from '@/lib/core/auth';
import { readInterviewMeta } from '@/lib/interviewNotes/prompt';
import { extractChecks, extractNote } from '@/lib/interviewNotes/parse';
import { canSeeAllInterviewNotes } from '@/lib/interviewNotes/access';

export const runtime = 'nodejs';
export const maxDuration = 30;

// 記録者が確認・編集した面談記録を保存する。
// Apps Script（APPS_SCRIPT_URL）に action:'saveInterviewNote' を送り、
// 「面談記録」シート（INTERVIEW_DB_ID。未設定なら会議DXの転記先）に1面談1行で記録する。
// 録音・文字起こしは保存しない（保存するのは人が確認した面談記録だけ）。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const content = String(body?.content ?? '').trim();
  if (!content) return Response.json({ ok: false, reason: 'empty' }, { status: 400 });

  const meta = readInterviewMeta(body?.meta);
  const note = extractNote(content);
  const checks = extractChecks(content);

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured' });

  const payload = {
    action: 'saveInterviewNote',
    token: process.env.APPS_SCRIPT_TOKEN || '',
    // 既存の記録を直して保存し直すときだけ id が付く（付いていなければ新規）。
    id: String(body?.id ?? ''),
    ts: new Date().toISOString(),
    campus: session.campus,
    user: session.name,
    // 他部門の記録は上書きさせない（GAS 側で元の部門と照らし合わせる）。管理部門だけは直せる。
    admin: canSeeAllInterviewNotes(session.campus),
    ...meta,
    note,
    checks,
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
      return Response.json({ ok: true, id: String(j.id ?? ''), updated: j.updated === true });
    }
    const reason = (j && j.reason) || 'upstream_error';
    return Response.json({ ok: false, reason }, { status: reason === 'forbidden' ? 403 : 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }
}
