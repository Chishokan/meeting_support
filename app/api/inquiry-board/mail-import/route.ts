// 問合せ管理の「最新状況取り込み」ボタン。
//   POST /api/inquiry-board/mail-import
//     Gmail に届いた HP フォームの通知メールのうち、まだ取り込んでいない分を台帳に登録・追記する（lib/inquiryMailImport.ts）。
//     1回で最大10通。応答の remaining が 0 より大きければ、画面が続けて呼ぶ。
//
// 台帳の閲覧・編集と同じく、小中等部と管理部門だけが使える。

import { getSession } from '@/lib/auth';
import { canUseInquiryBoard } from '@/lib/inquiryBoardAccess';
import { importInquiryMails } from '@/lib/inquiryMailImport';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (!canUseInquiryBoard(session.campus)) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  const r = await importInquiryMails();
  return Response.json(r);
}
