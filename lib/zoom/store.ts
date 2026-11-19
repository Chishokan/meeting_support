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
