// 録画から作る議事録の下書きの文言（lib/zoom/minutesText.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failedAttemptsText, jobErrorText, sourceLabel } from './minutesText.ts';

test('文字起こしの任せ先の呼び名', () => {
  assert.equal(sourceLabel('openai'), 'OpenAI');
  assert.equal(sourceLabel('gemini'), 'Gemini');
  assert.equal(sourceLabel('zoom'), 'Zoom の文字起こし（予備）');
  assert.equal(sourceLabel(''), '');
});

test('うまくいかなかった任せ先だけを並べる', () => {
  assert.equal(
    failedAttemptsText([
      { source: 'openai', ok: false, reason: 'too_large', detail: '41MB' },
      { source: 'gemini', ok: true },
    ]),
    'OpenAI：音声が大きすぎる（41MB）',
  );
  assert.equal(
    failedAttemptsText([{ source: 'gemini', ok: false, reason: 'timeout' }, { source: 'zoom', ok: false, reason: 'not_japanese' }]),
    'Gemini：時間切れ ／ Zoom の文字起こし：日本語として取れていない',
  );
  assert.equal(failedAttemptsText([]), '');
  assert.equal(failedAttemptsText(null), '');
});

test('理由ごとの案内。知らない理由でも文言が出る', () => {
  assert.match(jobErrorText('processing'), /処理中/);
  assert.match(jobErrorText('no_recording'), /録画/);
  assert.match(jobErrorText('???'), /作れませんでした/);
});
