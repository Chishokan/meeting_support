// HP（WordPress）の問い合わせフォームからの直接取り込み（Webhook の受け口）。
//
//   POST /api/inquiry-board/intake
//     認証: ヘッダ X-Intake-Token（または ?token= ／ body の token）が INQUIRY_INTAKE_TOKEN と一致すること
//     本文: JSON ／ form-urlencoded ／ multipart のいずれか（項目名は lib/inquiryIntake.ts の FIELD_ALIASES）
//     応答: { ok:true, action:'create'|'append'|'skip', ... }
//
// ログインは要らない（WordPress のサーバから呼ばれる）。代わりにトークンで守る。
// INQUIRY_INTAKE_TOKEN が未設定なら受け付けない（誰でも登録できる状態を作らないため）。
//
// WordPress 側の設定は README「HP フォームからの直接取り込み」を参照。

import { timingSafeEqual } from 'crypto';
import { readFields, decideIntake, type IntakePayload } from '@/lib/inquiryIntake';
import { validateInput } from '@/lib/inquiryRecords';
import { fiscalPeriod, jstDate } from '@/lib/companyKnowledge';
import { createRecord, listRecords, updateRecord } from '@/lib/inquiryStore';

export const runtime = 'nodejs';
export const maxDuration = 30;

const INTAKE_USER = 'HPフォーム';

function tokenOk(given: string): boolean {
  const expected = process.env.INQUIRY_INTAKE_TOKEN || '';
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readPayload(req: Request): Promise<IntakePayload> {
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  try {
    if (ct.includes('application/json')) {
      const j = await req.json();
      return j && typeof j === 'object' && !Array.isArray(j) ? (j as IntakePayload) : {};
    }
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const fd = await req.formData();
      const out: IntakePayload = {};
      fd.forEach((v, k) => {
        if (typeof v !== 'string') return; // 添付ファイルは受け取らない
        const cur = out[k];
        out[k] = cur == null ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
      });
      return out;
    }
    // Content-Type が無い・想定外でも、JSON として読めれば受け付ける
    const t = await req.text();
    const j = JSON.parse(t);
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as IntakePayload) : {};
  } catch {
    return {};
  }
}

function todayIso(): string {
  const { y, m, d } = jstDate(new Date());
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export async function POST(req: Request) {
  if (!process.env.INQUIRY_INTAKE_TOKEN) {
    return Response.json({ ok: false, reason: 'intake_not_configured' }, { status: 503 });
  }

  const url = new URL(req.url);
  const payload = await readPayload(req);
  const given = req.headers.get('x-intake-token') || url.searchParams.get('token') || String(payload.token ?? '');
  if (!tokenOk(given)) return Response.json({ ok: false, reason: 'invalid_token' }, { status: 401 });
  delete payload.token;

  const fields = readFields(payload);

  const list = await listRecords();
  if (!list.ok) return Response.json({ ok: false, reason: list.reason }, { status: 502 });

  const decision = decideIntake(fields, list.items, todayIso());

  if (decision.action === 'skip') {
    console.log('[INQUIRY_INTAKE]', JSON.stringify({ action: 'skip', reason: decision.reason, submissionId: fields.submissionId }));
    return Response.json({ ok: true, action: 'skip', reason: decision.reason });
  }

  const v = validateInput(decision.input, fiscalPeriod().startYear);
  if (!v.ok) return Response.json({ ok: false, reason: 'invalid', errors: v.errors }, { status: 400 });

  if (decision.action === 'append') {
    const r = await updateRecord(decision.target.id, v.value, INTAKE_USER);
    if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: 502 });
    console.log('[INQUIRY_INTAKE]', JSON.stringify({ action: 'append', campus: r.item.campus, no: r.item.no }));
    return Response.json({ ok: true, action: 'append', campus: r.item.campus, no: r.item.no, id: r.item.id });
  }

  const r = await createRecord(v.value, INTAKE_USER);
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: 502 });
  console.log('[INQUIRY_INTAKE]', JSON.stringify({ action: 'create', campus: r.item.campus, no: r.item.no }));
  return Response.json({ ok: true, action: 'create', campus: r.item.campus, no: r.item.no, id: r.item.id });
}

// 疎通確認用（トークンは要らない。設定済みかどうかだけ返す）
export async function GET() {
  return Response.json({ ok: true, service: 'inquiry-intake', configured: !!process.env.INQUIRY_INTAKE_TOKEN });
}
