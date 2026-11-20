// Zoom の参加URL・ミーティングIDの表示（lib/zoom/link.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMeetingId, zoomErrorText, zoomJoinHref } from './link.ts';

test('Zoom のURLだけをリンク先にする', () => {
  assert.equal(zoomJoinHref('https://us06web.zoom.us/j/82345678901?pwd=abc'), 'https://us06web.zoom.us/j/82345678901?pwd=abc');
  assert.equal(zoomJoinHref('https://zoom.us/j/123456789'), 'https://zoom.us/j/123456789');
  assert.equal(zoomJoinHref('http://zoom.us/j/123456789'), '');
  assert.equal(zoomJoinHref('https://zoom.us.example.com/j/1'), '');
  assert.equal(zoomJoinHref('https://example.com/?next=https://zoom.us/j/1'), '');
  assert.equal(zoomJoinHref('javascript:alert(1)'), '');
  assert.equal(zoomJoinHref(''), '');
  assert.equal(zoomJoinHref(undefined), '');
});

test('ミーティングIDを区切って見せる', () => {
  assert.equal(formatMeetingId('82345678901'), '823 4567 8901');
  assert.equal(formatMeetingId('1234567890'), '12 3456 7890');
  assert.equal(formatMeetingId('123456789'), '1 2345 6789');
  assert.equal(formatMeetingId('abc'), 'abc');
  assert.equal(formatMeetingId(''), '');
});

test('失敗の理由ごとに文を出す', () => {
  assert.match(zoomErrorText('bad_date'), /開催日時/);
  assert.match(zoomErrorText('forbidden'), /部門長/);
  assert.match(zoomErrorText('something_else'), /失敗/);
});
