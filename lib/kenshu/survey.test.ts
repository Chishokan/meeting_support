// 全体研修会アンケートの入力の整え方（survey.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheer, cleanItems, MAX_ITEMS, MAX_ITEM_LENGTH, splitLines } from './survey.ts';

test('splitLines: 箇条書きの印を外して1行1つに分け、空行は捨てる', () => {
  const text = '・家族で北海道旅行\n- フルマラソン完走\n1. 毎朝30分の読書\n② 料理教室に通う\n\n(3) 富士山に登る\n  英検2級をとる  ';
  assert.deepEqual(splitLines(text), ['家族で北海道旅行', 'フルマラソン完走', '毎朝30分の読書', '料理教室に通う', '富士山に登る', '英検2級をとる']);
});

test('splitLines: 数字で始まる目標そのものは削らない', () => {
  assert.deepEqual(
    splitLines('3.5kg痩せる\n2026.12までに簿記3級\n80名でスタート\n-5kgを目指す'),
    ['3.5kg痩せる', '2026.12までに簿記3級', '80名でスタート', '-5kgを目指す'],
  );
});

test('cleanItems: 文字列以外・空行を捨て、改行は空白にし、長さと数の上限で切る', () => {
  assert.deepEqual(cleanItems(['  a  ', '', null, 3, 'b\nc']), ['a', '3', 'b c']);
  assert.deepEqual(cleanItems('a'), []);
  assert.equal(cleanItems(['x'.repeat(MAX_ITEM_LENGTH + 50)])[0].length, MAX_ITEM_LENGTH);
  assert.equal(cleanItems(Array.from({ length: MAX_ITEMS + 5 }, (_, i) => `item${i}`)).length, MAX_ITEMS);
});

test('cheer: 書いた数で一言が変わる', () => {
  assert.match(cheer(0), /まずは1つ/);
  assert.match(cheer(3), /続けて/);
  assert.match(cheer(5), /^5個/);
  assert.match(cheer(12), /10個をこえ/);
  assert.match(cheer(20), /20個をこえ/);
});
