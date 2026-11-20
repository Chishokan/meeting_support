// 事前共有の「確認しました」の置き場（サーバ専用）。テーブルは supabase/migrations/0006_preshare_confirms.sql。

import { supabaseAdmin } from '@/lib/core/supabase';

const TABLE = 'preshare_confirms';

export function confirmStoreReady(): boolean {
  return supabaseAdmin() !== null;
}

/** 事前共有ごとの、確認した人の名前（確認した順）。失敗したら空（一覧は止めない）。 */
export async function listConfirms(preshareIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const db = supabaseAdmin();
  const ids = preshareIds.filter(Boolean);
  if (!db || ids.length === 0) return out;
  try {
    const { data } = await db.from(TABLE).select('preshare_id, name, confirmed_at').in('preshare_id', ids).order('confirmed_at');
    for (const r of data ?? []) {
      const id = String(r.preshare_id);
      out.set(id, [...(out.get(id) ?? []), String(r.name)]);
    }
  } catch {}
  return out;
}

/** チェックを入れる／外す。 */
export async function setConfirm(preshareId: string, name: string, campus: string, on: boolean): Promise<void> {
  const db = supabaseAdmin();
  if (!db) throw new Error('not_configured');
  const q = on
    ? db.from(TABLE).upsert({ preshare_id: preshareId, name, campus, confirmed_at: new Date().toISOString() }, { onConflict: 'preshare_id,name' })
    : db.from(TABLE).delete().eq('preshare_id', preshareId).eq('name', name);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

/** 事前共有を削除したときに消す。失敗しても呼び出し元は止めない。 */
export async function deleteConfirms(preshareId: string): Promise<void> {
  const db = supabaseAdmin();
  if (!db || !preshareId) return;
  try {
    await db.from(TABLE).delete().eq('preshare_id', preshareId);
  } catch {}
}
