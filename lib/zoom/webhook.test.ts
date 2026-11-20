// Zoom からの通知の確かめ方（lib/zoom/webhook.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { urlValidationReply, verifyZoomSignature } from './webhook.ts';

const SECRET = 'test-secret-token';
const BODY = '{"event":"recording.completed","payload":{"object":{"id":86361806179}}}';
const NOW = 1795150000 * 1000;
const TS = String(1795150000 - 10);
const sign = (secret: string, ts: string, body: string) =>
  `v0=${createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')}`;

test('正しい署名は通る', () => {
  assert.equal(verifyZoomSignature(SECRET, BODY, TS, sign(SECRET, TS, BODY), NOW), true);
});

test('本文・秘密・時刻のどれかが違えば通らない', () => {
  assert.equal(verifyZoomSignature(SECRET, BODY + ' ', TS, sign(SECRET, TS, BODY), NOW), false);
  assert.equal(verifyZoomSignature(SECRET, BODY, TS, sign('other', TS, BODY), NOW), false);
  assert.equal(verifyZoomSignature(SECRET, BODY, null, sign(SECRET, TS, BODY), NOW), false);
  assert.equal(verifyZoomSignature(SECRET, BODY, TS, null, NOW), false);
  assert.equal(verifyZoomSignature('', BODY, TS, sign('', TS, BODY), NOW), false);
});

test('古すぎる通知は通らない', () => {
  const old = String(1795150000 - 3600);
  assert.equal(verifyZoomSignature(SECRET, BODY, old, sign(SECRET, old, BODY), NOW), false);
});

test('通知先の確認には、受け取った文字列を HMAC して返す', () => {
  const r = urlValidationReply(SECRET, 'abc123');
  assert.equal(r.plainToken, 'abc123');
  assert.equal(r.encryptedToken, createHmac('sha256', SECRET).update('abc123').digest('hex'));
});
