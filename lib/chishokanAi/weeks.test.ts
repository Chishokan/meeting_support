// 今週・来週の日付の範囲（weeks.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekRanges } from './weeks.ts';

test('weekRanges：月曜はじまり・日本時間', () => {
  // 2026-11-16（月）22時（日本時間）＝ 13時（UTC）：会話ログの「来週の門配」の質問の時刻
  assert.equal(
    weekRanges(new Date('2026-11-16T13:06:42Z')),
    '今週：11月16日（月）〜11月22日（日）／来週：11月23日（月）〜11月29日（日）／再来週：11月30日（月）〜12月6日（日）',
  );
  // 日曜の夜（日本時間）は、まだその週
  assert.match(weekRanges(new Date('2026-11-22T14:00:00Z')), /^今週：11月16日（月）〜11月22日（日）/);
  // 日本時間では月曜になっている（UTC ではまだ日曜）
  assert.match(weekRanges(new Date('2026-11-22T15:30:00Z')), /^今週：11月23日（月）〜11月29日（日）/);
  // 年をまたぐ
  assert.match(weekRanges(new Date('2026-12-30T03:00:00Z')), /来週：1月4日（月）〜1月10日（日）/);
});
