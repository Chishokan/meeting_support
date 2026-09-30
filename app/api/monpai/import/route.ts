// 門配管理：スプレッドシート「RED広報関連」の過去の実績・計画の取り込み口。
// apps_script/monpai_import.gs が1か月ずつ送ってくる。ログインの代わりに合言葉で守る。
//   POST  ヘッダ x-import-token: MONPAI_IMPORT_TOKEN
//         { month: 'YYYY-MM', records: [{ date, time, school, staff1, staff2, planned, done, reason, memo }] }
//   → その月の「シート取込」の記録を入れ替える（何度送っても二重にならない）
// 地区は学校マスタから決める。マスタに無い学校の行は取り込まず、学校名を返す（マスタに足してから送り直す）。
import { validateRecord } from '@/lib/monpai/model';
import { getMaster, replaceImportedMonth } from '@/lib/monpai/store';

export const runtime = 'nodejs';
export const maxDuration = 60;

const norm = (s: string) => s.replace(/^[\s　\d０-９]+/, '').replace(/[\s　]/g, '');

export async function POST(req: Request) {
  const token = process.env.MONPAI_IMPORT_TOKEN;
  if (!token) return Response.json({ ok: false, reason: 'import_not_configured' }, { status: 503 });
  if (req.headers.get('x-import-token') !== token) return Response.json({ ok: false, reason: 'invalid_token' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { month?: string; records?: Record<string, unknown>[] };
  const month = String(body.month ?? '');
  if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ ok: false, reason: 'bad_month' }, { status: 400 });
  const list = Array.isArray(body.records) ? body.records.slice(0, 3000) : [];

  const master = await getMaster();
  if (!master.ok) return Response.json({ ok: false, reason: master.reason }, { status: 502 });
  const byName = new Map(master.schools.map((s) => [norm(s.name), s]));

  const inputs = [];
  const unknown = new Set<string>();
  const invalid: string[] = [];
  for (const r of list) {
    const school = byName.get(norm(String(r.school ?? '')));
    if (!school) { unknown.add(String(r.school ?? '')); continue; }
    if (!String(r.date ?? '').startsWith(month)) { invalid.push(`${r.date} ${school.name}（月が違う）`); continue; }
    const done = r.done === '' || r.done == null ? null : r.done;
    const v = validateRecord({
      ...r, school: school.name, district: school.district, done,
      status: '予定', material: '', memo: String(r.memo ?? '').slice(0, 500),
      // 実績が計画に届かなかった理由が入っていれば残す（中止扱いにはしない）
      reason: String(r.reason ?? '').slice(0, 500),
    });
    if (!v.ok) { invalid.push(`${r.date} ${school.name}：${v.errors.join(' ')}`); continue; }
    inputs.push(v.value);
  }

  const res = await replaceImportedMonth(month, inputs);
  if (!res.ok) return Response.json({ ok: false, reason: res.reason }, { status: 502 });
  return Response.json({ ok: true, month, inserted: res.inserted, unknownSchools: [...unknown], invalid: invalid.slice(0, 50) });
}
