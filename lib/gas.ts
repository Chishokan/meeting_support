// Apps Script（Web アプリ）への呼び出しを一箇所にまとめる。
//
// Google 側（スプレッドシート・ドキュメント・ドライブ）への読み書きは、
// すべて APPS_SCRIPT_URL へ「action 付きの JSON を POST」する形で行う。
// 以前は各 Route Handler が同じ fetch を書いていたため、token の付け忘れや
// エラー判定のばらつき（res.ok だけ見る／本文の ok まで見る）が起きていた。
//
// ★GAS(ContentService) は失敗時も HTTP 200 を返すので、本文の ok/reason を必ず見る。
//   ここを通せばその判定は自動で入る。
//
// 未設定（APPS_SCRIPT_URL が空）でもアプリは壊さない方針：
//   呼び出し側は reason === 'not_configured' を「機能停止ではなく未接続」として扱い、
//   HTTP 200 で画面に案内を出す（gasErrorStatus を参照）。

export type GasData = { ok: true } & Record<string, unknown>;

export type GasResult =
  | { ok: true; data: GasData }
  | { ok: false; reason: string };

/** APPS_SCRIPT_URL が設定されているか（画面の出し分け・早期リターン用）。 */
export function isGasConfigured(): boolean {
  return Boolean(process.env.APPS_SCRIPT_URL);
}

/**
 * action を指定して Apps Script を呼ぶ。token はここで付ける。
 * - 未設定: { ok:false, reason:'not_configured' }
 * - 通信失敗: { ok:false, reason:'network_error' }
 * - GAS が ok:false を返した: { ok:false, reason: GAS の reason（無ければ 'upstream_error'） }
 */
export async function callGas(action: string, payload: Record<string, unknown> = {}): Promise<GasResult> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: process.env.APPS_SCRIPT_TOKEN || '', ...payload }),
      cache: 'no-store',
    });
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && j && j.ok === true) return { ok: true, data: j as GasData };
    return { ok: false, reason: (j && typeof j.reason === 'string' && j.reason) || 'upstream_error' };
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

/**
 * 失敗理由 → HTTP ステータス。
 * not_configured は「未接続」の案内を画面に出すための状態なので 200、それ以外は 502。
 */
export function gasErrorStatus(reason: string): number {
  return reason === 'not_configured' ? 200 : 502;
}

/** GAS の戻り値 items を配列として取り出す（無ければ空配列）。 */
export function gasItems<T = Record<string, unknown>>(data: GasData): T[] {
  return Array.isArray(data.items) ? (data.items as T[]) : [];
}
