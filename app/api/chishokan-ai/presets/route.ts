// 智翔館AI：いつものコンテキスト（会話をまたいで使う前提。1人10個まで）。ログインで確かめたメールアドレスの持ち主の分だけを読み書きする。
// GET … 一覧／PUT { id?, name, text, auto } … 登録・直す（id が無ければ新しく足す）／DELETE ?id=… … 消す

import { PIN_MAX_NAME, PIN_MAX_TEXT } from '@/lib/chishokanAi/pinnedContext';
import { gateResponse, savedGate } from '@/lib/chishokanAi/savedGate';
import { checkPreset, isPresetId } from '@/lib/chishokanAi/savedRules';
import { deletePreset, listPresets, putPreset } from '@/lib/chishokanAi/savedStore';

export const runtime = 'nodejs';

const failed = (detail?: string) => Response.json({ ok: false, reason: 'db_error', message: '保存先とのやり取りに失敗しました。もう一度お試しください。', detail }, { status: 502 });

export async function GET() {
  const g = savedGate();
  if (!g.ok) return gateResponse(g);
  const r = await listPresets(g.owner);
  return r.ok ? Response.json({ ok: true, items: r.items }, { headers: { 'Cache-Control': 'no-store' } }) : failed(r.detail);
}

export async function PUT(req: Request) {
  const g = savedGate();
  if (!g.ok) return gateResponse(g);
  const list = await listPresets(g.owner);
  if (!list.ok) return failed(list.detail);
  const c = checkPreset(await req.json().catch(() => null), list.items, { maxName: PIN_MAX_NAME, maxText: PIN_MAX_TEXT });
  if (!c.ok) return Response.json({ ok: false, reason: 'bad_input', message: c.message }, { status: 400 });
  const r = await putPreset(g.owner, c.preset);
  return r.ok ? Response.json({ ok: true, item: r.item }) : failed(r.detail);
}

export async function DELETE(req: Request) {
  const g = savedGate();
  if (!g.ok) return gateResponse(g);
  const id = new URL(req.url).searchParams.get('id');
  if (!isPresetId(id)) return new Response('bad id', { status: 400 });
  const r = await deletePreset(g.owner, id);
  return r.ok ? Response.json({ ok: true }) : failed(r.detail);
}
