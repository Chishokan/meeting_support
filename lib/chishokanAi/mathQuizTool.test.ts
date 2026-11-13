// 数学の小テストの道具（mathQuizTool.ts）の入力の確かめのテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMathQuizInput, DEFAULT_SERIES, MATH_QUIZ_TOOL } from './mathQuizTool.ts';

const item = (text: string) => ({ text, answer: '1' });

test('checkMathQuizInput：既定を埋める（題名・No.・空の問題を外す）', () => {
  const r = checkMathQuizInput({ title: '中1 正負の数', sheets: [{ sections: [{ items: [item('$-3+8$'), { text: '', answer: '' }] }] }] });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.series, DEFAULT_SERIES);
  assert.equal(r.value.startNo, 1);
  assert.equal(r.value.sheets[0].sections[0].items.length, 1);
  assert.equal(r.value.sheets[0].sections[0].heading, '');
});

test('checkMathQuizInput：1枚12問まで・10枚まで、空の枚は理由を返す', () => {
  const many = Array.from({ length: 13 }, (_, i) => item(`問${i}`));
  assert.match((checkMathQuizInput({ title: 't', sheets: [{ sections: [{ items: many }] }] }) as { message: string }).message, /12問まで/);
  assert.equal(checkMathQuizInput({ title: 't', sheets: Array.from({ length: 11 }, () => ({ sections: [{ items: [item('a')] }] })) }).ok, false);
  assert.match((checkMathQuizInput({ title: 't', sheets: [{ sections: [] }] }) as { message: string }).message, /1枚目に問題がありません/);
});

test('checkMathQuizInput：題名・No.・見出し・図と表・よく出る', () => {
  const r = checkMathQuizInput({
    title: '中2/連立', series: '冬期 確認テスト', start_no: 12,
    sheets: [{ sections: [{ heading: '次の連立方程式を解きなさい。', items: [{ text: '右の図で', answer: '1', frequent: true, side: { figure: { range: [0, 0, 1, 1] } } }, { text: 'x', answer: '2', side: { label: 'x' } }] }] }],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.title, '中2 連立');
  assert.equal(r.value.series, '冬期 確認テスト');
  assert.equal(r.value.startNo, 12);
  const its = r.value.sheets[0].sections[0].items;
  assert.equal(its[0].frequent, true);
  assert.ok(its[0].side?.figure);
  assert.equal(its[1].side, undefined); // 図も表も無いものは外す
});

test('MATH_QUIZ_TOOL：$ref を使わない', () => {
  assert.equal(JSON.stringify(MATH_QUIZ_TOOL.input_schema).includes('$ref'), false);
});
