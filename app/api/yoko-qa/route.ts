import { getSession } from '@/lib/auth';
import { sanitizeHistory } from '@/lib/sanitize';
import { cachedMessages, lastUserText, streamClaude, type Msg } from '@/lib/claudeStream';
import { buildYokoQaPrompt } from '@/lib/yokoQaPrompt';
import { loadYokoDocs, confirmedDocs, formatDocs, formatIndex } from '@/lib/knowledgeDocs';
import { buildCards, docPeriod } from '@/lib/yokoCards';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 要項は全社員が保護者対応で使うものなので、部門を限定しない（個人情報を含まない）。

// 一覧・件数を返す（画面上部の表示用）。
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const docs = await loadYokoDocs();
  const confirmed = confirmedDocs(docs);

  // 日程が読めない要項はカードに出しようがない。件数だけ返して画面で知らせる
  // （要項側の「日程：」が空のまま確定されている、という現場の修正点になる）。
  const periodUnknown = confirmed.filter((d) => !docPeriod(d.body).start).length;

  return Response.json({
    ok: true,
    cards: buildCards(confirmed),
    periodUnknown,
    confirmed: confirmed.map((d) => ({ title: d.title, updated: d.updated, owner: d.owner })),
    pending: docs.filter((d) => d.status !== '確定').map((d) => ({ title: d.title })),
    total: docs.length,
  });
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  const messages = sanitizeHistory(raw) as Msg[];
  if (messages.length === 0) return new Response('messages required', { status: 400 });

  const all = await loadYokoDocs();
  const confirmed = confirmedDocs(all);
  const pending = all.filter((d) => d.status !== '確定');

  const systemText = buildYokoQaPrompt({
    dept: session.campus,
    name: session.name,
    docsText: formatDocs(confirmed),
    pendingText: formatIndex(pending),
  });

  // 要項はデプロイ間で変わらないので、システム側のキャッシュがよく効く。
  return streamClaude({
    label: 'yoko-qa',
    system: systemText,
    messages: cachedMessages(messages),
    maxTokens: 4000,
    log: { user: session.name, campus: session.campus, input: `[要項QA] ${lastUserText(messages)}` },
    cacheNote: `confirmed=${confirmed.length}/${all.length}`,
  });
}
