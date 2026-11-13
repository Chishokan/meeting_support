// 智翔館AI の Google スライドを作る道具（slidesTool.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSlidesInput, formatTemplateDetail, formatTemplateList } from './slidesTool.ts';

test('checkSlidesInput：足りないもの・形の違うものを断る', () => {
  assert.equal(checkSlidesInput({}).ok, false);
  assert.equal(checkSlidesInput({ template: '企画書', title: '冬期', slides: [] }).ok, false);
  const badFrom = checkSlidesInput({ template: '企画書', title: '冬期', slides: [{ from: -1 }] });
  assert.ok(!badFrom.ok && /from/.test(badFrom.message));
  const badKey = checkSlidesInput({ template: '企画書', title: '冬期', slides: [{ from: 0, texts: { 'a b': 'x' } }] });
  assert.ok(!badKey.ok && /key/.test(badKey.message));
  const tooMany = checkSlidesInput({ template: '企画書', title: '冬期', slides: Array.from({ length: 31 }, () => ({ from: 0 })) });
  assert.ok(!tooMany.ok && /30枚/.test(tooMany.message));
});

test('checkSlidesInput：文字・表・ノートを整える', () => {
  const r = checkSlidesInput({
    template: ' 企画書 ',
    title: 'あ'.repeat(100),
    slides: [{ from: 1, texts: { '5': '概要', '4.1': 1 }, tables: { '2': [['項目', '内容'], ['期間', 12]] }, notes: '話すこと' }],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.template, '企画書');
  assert.equal(r.value.title.length, 80);
  assert.deepEqual(r.value.slides[0].texts, { '5': '概要', '4.1': '1' });
  assert.deepEqual(r.value.slides[0].tables['2'], [['項目', '内容'], ['期間', '12']]);
  assert.equal(r.value.slides[0].notes, '話すこと');
});

test('formatTemplateList / formatTemplateDetail：AI に見せる形', () => {
  assert.match(formatTemplateList([]), /ひな形がありません/);
  const list = formatTemplateList([{ id: 'x', name: '企画書・計画書（社内向け）', slides: 3, labels: ['企画書', '概要', ''] }]);
  assert.match(list, /- 企画書・計画書（社内向け）（3枚）：0:企画書／1:概要／2:（文字なし）/);
  const detail = formatTemplateDetail({
    id: 'x',
    name: '企画書・計画書（社内向け）',
    slides: [
      { index: 0, label: '企画書', items: [{ key: '5', type: 'text', text: '企画書', max: 8 }, { key: '4', type: 'text', text: '社内ナレッジ\n共有会', max: 17 }] },
      {
        index: 1,
        label: '概要',
        items: [
          { key: '3', type: 'text', text: '概要', max: 8 },
          { key: '0', type: 'table', rows: 5, cols: 2, cells: [['企画内容', '共有会'], ['対象', '全社員'], ['期間', '7月〜9月'], ['趣旨', '共有'], ['担当', '管理部']] },
        ],
      },
    ],
  });
  assert.match(detail, /■ from=0「企画書」/);
  assert.match(detail, /- 4［17字］社内ナレッジ⏎共有会/);
  assert.match(detail, /- 0［表 5行×2列］\n {4}\| 企画内容 \| 共有会 \|/);
  assert.match(detail, /…（ほか2行）/);
});
