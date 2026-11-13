// Apps Script 呼び出し（gas.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { callGas } from './gas.ts';

async function withServer(delayMs: number, fn: (url: string) => Promise<void>) {
  const server = http.createServer((_req, res) => {
    const t = setTimeout(() => res.end(JSON.stringify({ ok: true, saved: 'x' })), delayMs);
    res.on('close', () => clearTimeout(t));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as { port: number };
  try {
    await fn(`http://127.0.0.1:${port}/`);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

test('callGas：止める合図（signal）が来たら待たずに aborted を返す', async () => {
  await withServer(5_000, async (url) => {
    process.env.APPS_SCRIPT_URL = url;
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const t0 = Date.now();
    const r = await callGas({ action: 'listSlideTemplates' }, ac.signal);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'aborted');
    assert.ok(Date.now() - t0 < 2_000);
  });
});

test('callGas：返事があればそのまま返す', async () => {
  await withServer(10, async (url) => {
    process.env.APPS_SCRIPT_URL = url;
    const r = await callGas({ action: 'listSlideTemplates' });
    assert.equal(r.ok, true);
    assert.equal(r.saved, 'x');
  });
});
