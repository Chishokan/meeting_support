// 適性検査：受検（職員側の操作）。管理部門のみ。
//   POST { action:'issue',  candidateId }            … Web 受検の URL を発行（同じ人の未完了の受検は取り消す）
//   POST { action:'paper',  candidateId, answers }   … 紙の回答を代理入力して採点（answers は { 設問番号: 'Y'|'N' }）
//   POST { action:'revoke', id }                     … 受検 URL を取り消す
//   POST { action:'extend', id }                     … 有効期限を延ばす
import { extendSession, issueSession, revokeSession, savePaperSession } from '@/lib/aptitude/store';
import type { AnswerValue } from '@/lib/aptitude/model';
import { badRequest, reply, staffGate } from '@/lib/aptitude/api';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const g = staffGate();
  if (g.res) return g.res;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const candidateId = String(b.candidateId ?? '');
  const id = String(b.id ?? '');
  switch (b.action) {
    case 'issue':
      return candidateId ? reply(await issueSession(candidateId, g.actor)) : badRequest();
    case 'paper': {
      if (!candidateId || !b.answers || typeof b.answers !== 'object') return badRequest();
      const answers: Record<number, AnswerValue> = {};
      for (const [k, v] of Object.entries(b.answers as Record<string, unknown>)) {
        if (v === 'Y' || v === 'N') answers[Number(k)] = v;
      }
      return reply(await savePaperSession(candidateId, answers, g.actor));
    }
    case 'revoke':
      return id ? reply(await revokeSession(id, g.actor)) : badRequest();
    case 'extend':
      return id ? reply(await extendSession(id, g.actor)) : badRequest();
    default:
      return badRequest();
  }
}
