// 適性検査：校正用 CSV（完了した受検1回＝1行）。管理部門のみ。
// 得点と入社後の評価を突き合わせ、判定基準（重み・閾値）を見直すために使う。
// 氏名・連絡先は入れない（校正に要らないため）。Excel で開けるよう UTF-8 の BOM を付ける。
import { exportRows } from '@/lib/aptitude/store';
import { ROLE_LABEL, SCALE_CODES } from '@/lib/aptitude/model';
import { reply, staffGate } from '@/lib/aptitude/api';
import { jpDateTime } from '@/lib/core/supabase';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const SCALE_HEAD: Record<string, string> = {
  L: '虚偽', CP: 'CP', NP: 'NP', A: 'A', FC: 'FC', AC: 'AC', ST: 'ストレス耐性', EM: '情緒不安定', AV: '対人回避', IM: '未成熟',
};

const cell = (v: unknown) => {
  const t = v == null ? '' : String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export async function GET() {
  const g = staffGate();
  if (g.res) return g.res;
  const r = await exportRows(g.actor);
  if (!r.ok) return reply(r);
  const head = ['受検者ID', '職種', '拠点', '受検日時', '方法', '版', ...SCALE_CODES.map((c) => SCALE_HEAD[c]),
    '適性スコア', '判定', 'フラグ', '平均回答秒', '採用結果', '入社後評価', '評価メモ'];
  const lines = [head.map(cell).join(',')];
  for (const x of r.rows) {
    lines.push([
      x.candidateId, ROLE_LABEL[x.role], x.base, jpDateTime(x.completedAt), x.method, x.versionId,
      ...SCALE_CODES.map((c) => x.scores[c]), x.aptitude, x.grade, x.flags, x.avgSeconds, x.hireStatus, x.postEval, x.postEvalNote,
    ].map(cell).join(','));
  }
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="aptitude-${day}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
