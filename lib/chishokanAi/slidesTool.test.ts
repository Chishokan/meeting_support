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

// --- ひな形の見た目で自由に組む枚（layout）。2026-11-17：セミナーの台本に合う枚がひな形に無く、作れなかった ---
test('checkSlidesInput：layout の枚を受け取り、from の枚と混ぜられる', () => {
  const r = checkSlidesInput({
    template: '企画書',
    title: '夢・志の実現のために',
    slides: [
      { from: 0, texts: { '3': '夢・志の実現のために' } },
      { layout: 'message', title: '最後まで集中して取り組めました', lead: ' まず拍手を ' },
      { layout: 'columns', title: '3つの力', columns: [{ title: '学習習慣', text: '毎日机に向かう' }, { title: '勉強体力', text: '集中できる時間' }, { title: '自学力' }] },
      { layout: 'bullets', base: 2, title: '結果の見方', points: ['立ち位置を知る', '', '次の一歩を決める'], notes: '話すこと' },
      { layout: 'table', title: '冬期講習', table: [['内容', '日程'], ['課題完成会', 1226]] },
    ],
  });
  assert.ok(r.ok, !r.ok ? r.message : '');
  if (!r.ok) return;
  const [a, b, c, d, e] = r.value.slides as Record<string, unknown>[];
  assert.equal(a.from, 0);
  assert.equal(b.layout, 'message');
  assert.equal(b.lead, 'まず拍手を');
  assert.deepEqual(c.columns, [{ title: '学習習慣', text: '毎日机に向かう' }, { title: '勉強体力', text: '集中できる時間' }, { title: '自学力', text: '' }]);
  assert.deepEqual(d.points, ['立ち位置を知る', '次の一歩を決める']);
  assert.equal(d.base, 2);
  assert.equal(d.notes, '話すこと');
  assert.deepEqual(e.table, [['内容', '日程'], ['課題完成会', '1226']]);
  assert.equal('base' in b, false);
});

test('checkSlidesInput：layout の形の違いを断る', () => {
  const one = (s: Record<string, unknown>) => checkSlidesInput({ template: '企画書', title: 't', slides: [s] });
  const msg = (s: Record<string, unknown>) => { const r = one(s); return r.ok ? '' : r.message; };
  assert.match(msg({ layout: 'chart', title: 'x' }), /layout は title・section・message・bullets・columns・table/);
  assert.match(msg({ layout: 'bullets', points: ['a'] }), /title（見出し）がありません/);
  assert.match(msg({ layout: 'bullets', title: 'x' }), /points（箇条書き）がありません/);
  assert.match(msg({ layout: 'bullets', title: 'x', points: Array.from({ length: 9 }, (_, i) => `p${i}`) }), /8つまで/);
  assert.match(msg({ layout: 'columns', title: 'x', columns: [{ title: 'a' }] }), /2〜4枚/);
  assert.match(msg({ layout: 'table', title: 'x', table: [['a', 'b']] }), /見出しの行と1行以上/);
  assert.match(msg({ layout: 'table', title: 'x', table: [['a'], ['b']] }), /2列以上/);
  assert.match(msg({ layout: 'message', title: 'x', base: -1 }), /base/);
  assert.match(msg({ title: 'x' }), /from.*layout/);
  assert.equal(one({ layout: 'section', title: '章の扉' }).ok, true);
});

test('formatTemplateDetail：見た目と、見出しの形の枚を見せる', () => {
  const detail = formatTemplateDetail({
    id: 'x',
    name: '企画書',
    style: { headFont: 'BIZ UDPGothic', headColor: '#124364', bodyFont: 'BIZ UDPGothic', bodyColor: '#000000', accent: '#124364', contentBase: 1 },
    slides: [
      { index: 0, label: '企画書', items: [] },
      { index: 1, label: '概要', items: [], heading: true },
    ],
  });
  assert.match(detail, /見た目：見出し BIZ UDPGothic・#124364／本文 BIZ UDPGothic・#000000／アクセント #124364/);
  assert.match(detail, /【layout で組むとき】.*ほかは 1 枚目の見た目/);
  assert.match(detail, /■ from=1「概要」［見出しの形］/);
  assert.doesNotMatch(detail, /■ from=0「企画書」［見出しの形］/);
  assert.match(formatTemplateList([{ id: 'x', name: '企画書', slides: 2, labels: ['企画書', '概要'] }]), /合わない枚は layout で/);
});
