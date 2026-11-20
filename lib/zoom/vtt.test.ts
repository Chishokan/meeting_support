// Zoom の文字起こし（VTT）の読み取り（lib/zoom/vtt.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksJapanese, vttToText } from './vtt.ts';

const VTT = `WEBVTT

1
00:00:07.120 --> 00:00:09.800
智翔館公式チャンネル１: 成績表のデータをもらえないですか

2
00:00:10.000 --> 00:00:12.000
智翔館公式チャンネル１: スプレッドシートで送ります

3
00:00:13.000 --> 00:00:15.500
太田: 了解です
`;

test('番号と時刻を落とし、話者が変わったところにだけ名前を付ける', () => {
  assert.equal(
    vttToText(VTT),
    '智翔館公式チャンネル１：成績表のデータをもらえないですか\nスプレッドシートで送ります\n太田：了解です',
  );
});

test('話者の無い行・<v> の形・時刻に時間が無い形も読める', () => {
  const v = 'WEBVTT\n\n00:01.000 --> 00:03.000\nこんにちは\n\n00:04.000 --> 00:06.000\n<v 安東>次の議題です</v>\n';
  assert.equal(vttToText(v), 'こんにちは\n安東：次の議題です');
});

test('中身が無ければ空', () => {
  assert.equal(vttToText('WEBVTT\n\n'), '');
  assert.equal(vttToText(''), '');
});

test('日本語として取れているかを見分ける', () => {
  assert.equal(looksJapanese('議事録作成テストです。対話内容が正しく音声認識されているかテスト中です。'), true);
  assert.equal(looksJapanese('Thank you. Gigi lock sock say test this. Tie one I own.'), false);
  assert.equal(looksJapanese('はい'), false);
  assert.equal(looksJapanese(''), false);
});
