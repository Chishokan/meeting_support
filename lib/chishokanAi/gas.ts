// 智翔館AI から Apps Script（APPS_SCRIPT_URL）を呼ぶ。サーバ専用。

export type GasResult = Record<string, unknown> & { ok?: boolean; reason?: string };

/** Apps Script を待つ長さ（ms）。文書・スライドを作る処理は長めに待つ。 */
const DEFAULT_TIMEOUT_MS = 60_000;
const TIMEOUT_MS: Record<string, number> = { createAiDoc: 120_000, createAiSlides: 150_000, saveAiFiles: 120_000 };

/**
 * Apps Script を呼ぶ。待ちすぎたら timeout、signal で止められたら aborted を返す
 * （智翔館AI の回答は 300 秒で打ち切られるので、その手前で必ず戻るようにする）。
 */
export async function callGas(payload: Record<string, unknown>, signal?: AbortSignal): Promise<GasResult> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured' };
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, TIMEOUT_MS[String(payload.action)] ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: process.env.APPS_SCRIPT_TOKEN || '', ...payload }),
      cache: 'no-store',
      signal: ctl.signal,
    });
    const j = (await res.json().catch(() => null)) as GasResult | null;
    if (ctl.signal.aborted) return { ok: false, reason: timedOut ? 'timeout' : 'aborted' };
    if (!res.ok || !j) return { ok: false, reason: 'upstream_error' };
    return j;
  } catch {
    if (ctl.signal.aborted) return { ok: false, reason: timedOut ? 'timeout' : 'aborted' };
    return { ok: false, reason: 'network_error' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
