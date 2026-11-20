// 毎朝の見回りで、議事録の下書きを自動で作る会議の選び方（Zoom連携）。
// ★画面・API・テストのどこからでも読めるよう、ここには import を置かない（型と計算だけ）。

// 会議が終わってから Zoom が録画を用意するまでの待ち（分）。これより前には取りに行かない。
export const PROCESSING_WAIT_MIN = 20;
// 何日前の会議まで見るか。録画が遅れた・文字起こしに失敗した会議を、数日はやり直す。
export const LOOKBACK_DAYS = 3;

export type Now = { today: string; time: string }; // 日本時間の 'YYYY-MM-DD' と 'HH:mm'

/** いまの日本時間。 */
export function jstNow(ms: number): Now {
  const iso = new Date(ms + 9 * 3600 * 1000).toISOString();
  return { today: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function minutesOf(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/**
 * 会議が終わっていて、録画を取りに行ってよいか。
 *   ・きのうまでの会議（LOOKBACK_DAYS 日前まで）
 *   ・きょうの会議で、終了から PROCESSING_WAIT_MIN 分たったもの
 * 開催日時が読めない会議（s が null）は対象にしない。
 */
export function meetingIsOver(s: { day: string; start: string; durationMin: number } | null, now: Now): boolean {
  if (!s) return false;
  const ago = daysBetween(s.day, now.today);
  if (!Number.isFinite(ago) || ago < 0 || ago > LOOKBACK_DAYS) return false;
  if (ago > 0) return true;
  return minutesOf(s.start) + s.durationMin + PROCESSING_WAIT_MIN <= minutesOf(now.time);
}
