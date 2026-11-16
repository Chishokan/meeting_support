// 智翔館AI：会話の保存（履歴・保存した会話）。ログインで確かめたメールアドレスの持ち主の会話だけを読み書きする。
// 決まり（件数・期間）は lib/chishokanAi/savedRules.ts、読み書きは lib/chishokanAi/savedStore.ts。
//
// GET            … 一覧（履歴・保存した会話）といつものコンテキスト。使えないときは enabled: false と理由
// GET ?id=…      … 1つの会話の中身（ファイルに書き出す形。lib/chishokanAi/savedConversation.ts）
// PUT            … 自動保存 { id, data }（質問のたび・コンテキストを変えたとき）
// POST           … { action: 'save', id, title } 保存した会話にする／{ action: 'unsave', id } 履歴に戻す
// DELETE ?id=…   … 消す

import { normalizeContext } from '@/lib/chishokanAi/conversation';
import { normalizePinnedList } from '@/lib/chishokanAi/pinnedContext';
import { buildSaved, conversationTitle, parseSaved } from '@/lib/chishokanAi/savedConversation';
import { gateResponse, savedGate } from '@/lib/chishokanAi/savedGate';
import { checkSave, cleanTitle, CONVO_MAX_CHARS, isConvoId } from '@/lib/chishokanAi/savedRules';
import {
  deleteConversation,
  getConversation,
  listConversations,
  listPresets,
  putConversation,
  setConversationKind,
} from '@/lib/chishokanAi/savedStore';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };
const failed = (detail?: string) => Response.json({ ok: false, reason: 'db_error', message: '保存先とのやり取りに失敗しました。少し待ってから、もう一度お試しください。', detail }, { status: 502 });

export async function GET(req: Request) {
  const g = savedGate();
  if (!g.ok) return gateResponse(g);
  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    if (!isConvoId(id)) return new Response('bad id', { status: 400 });
    const r = await getConversation(g.owner, id);
    if (!r.ok) return r.reason === 'not_found' ? Response.json({ ok: false, reason: 'not_found', message: 'その会話は見つかりません（期限で消えたかもしれません）。' }, { status: 404 }) : failed(r.detail);
    return Response.json({ ok: true, id: r.row.id, kind: r.row.kind, title: r.row.title, data: r.row.data }, { headers: NO_STORE });
  }
  const [list, presets] = await Promise.all([listConversations(g.owner), listPresets(g.owner)]);
  if (!list.ok) return failed(list.detail);
  if (!presets.ok) return failed(presets.detail);
  return Response.json({ ok: true, enabled: true, history: list.history, saved: list.saved, presets: presets.items }, { headers: NO_STORE });
}

export async function PUT(req: Request) {
  const g = savedGate();
  if (!g.ok) return gateResponse(g);
  const body = await req.json().catch(() => null);
  if (!isConvoId(body?.id)) return new Response('bad id', { status: 400 });
  const p = parseSaved(body?.data);
  if (!p.ok) return Response.json({ ok: false, reason: 'bad_data', message: p.message }, { status: 400 });
  // 中身を確かめ直した形で持つ（コンテキスト・持ち越しも、それぞれの決まりで）
  const clean = buildSaved({
    conversationId: body.id,
    messages: p.value.messages,
    pinned: normalizePinnedList(p.value.pinned),
    pinUsed: p.value.pinUsed,
    carry: normalizeContext(p.value.carry),
    savedAt: new Date().toISOString(),
  });
  const chars = JSON.stringify(clean).length;
  if (chars > CONVO_MAX_CHARS) {
    return Response.json(
      { ok: false, reason: 'too_large', message: '会話が長くなりすぎて、これ以上は保存できません。要点をコンテキストにまとめて、新しい会話で続けてください。' },
      { status: 413 },
    );
  }
  const turns = clean.messages.filter((m) => m.role === 'user').length;
  const r = await putConversation(g.owner, body.id, { data: clean, autoTitle: conversationTitle(clean.messages), turns, chars });
  if (!r.ok) return failed(r.detail);
  return Response.json({ ok: true, kind: r.kind });
}

export async function POST(req: Request) {
  const g = savedGate();
  if (!g.ok) return gateResponse(g);
  const body = await req.json().catch(() => null);
  if (!isConvoId(body?.id)) return new Response('bad id', { status: 400 });
  if (body?.action === 'save') {
    const list = await listConversations(g.owner);
    if (!list.ok) return failed(list.detail);
    const c = checkSave(list.all, body.id);
    if (!c.ok) return Response.json({ ok: false, reason: 'limit', message: c.message }, { status: 409 });
    const r = await setConversationKind(g.owner, body.id, '保存', cleanTitle(body.title));
    return r.ok ? Response.json({ ok: true }) : failed(r.detail);
  }
  if (body?.action === 'unsave') {
    const r = await setConversationKind(g.owner, body.id, '履歴', '');
    return r.ok ? Response.json({ ok: true }) : failed(r.detail);
  }
  return new Response('bad action', { status: 400 });
}

export async function DELETE(req: Request) {
  const g = savedGate();
  if (!g.ok) return gateResponse(g);
  const id = new URL(req.url).searchParams.get('id');
  if (!isConvoId(id)) return new Response('bad id', { status: 400 });
  const r = await deleteConversation(g.owner, id);
  return r.ok ? Response.json({ ok: true }) : failed(r.detail);
}
