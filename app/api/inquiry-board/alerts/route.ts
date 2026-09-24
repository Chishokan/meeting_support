// 問合せ管理の画面上部アラート。
//   GET /api/inquiry-board/alerts?campus=<校舎 or すべて>
//   → { ok, facts, alerts（ルール）, ai: { text, generatedAt, date } | null }
//
// ルール部分（件数・#No.）は lib/inquiryAlerts.ts で毎回いまの台帳から数える（保存すればすぐ変わる）。
// AI の一言（3行）は lib/inquiryAlertsAi.ts。1日1回・全体まとめて生成して保存し、その日は固定。
// その日の分がまだ無ければ、最初に開かれたときにまとめて生成する（cron の保険）。
// AI が使えないとき（キー未設定・エラー）は ai: null で返し、画面はルールの行だけを出す。

import { getSession } from '@/lib/auth';
import { canUseInquiryBoard } from '@/lib/inquiryBoardAccess';
import { listRecords } from '@/lib/inquiryStore';
import { listGoals } from '@/lib/goals';
import { jstDate } from '@/lib/companyKnowledge';
import { buildFacts, ruleAlerts, type Alert } from '@/lib/inquiryAlerts';
import { ALL_SCOPE, aiAvailable, ensureDailyNotes } from '@/lib/inquiryAlertsAi';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (!canUseInquiryBoard(session.campus)) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const scope = (url.searchParams.get('campus') || ALL_SCOPE).trim() || ALL_SCOPE;

  const list = await listRecords();
  if (!list.ok) return Response.json({ ok: false, reason: list.reason });

  const rows = scope === ALL_SCOPE ? list.items : list.items.filter((r) => r.campus === scope);
  const { y, m, d } = jstDate(new Date());
  const today = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // 目標（秋～冬行動計画）。読めなくてもアラートは動く
  const goals = await listGoals();
  const goalRows = goals.ok ? goals.rows : [];
  const facts = buildFacts(rows, scope, today, goalRows);
  const alerts: Alert[] = ruleAlerts(facts);

  let ai: { text: string; generatedAt: string; date: string } | null = null;
  if (rows.length) {
    const notes = await ensureDailyNotes(list.items, goalRows, today);
    const n = notes.find((x) => x.scope === scope);
    if (n) ai = { text: n.text, generatedAt: n.generatedAt, date: n.date };
  }

  return Response.json({
    ok: true,
    facts,
    alerts,
    ai,
    aiAvailable: aiAvailable(),
    goalsStatus: goals.ok ? 'ok' : goals.reason,
  });
}
