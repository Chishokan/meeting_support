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

// --- 図のある角の問題（2026-11-16 の小テストで、図に角の印が無く求める角が分からなかった） ---
import { checkAngleFigure } from './mathQuizTool.ts';

const PARALLEL = {
  range: [0, 0, 10, 8],
  points: { P: [0, 6], Q: [10, 6], R: [0, 2], S: [10, 2], A: [3, 6], B: [7, 2], T: [1, 8], U: [9, 0] },
};

test('checkAngleFigure：角の印が無い・名前を出した角に印が無い・分かっている角が無い', () => {
  // 実際にできた図（角の印が無く、a を文字で置いただけ）
  const bad = { ...PARALLEL, shapes: [{ line: ['P', 'Q'] }, { line: ['R', 'S'] }, { line: ['T', 'U'] }, { text: [5, 7], label: 'a' }] };
  assert.match(checkAngleFigure('右の図で、$\\ell \\parallel m$ のとき、$\\angle a$ の同位角の大きさを求めよ。', bad) ?? '', /角の印がありません/);
  // ∠x と書いたのに、印の label が a
  const wrong = { ...PARALLEL, shapes: [{ line: ['P', 'Q'] }, { angle: ['Q', 'A', 'T'], label: '70°' }, { angle: ['S', 'B', 'A'], label: 'a' }] };
  assert.match(checkAngleFigure('右の図で、∠x の大きさを求めよ。', wrong) ?? '', /∠x が、図のどの角か/);
  // 分かっている角が無い
  const noValue = { ...PARALLEL, shapes: [{ angle: ['Q', 'A', 'T'], label: 'a' }, { angle: ['S', 'B', 'A'], label: 'x' }] };
  assert.match(checkAngleFigure('右の図で、∠x の大きさを求めよ。', noValue) ?? '', /分かっている角の大きさ/);
  // よい図：70° と x に印
  const good = { ...PARALLEL, shapes: [{ line: ['P', 'Q'], label: 'ℓ' }, { angle: ['Q', 'A', 'T'], label: '70°' }, { angle: ['S', 'B', 'A'], label: 'x' }] };
  assert.equal(checkAngleFigure('右の図で、$\\ell \\parallel m$ のとき、$\\angle x$ の大きさを求めよ。', good), null);
  // 問題文に角の大きさがあればよい・和を求める問題・角の問題でないもの
  assert.equal(checkAngleFigure('右の図で、∠ABC＝$40^\\circ$ のとき、∠x を求めよ。', { shapes: [{ angle: ['A', 'B', 'C'], label: 'x' }] }), null);
  assert.equal(checkAngleFigure('右の図の、印を付けた5つの角の和を求めよ。', { shapes: [{ angle: ['A', 'B', 'C'] }] }), null);
  assert.equal(checkAngleFigure('右の図の三角形の面積を求めよ。', { shapes: [] }), null);
  assert.equal(checkAngleFigure('右の図の六角形の内角の和を求めよ。', { shapes: [] }), null);
  assert.match(checkAngleFigure('右の図で、印をつけた角の大きさを求めよ。', { shapes: [] }) ?? '', /角の印がありません/);
});

test('checkMathQuizInput：角の問題の図に印が無ければ、直してもらう', () => {
  const r = checkMathQuizInput({
    title: '中2 角', sheets: [{ sections: [{ items: [item('$-3+8$'), { text: '右の図で、∠x の大きさを求めよ。', answer: '70°', side: { figure: { range: [0, 0, 1, 1], shapes: [] } } }] }] }],
  });
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /1枚目の\(2\)：図に角の印がありません/);
});
