// 「最新状況取り込み」ボタン：HP フォームの通知メール（Gmail）→ 問合せ台帳。
//
// Apps Script（apps_script/Code.gs の listInquiryMails）がまだ取り込んでいないメールを返し、
// ここで本文を読んで Webhook 取り込みと同じ決まり（lib/inquiryIntake.ts の decideIntake）で登録・追記する。
// 取り込んだメールは markInquiryMailsDone で「メール取込済」タブに記録され、次からは返ってこない。
//
// 二重登録を防ぐ仕組みは2段:
//   1. 「メール取込済」タブにあるメールは GAS が返さない
//   2. 途中で止まって記録が漏れても、新規は受付ID（gmail:<メールID>）で、追記は同じ受信時刻・フォーム・内容の行で
//      decideIntake が skip する（備考の1行にメールの受信時刻を入れるため）

import { callGas, createRecord, listRecords, updateRecord } from './inquiryStore';
import { decideIntake, formNameFromSubject, parseMailBody, readFields } from './inquiryIntake';
import { validateInput, type InquiryRecord } from './inquiryRecords';
import { fiscalPeriod } from './companyKnowledge';

const IMPORT_USER = 'HPメール取込';
/** 1回の呼び出しで GAS に頼む通数。台帳への保存1件に1〜2秒かかるので、関数の時間内に収まる数にする。 */
const BATCH = 10;
/** これを過ぎたら次のメールに進まず、残りは次の呼び出しに回す（maxDuration より短く）。 */
const TIME_BUDGET_MS = 40_000;

/** 採用・求人など、問い合わせではない通知メール（件名で見分ける）。 */
const NOT_INQUIRY_SUBJECT = /採用|求人|応募|リクルート|エントリー|講師募集/;

type InquiryMail = { id: string; threadId: string; date: string; subject: string; body: string };

export type MailImportLine = {
  subject: string;
  date: string;
  result: 'create' | 'append' | 'skip' | 'error';
  detail: string; // 「駅前校 No.12」「対象外（氏名なし）」など
};

export type MailImportResult =
  | { ok: true; created: number; appended: number; skipped: number; failed: number; remaining: number; lines: MailImportLine[] }
  | { ok: false; reason: string };

function jstParts(iso: string): { date: string; hm: string } {
  const d = new Date(iso);
  const t = isNaN(d.getTime()) ? new Date() : d;
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(t);
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? '';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` };
}

const SKIP_TEXT: Record<string, string> = {
  duplicate_submission: '取り込み済み',
  already_noted: '備考に記載済み',
  empty: '対象外（氏名・連絡先なし）',
};

export async function importInquiryMails(): Promise<MailImportResult> {
  const started = Date.now();
  const got = (await callGas({ action: 'listInquiryMails', limit: BATCH })) as {
    ok?: boolean; reason?: string; items?: InquiryMail[]; pending?: number;
  };
  if (!got.ok || !Array.isArray(got.items)) return { ok: false, reason: got.reason || 'upstream_error' };

  const list = await listRecords();
  if (!list.ok) return { ok: false, reason: list.reason };
  const rows: InquiryRecord[] = [...list.items];
  const startYear = fiscalPeriod().startYear;

  const lines: MailImportLine[] = [];
  const done: { id: string; threadId: string; date: string; subject: string; result: string }[] = [];
  let stoppedEarly = false;
  let saveFailed = false;

  for (const mail of got.items) {
    if (Date.now() - started > TIME_BUDGET_MS) { stoppedEarly = true; break; }
    const { date, hm } = jstParts(mail.date);
    const line = (result: MailImportLine['result'], detail: string) => {
      lines.push({ subject: mail.subject, date: `${date} ${hm}`, result, detail });
      done.push({ id: mail.id, threadId: mail.threadId, date: mail.date, subject: mail.subject, result: `${result}:${detail}` });
    };

    if (NOT_INQUIRY_SUBJECT.test(mail.subject)) { line('skip', '対象外（件名）'); continue; }
    const formName = formNameFromSubject(mail.subject);
    const fields = readFields({ ...parseMailBody(mail.body), form: formName, submission_id: `gmail:${mail.id}` });
    if (!fields.studentName && !fields.guardianName) { line('skip', '対象外（氏名なし）'); continue; }

    const decision = decideIntake(fields, rows, date, hm);
    if (decision.action === 'skip') { line('skip', SKIP_TEXT[decision.reason] ?? decision.reason); continue; }

    const v = validateInput(decision.input, startYear);
    if (!v.ok) { line('error', `入力エラー（${v.errors.join(' ')}）`); continue; }

    if (decision.action === 'append') {
      const r = await updateRecord(decision.target.id, v.value, IMPORT_USER);
      // 保存の失敗は一時的なことが多いので記録せず、次のボタンでやり直す
      if (!r.ok) { lines.push({ subject: mail.subject, date: `${date} ${hm}`, result: 'error', detail: `保存できませんでした（${r.reason}）` }); saveFailed = true; break; }
      const i = rows.findIndex((x) => x.id === r.item.id);
      if (i >= 0) rows[i] = r.item;
      line('append', `${r.item.campus} No.${r.item.no} ${r.item.studentName} に追記`);
      continue;
    }

    const r = await createRecord(v.value, IMPORT_USER);
    if (!r.ok) { lines.push({ subject: mail.subject, date: `${date} ${hm}`, result: 'error', detail: `保存できませんでした（${r.reason}）` }); saveFailed = true; break; }
    rows.push(r.item);
    line('create', `${r.item.campus} No.${r.item.no} ${r.item.studentName} を登録`);
  }

  if (done.length) {
    const m = await callGas({ action: 'markInquiryMailsDone', items: done });
    if (!m.ok) console.error('[INQUIRY_MAIL_IMPORT]', JSON.stringify({ mark_failed: m.reason }));
  }

  const count = (k: MailImportLine['result']) => lines.filter((l) => l.result === k).length;
  const pending = typeof got.pending === 'number' ? got.pending : got.items.length;
  const remaining = Math.max(pending - done.length, 0);
  console.log('[INQUIRY_MAIL_IMPORT]', JSON.stringify({
    create: count('create'), append: count('append'), skip: count('skip'), error: count('error'), remaining, stoppedEarly, saveFailed,
  }));
  return {
    ok: true,
    created: count('create'), appended: count('append'), skipped: count('skip'), failed: count('error'),
    // 保存エラーで止めたときは続けて呼ばせない（同じところで失敗し続けるため）
    remaining: saveFailed ? 0 : remaining,
    lines,
  };
}
