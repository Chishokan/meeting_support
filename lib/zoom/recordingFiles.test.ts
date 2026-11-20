// 録画ファイルの選び方（lib/zoom/recordingFiles.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickAudio, pickZoomTranscript, stillProcessing, transcribeOrder } from './recordingFiles.ts';

const f = (type: string, size: number, status = 'completed') => ({ type, size, status, downloadUrl: `https://zoom.us/rec/download/${type}` });

test('音声だけのファイルを優先し、無ければいちばん小さい動画を使う', () => {
  assert.equal(pickAudio([f('MP4', 90_000_000), f('M4A', 3_000_000), f('TRANSCRIPT', 2000)])?.ext, 'm4a');
  const only = pickAudio([f('MP4', 90_000_000), f('MP4', 40_000_000)]);
  assert.equal(only?.ext, 'mp4');
  assert.equal(only?.file.size, 40_000_000);
  assert.equal(pickAudio([f('CHAT', 100)]), null);
});

test('処理中のファイルは使わず、処理中であることは分かる', () => {
  const files = [f('M4A', 3_000_000, 'processing')];
  assert.equal(pickAudio(files), null);
  assert.equal(stillProcessing(files), true);
  assert.equal(stillProcessing([f('M4A', 3_000_000)]), false);
});

test('Zoom の文字起こしを選ぶ', () => {
  assert.equal(pickZoomTranscript([f('M4A', 1), f('TRANSCRIPT', 2000)])?.type, 'TRANSCRIPT');
  assert.equal(pickZoomTranscript([f('M4A', 1)]), null);
});

test('試す順番：既定は OpenAI → Gemini → Zoom。設定で入れ替えても予備は残る', () => {
  assert.deepEqual(transcribeOrder(undefined), ['openai', 'gemini', 'zoom']);
  assert.deepEqual(transcribeOrder('gemini'), ['gemini', 'openai', 'zoom']);
  assert.deepEqual(transcribeOrder('Zoom, gemini , x'), ['zoom', 'gemini', 'openai']);
  assert.deepEqual(transcribeOrder('gemini,openai', 'zoom'), ['zoom']);
  assert.deepEqual(transcribeOrder('', 'whisper'), ['openai', 'gemini', 'zoom']);
});
