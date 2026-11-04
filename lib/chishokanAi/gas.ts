// 智翔館AI から Apps Script（APPS_SCRIPT_URL）を呼ぶ。サーバ専用。

export type GasResult = Record<string, unknown> & { ok?: boolean; reason?: string };

export async function callGas(payload: Record<string, unknown>): Promise<GasResult> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: process.env.APPS_SCRIPT_TOKEN || '', ...payload }),
      cache: 'no-store',
    });
    const j = (await res.json().catch(() => null)) as GasResult | null;
    if (!res.ok || !j) return { ok: false, reason: 'upstream_error' };
    return j;
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}
