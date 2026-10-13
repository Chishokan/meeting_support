// 旧スプレッドシート「智翔館 つきいち改善リニューアルシステム」からの取り込み（管理部門のみ）。
// POST { answers: 「回答」シートの CSV, votes?: 「投票回答」シートの CSV }
// 何度取り込んでも二重にしない（改善は source、票は対象月×投票者で見分け、すでにあるものは足さない）。
// アプリで入れ直した票は上書きしない。読み方は lib/kaizen/model.ts の legacyItems / legacyVotes。

import { randomUUID } from 'crypto';
import { getSession } from '@/lib/core/auth';
import { ADMIN_CAMPUS } from '@/lib/core/staff';
import { LEGACY_VOTES_FROM, legacyItems, legacyVotes, nowJstText, parseCsv, type LegacyVotes } from '@/lib/kaizen/model';
import { importKaizen, loadKaizen } from '@/lib/kaizen/store';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_CSV_CHARS = 2_000_000;

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (session.campus !== ADMIN_CAMPUS) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { answers?: unknown; votes?: unknown };
  const answers = typeof body.answers === 'string' ? body.answers : '';
  const votesCsv = typeof body.votes === 'string' ? body.votes : '';
  if (!answers.trim() || answers.length > MAX_CSV_CHARS || votesCsv.length > MAX_CSV_CHARS) {
    return Response.json({ ok: false, reason: 'invalid', message: '「回答」シートの CSV を選んでください。' }, { status: 400 });
  }
  const answerRows = parseCsv(answers);
  if (!answerRows[0]?.some((h) => h.trim() === '改善タイトル')) {
    return Response.json({ ok: false, reason: 'invalid', message: '「回答」シートの CSV ではないようです（1行目に「改善タイトル」がありません）。' }, { status: 400 });
  }
  const voteRows = votesCsv.trim() ? parseCsv(votesCsv) : [];
  if (voteRows.length && !voteRows[0].some((h) => h.includes('投票者'))) {
    return Response.json({ ok: false, reason: 'invalid', message: '「投票回答」シートの CSV ではないようです（1行目に「投票者」がありません）。' }, { status: 400 });
  }

  const r = await loadKaizen();
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: r.reason === 'not_configured' ? 200 : 502 });

  // すでに取り込んだ改善（同じ日時・タイトル）は足さない。同じ CSV の中の重なりも1件にする
  const parsed = legacyItems(answerRows, randomUUID, nowJstText());
  const sources = new Set(r.items.map((k) => k.source).filter(Boolean));
  const newItems = parsed.filter((k) => (sources.has(k.source) ? false : (sources.add(k.source), true)));

  // 票は、取り込み済みの改善と今回の改善のどちらにも突き合わせる。すでに票がある人（アプリで入れた人も）は足さない
  const votes: LegacyVotes = voteRows.length ? legacyVotes(voteRows, [...r.items, ...newItems]) : { votes: [], old: 0, unmatched: [] };
  const have = new Set(r.votes.map((v) => `${v.month}|${v.voter}`));
  const newVotes = votes.votes.filter((v) => !have.has(`${v.month}|${v.voter}`));

  const s = await importKaizen(newItems, newVotes);
  if (!s.ok) return Response.json({ ok: false, reason: s.reason }, { status: 502 });
  return Response.json({
    ok: true,
    items: { added: newItems.length, skipped: parsed.length - newItems.length },
    votes: { added: newVotes.length, skipped: votes.votes.length - newVotes.length, old: votes.old, unmatched: votes.unmatched, from: LEGACY_VOTES_FROM },
  });
}
