// 数学の教材の文（mathText.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMathText, piecesToPlain, wideNum } from './mathText.ts';

test('parseMathText：$ の外はそのまま、中の小文字は太字の斜体、＋－＝は全角', () => {
  assert.deepEqual(parseMathText('$x=-3$ のとき'), [
    { t: 'text', v: 'x', italic: true, bold: true },
    { t: 'text', v: '＝－3 のとき' }, // 同じ書式の文字はまとめる
  ]);
  // 点の名前（大文字）は立体
  assert.deepEqual(parseMathText('$\\triangle ABC$'), [{ t: 'text', v: '△ABC' }]);
});

test('parseMathText：分数・根号・累乗', () => {
  const p = parseMathText('$\\sqrt{18}\\times\\frac{2}{\\sqrt{6}}$');
  assert.equal(p[0].t, 'sqrt');
  assert.deepEqual(p[1], { t: 'text', v: '×' });
  assert.equal(p[2].t, 'frac');
  if (p[2].t === 'frac') assert.equal(p[2].den[0].t, 'sqrt');
  assert.deepEqual(parseMathText('$x^2$'), [
    { t: 'text', v: 'x', italic: true, bold: true },
    { t: 'text', v: '2', sup: true, sub: false },
  ]);
  assert.equal(piecesToPlain(parseMathText('$\\frac{1}{4}x^{2}$')), '1/4x2');
  // √ の後ろの数字・文字
  assert.equal(parseMathText('$5√3$')[1].t, 'sqrt');
  // 角度の ^\circ は °
  assert.equal(piecesToPlain(parseMathText('$60^\\circ$')), '60°');
});

test('parseMathText：閉じていない $ はふつうの文字、\\$ は $', () => {
  assert.deepEqual(parseMathText('1$ の本'), [{ t: 'text', v: '1$ の本' }]);
  assert.deepEqual(parseMathText('\\$5'), [{ t: 'text', v: '$5' }]);
});

test('wideNum：9までは全角、10からは半角', () => {
  assert.equal(wideNum(1), '１');
  assert.equal(wideNum(9), '９');
  assert.equal(wideNum(10), '10');
});
