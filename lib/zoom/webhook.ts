// Zoom からの通知（Webhook）の確かめ方（Zoom連携）。サーバ専用。
//
// Zoom は通知ごとに、本文とアプリの「Secret Token」から作った署名を付けてくる。
//   x-zm-request-timestamp … 送った時刻（秒）
//   x-zm-signature         … 'v0=' + HMAC-SHA256(Secret Token, `v0:${timestamp}:${本文そのまま}`)
// 署名が合わない通知は、Zoom を名乗る別の誰かが送ったものとして捨てる。
// 通知先を登録するときには、Zoom が「endpoint.url_validation」を送ってくるので、
// 受け取った plainToken を Secret Token で HMAC したものを返す（3秒以内）。

import { createHmac, timingSafeEqual } from 'node:crypto';

// 古い通知の送り直し（盗み見た通知をあとで送る）を防ぐため、時刻がずれすぎているものは捨てる。
const MAX_SKEW_SEC = 5 * 60;

function hmacHex(secret: string, text: string): string {
  return createHmac('sha256', secret).update(text).digest('hex');
}

export function verifyZoomSignature(
  secret: string,
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  nowMs = Date.now(),
): boolean {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > MAX_SKEW_SEC) return false;
  const want = Buffer.from(`v0=${hmacHex(secret, `v0:${timestamp}:${rawBody}`)}`);
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** 通知先の確認（endpoint.url_validation）への返事。 */
export function urlValidationReply(secret: string, plainToken: string): { plainToken: string; encryptedToken: string } {
  return { plainToken, encryptedToken: hmacHex(secret, plainToken) };
}
