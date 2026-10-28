// 適性検査：受検者側の API。ログイン不要で、受検URLのトークンだけで開く。
//   GET  … 受検画面に出す状態（同意前／回答中＝設問と途中までの回答／完了／期限切れ／取消）
//   POST { action:'consent', profile } … 同意とプロフィール（フリガナ・生年月日・電話・メール）
//   POST { action:'answers', items }   … 回答の途中保存（items は [{ pos, answer:'Y'|'N', seconds }]）
//   POST { action:'finish' }           … 回答を締めて採点（全問に答えていなければ止める）
// ★得点・判定・尺度名・設問番号は受検者に返さない（採点はサーバだけで行う）。
import { examConsent, examFinish, examSaveAnswers, examView, type ExamAnswerInput } from '@/lib/aptitude/store';
import { validateExamProfile } from '@/lib/aptitude/model';
import { badRequest, invalid, reply as staffReply } from '@/lib/aptitude/api';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

type Ctx = { params: { token: string } };

// データベースのエラーの中身（表名・列名など）は受検者に見せない。サーバのログ（[aptitude-db]）には残っている
function reply(r: { ok: boolean; reason?: string }): Response {
  if (!r.ok && (r.reason ?? '').startsWith('db_error')) return staffReply({ ok: false, reason: 'unknown_error' });
  return staffReply(r);
}

export async function GET(_req: Request, { params }: Ctx) {
  return reply(await examView(params.token));
}

export async function POST(req: Request, { params }: Ctx) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  switch (b.action) {
    case 'consent': {
      const v = validateExamProfile((b.profile ?? {}) as Record<string, unknown>);
      if (!v.ok) return invalid(v.errors);
      return reply(await examConsent(params.token, v.value));
    }
    case 'answers': {
      if (!Array.isArray(b.items) || b.items.length > 200) return badRequest();
      const items: ExamAnswerInput[] = (b.items as Record<string, unknown>[]).map((x) => ({
        pos: Number(x.pos),
        answer: x.answer as ExamAnswerInput['answer'], // Y/N 以外は store 側で捨てる
        seconds: x.seconds == null ? null : Number(x.seconds),
      }));
      return reply(await examSaveAnswers(params.token, items));
    }
    case 'finish':
      return reply(await examFinish(params.token));
    default:
      return badRequest();
  }
}
