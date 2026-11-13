// 数学の教材の道具（mathMaterialTool.ts）の入力の確かめのテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMathMaterialInput, MATH_MATERIAL_TOOL } from './mathMaterialTool.ts';

const base = {
  title: '中3 関数',
  problems: [{ intro: '次の各問いに答えなさい。', items: [{ text: '点Aの座標を求めよ。', sub: ['（１）', ''] }, { text: '' }] }],
  answers: [{ items: ['(2, 1)'] }],
};

test('checkMathMaterialInput：既定を埋める（toi・表紙なし・50分・空の小問は外す）', () => {
  const r = checkMathMaterialInput(base);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.problems[0].numbering, 'toi');
  assert.equal(r.value.problems[0].items.length, 1);
  assert.deepEqual(r.value.problems[0].items[0].sub, ['（１）']);
  assert.equal(r.value.booklet, false);
  assert.deepEqual(r.value.cover, { name: '中3 関数', minutes: 50 });
  assert.deepEqual(r.value.explanations, ['']);
});

test('checkMathMaterialInput：直せない形は理由を返す', () => {
  assert.equal(checkMathMaterialInput({ ...base, title: '' }).ok, false);
  assert.equal(checkMathMaterialInput({ ...base, problems: [] }).ok, false);
  assert.equal(checkMathMaterialInput({ ...base, answers: [] }).ok, false);
  const many = { ...base, problems: Array.from({ length: 9 }, () => base.problems[0]) };
  assert.match((checkMathMaterialInput(many) as { message: string }).message, /8題まで/);
});

test('checkMathMaterialInput：表と図を受け取り、題名のファイル名に使えない文字は外す', () => {
  const r = checkMathMaterialInput({
    ...base,
    title: '中3/関数:第1回',
    booklet: true,
    cover: { name: '統一模試 233号', minutes: 45 },
    problems: [{ numbering: 'kakko', side: [{ label: '表', table: [['a', 'b'], ['1', '2']] }, { figure: { range: [0, 0, 1, 1] } }, { label: 'x' }], items: [{ text: '計算せよ。' }] }],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.title, '中3 関数 第1回');
  assert.equal(r.value.problems[0].numbering, 'kakko');
  assert.equal(r.value.problems[0].side.length, 2); // 図も表も無いものは外す
  assert.deepEqual(r.value.cover, { name: '統一模試 233号', minutes: 45 });
});

test('MATH_MATERIAL_TOOL：$ref を使わない（API がそのまま読める形）', () => {
  assert.equal(JSON.stringify(MATH_MATERIAL_TOOL.input_schema).includes('$ref'), false);
});
