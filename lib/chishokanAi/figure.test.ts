// 智翔館AI の数学の図（figure.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipLine, compileExpr, escapeXml, extractFigures, parseFigure, renderFigureSvg } from './figure.ts';

test('compileExpr：式を計算する（掛け算の省略・累乗・根号・全角）', () => {
  assert.equal(compileExpr('x^2/4')(2), 1);
  assert.equal(compileExpr('y = 2x + 3')(1), 5);
  assert.equal(compileExpr('-x^2')(3), -9);
  assert.equal(compileExpr('2(x-1)(x+1)')(3), 16);
  assert.equal(compileExpr('sqrt(x)+abs(-2)')(9), 5);
  assert.equal(compileExpr('x²−1')(3), 8);
  assert.equal(compileExpr('1/2x')(4), 2);
  assert.throws(() => compileExpr('alert(1)'));
  assert.throws(() => compileExpr('x+'));
  assert.throws(() => compileExpr('(x+1'));
});

test('parseFigure：形の違う記述を断り、理由を返す', () => {
  assert.equal(parseFigure('{').ok, false);
  assert.match((parseFigure({ range: [0, 0, 0, 1] }) as { error: string }).error, /最大は最小より大きく/);
  assert.match((parseFigure({ range: [0, 0, 1, 1], points: { A: [0] } }) as { error: string }).error, /点 A の座標/);
  assert.match((parseFigure({ range: [0, 0, 1, 1], shapes: [{ polygon: ['A', 'B'] }] }) as { error: string }).error, /polygon/);
  assert.match((parseFigure({ range: [0, 0, 1, 1], shapes: [{ curve: 'x+' }] }) as { error: string }).error, /curve/);
  assert.match((parseFigure({ range: [0, 0, 1, 1], shapes: [{ star: 1 }] }) as { error: string }).error, /種類が分かりません/);
  const ok = parseFigure(JSON.stringify({ range: [0, 0, 10, 10], size: 99, points: { A: [0, 10] }, dots: ['A', 'Z'], labels: { A: 'nw', B: 'x' } }));
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.spec.size, 16);
  assert.deepEqual(ok.spec.dots, ['A']);
  assert.deepEqual({ ...ok.spec.labels }, { A: 'nw' }); // labels は親の無い入れ物（Object.create(null)）
});

test('renderFigureSvg：正方形と塗った四角形、点の名前、長さ、角・直角・等しい印、関数と直線', () => {
  const r = parseFigure({
    caption: '図1',
    range: [0, 0, 10, 10],
    points: { A: [0, 10], B: [0, 0], C: [10, 0], D: [10, 10], P: [0, 6], Q: [4, 0] },
    dots: ['P', 'Q'],
    shapes: [
      { polygon: ['A', 'B', 'C', 'D'] },
      { polygon: ['A', 'P', 'Q', 'D'], fill: true },
      { segment: ['P', 'Q'], dash: true },
      { length: ['B', 'C'], label: '10cm' },
      { angle: ['A', 'D', 'Q'], label: '40°' },
      { right: ['A', 'B', 'C'] },
      { equal: [['A', 'P'], ['B', 'Q']], marks: 2 },
      { text: [5, 5], label: '<S&>' },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  const { svg, width, height } = renderFigureSvg(r.spec);
  assert.equal(width, height); // 正方形の範囲は正方形の画像
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, />A<\/text>/);
  assert.match(svg, />10cm<\/text>/);
  assert.match(svg, />40°<\/text>/);
  assert.match(svg, /fill="#d6d6d6"/);
  assert.match(svg, /stroke-dasharray="6 4"/);
  assert.match(svg, /&lt;S&amp;&gt;/); // 文字はエスケープする
  assert.doesNotMatch(svg, /<S&>/);
  assert.equal((svg.match(/r="3"/g) ?? []).length, 2); // P と Q の黒い点

  const g = parseFigure({ range: [-5, -2, 5, 8], axes: true, grid: true, shapes: [{ curve: 'x^2/2' }, { line: [[0, 1], [1, 2]] }, { circle: [0, 0], r: 2 }, { arc: [0, 0], r: 3, from: 0, to: 90, fill: true }] });
  assert.ok(g.ok);
  if (!g.ok) return;
  const svg2 = renderFigureSvg(g.spec).svg;
  assert.match(svg2, />x<\/text>/);
  assert.match(svg2, />y<\/text>/);
  assert.match(svg2, />O<\/text>/);
  assert.match(svg2, /<path d="M[\d.]+,[\d.]+ L/); // 関数のグラフ
  assert.match(svg2, /<circle cx="[\d.]+" cy="[\d.]+" r="[\d.]+" fill="none"/);
});

test('clipLine：直線を表示の範囲で切る', () => {
  assert.deepEqual(clipLine([0, 0], [1, 1], [-2, -2, 2, 2]), [[-2, -2], [2, 2]]);
  assert.deepEqual(clipLine([0, 5], [1, 5], [-2, -2, 2, 2]), null);
  assert.deepEqual(clipLine([1, 0], [1, 1], [-2, -2, 2, 2]), [[1, -2], [1, 2]]);
});

test('extractFigures：```図 枠を [図:n] に置きかえ、読めない図は理由の行にする', () => {
  const md = '## 第1問\n```図\n{"range":[0,0,4,4],"points":{"A":[0,0]}}\n```\n本文\n```figure\n{"range":[0,0]}\n```\n```text\n{"range":[0,0,1,1]}\n```';
  const r = extractFigures(md);
  assert.equal(r.figures.length, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.markdown, /## 第1問\n\[図:1\]\n本文\n〔図を描けませんでした：range は/);
  assert.match(r.markdown, /```text\n/); // 図でない枠はそのまま
  assert.equal(escapeXml('"a"'), '&quot;a&quot;');
});

test('parseFigure・renderFigureSvg：点の名前が Object の持ち物の名前でも落ちない／広すぎる方眼は描かない', () => {
  // 定義していない「constructor」は点として認めない
  assert.equal(parseFigure('{"range":[0,0,5,5],"shapes":[{"polygon":["constructor","A","B"]}],"points":{"A":[1,1],"B":[2,1]}}').ok, false);
  // 定義した「toString」は、ふつうの点として描ける
  const p = parseFigure('{"range":[0,0,5,5],"points":{"toString":[1,1],"B":[3,1],"C":[2,3]},"shapes":[{"polygon":["toString","B","C"]}],"labels":{"toString":"s"}}');
  assert.ok(p.ok);
  if (p.ok) assert.match(renderFigureSvg(p.spec).svg, /<polygon|<path/);
  const huge = parseFigure('{"range":[0,0,200000,200000],"grid":true}');
  assert.ok(huge.ok);
  if (huge.ok) assert.ok(renderFigureSvg(huge.spec).svg.length < 20_000);
});
