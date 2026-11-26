// アプリが作った Zoom ミーティングの対応表（Zoom連携）。サーバ専用。
// 「ミーティングID ⇔ 事前共有」を Supabase に残しておき、録画完了の通知が来たときに
// どの部門・どの会議の録画かをすぐ引けるようにする（通知には3秒以内に応答する必要があるため、
// 1〜3秒かかるスプレッドシートではなくデータベースに置く）。
// テーブルは supabase/migrations/0004_zoom_meetings.sql。
//
// Supabase が未設定でも事前共有と参加ボタンは動く（対応表に残らないだけ）。

import { supabaseAdmin } from '@/lib/core/supabase';

export type ZoomMeetingLink = {
  account: string; // '1'（公式1）| '2'（公式2）
  meetingId: string;
  preshareId: string;
  campus: string;
  startTime: string; // 日本時間 'YYYY-MM-DDTHH:mm:00'
  durationMin: number;
  createdBy: string;
  host?: string; // ホスト担当（渡したときだけ書き換える）
};

/** 対応表に記録する（同じミーティングは上書き）。失敗しても呼び出し元は止めない。 */
export async function saveMeetingLink(link: ZoomMeetingLink): Promise<'ok' | 'not_configured' | 'error'> {
  const db = supabaseAdmin();
  if (!db) return 'not_configured';
  try {
    const { error } = await db.from('zoom_meetings').upsert(
      {
        account: link.account,
        meeting_id: link.meetingId,
        preshare_id: link.preshareId,
        campus: link.campus,
        // 列は timestamptz。日本時間であることを明示して渡す。
        start_time: `${link.startTime}+09:00`,
        duration_min: link.durationMin,
        created_by: link.createdBy,
        updated_at: new Date().toISOString(),
        ...(link.host ? { host_name: link.host } : {}),
      },
      { onConflict: 'account,meeting_id' },
    );
    if (error) {
      console.error('[ZOOM_LINK_ERROR]', error.message);
      return 'error';
    }
    return 'ok';
  } catch (e) {
    console.error('[ZOOM_LINK_ERROR]', e instanceof Error ? e.message : String(e));
    return 'error';
  }
}

/** 対応表から消す（事前共有を削除したとき）。失敗しても呼び出し元は止めない。 */
export async function deleteMeetingLinks(preshareId: string): Promise<'ok' | 'not_configured' | 'error'> {
  const db = supabaseAdmin();
  if (!db) return 'not_configured';
  try {
    const { error } = await db.from('zoom_meetings').delete().eq('preshare_id', preshareId);
    if (error) {
      console.error('[ZOOM_LINK_ERROR]', error.message);
      return 'error';
    }
    return 'ok';
  } catch (e) {
    console.error('[ZOOM_LINK_ERROR]', e instanceof Error ? e.message : String(e));
    return 'error';
  }
}

/** 通知で届いたミーティングIDから、どの事前共有の会議かを引く。見つからなければ null。 */
export async function findMeetingLink(account: string, meetingId: string): Promise<{ preshareId: string; campus: string } | null> {
  const db = supabaseAdmin();
  if (!db) return null;
  try {
    const { data, error } = await db
      .from('zoom_meetings').select('preshare_id, campus').eq('account', account).eq('meeting_id', meetingId).maybeSingle();
    if (error || !data) return null;
    return { preshareId: String(data.preshare_id ?? ''), campus: String(data.campus ?? '') };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ホスト担当と、開始の記録（supabase/migrations/0007_zoom_meeting_host.sql）
// ---------------------------------------------------------------------------

/** 事前共有ごとのホスト担当。決めていない会議は入らない。失敗したら空（一覧は止めない）。 */
export async function meetingHosts(preshareIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const db = supabaseAdmin();
  const ids = preshareIds.filter(Boolean);
  if (!db || ids.length === 0) return out;
  try {
    const { data } = await db.from('zoom_meetings').select('preshare_id, host_name').in('preshare_id', ids);
    for (const r of data ?? []) if (r.host_name) out.set(String(r.preshare_id), String(r.host_name));
  } catch {}
  return out;
}

/** ホスト担当を替える。対応表に行が無い会議（古いもの）は、ここで行を作る。 */
export async function setMeetingHost(
  link: { account: string; meetingId: string; preshareId: string; campus: string },
  host: string,
): Promise<boolean> {
  const db = supabaseAdmin();
  if (!db) return false;
  try {
    const { error } = await db.from('zoom_meetings').upsert(
      {
        account: link.account, meeting_id: link.meetingId, preshare_id: link.preshareId, campus: link.campus,
        host_name: host, updated_at: new Date().toISOString(),
      },
      { onConflict: 'account,meeting_id' },
    );
    if (error) console.error('[ZOOM_HOST_ERROR]', error.message);
    return !error;
  } catch {
    return false;
  }
}

/** だれがいつホストとして開始したか（最後の1回）。会話ログとは別に、確実に残すために書く。 */
export async function markMeetingStarted(account: string, meetingId: string, by: string): Promise<void> {
  const db = supabaseAdmin();
  if (!db) return;
  try {
    const { error } = await db
      .from('zoom_meetings').update({ started_by: by, started_at: new Date().toISOString() })
      .eq('account', account).eq('meeting_id', meetingId);
    if (error) console.error('[ZOOM_STARTED_ERROR]', error.message);
  } catch {}
}
