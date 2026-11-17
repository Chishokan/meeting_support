// 智翔館AI の数学の図（figure.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipLine, compileExpr, escapeXml, extractFigures, parseFigure, renderFigureSvg, textsWithoutGlyph } from './figure.ts';

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

test('textsWithoutGlyph：文書の画像に出ない日本語の文字を拾う', () => {
  const p = parseFigure('{"range":[0,0,5,5],"points":{"A":[0,0],"点P":[1,1]},"shapes":[{"text":[2,2],"label":"x軸"},{"length":["A","点P"],"label":"5cm"}]}');
  assert.ok(p.ok);
  if (p.ok) assert.deepEqual(textsWithoutGlyph(p.spec), ['点P', 'x軸']);
  const q = parseFigure('{"range":[0,0,5,5],"points":{"A":[0,0],"B":[1,1]},"shapes":[{"length":["A","B"],"label":"√2"}]}');
  if (q.ok) assert.deepEqual(textsWithoutGlyph(q.spec), []);
});

// --- 縦横の単位が違うグラフ・目盛り・Word の前の確かめ（2026-11-17：速さのグラフが細い棒になり、日本語の文字が□になった） ---
import { checkDocFigures, figureAspect } from './figure.ts';

test('figureAspect：グラフで縦横の比が極端なら x と y の縮尺を別にする（図形はそのまま）', () => {
  assert.deepEqual(figureAspect({ range: [0, -200, 32, 2200], axes: true }), { aspect: 0.9, stretched: true });
  assert.deepEqual(figureAspect({ range: [0, 0, 100, 5], axes: true }), { aspect: 0.6, stretched: true });
  assert.equal(figureAspect({ range: [-7, 0, 7, 13], axes: true }).stretched, false);
  assert.equal(figureAspect({ range: [0, 0, 2, 20] }).stretched, false);
});

test('速さのグラフ：細い棒にならず、目盛りの数が出る', () => {
  const p = parseFigure({
    range: [0, 0, 32, 2200], axes: true,
    points: { p1: [15, 1200], p3: [28, 2000] },
    ticks: { x: [15, 28, 0, 99, 'a'], y: [1200, 2000] },
    shapes: [{ segment: [[0, 0], 'p1'] }, { segment: ['p1', 'p3'] }],
  });
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.deepEqual(p.spec.ticks, { x: [15, 28], y: [1200, 2000] });
  const { svg, width, height } = renderFigureSvg(p.spec);
  assert.ok(width > 300 && height > 250 && height < width * 1.2, `${width}x${height}`);
  for (const t of ['>15<', '>28<', '>1200<', '>2000<']) assert.ok(svg.includes(t), t);
});

test('checkDocFigures：描けない図と、画像に出ない日本語の文字を返す', () => {
  const graph = { range: [0, 0, 32, 2200], axes: true, points: { p: [15, 1200] }, shapes: [{ segment: [[0, 0], 'p'], label: '太郎' }] };
  assert.match(checkDocFigures([{ where: '大問1の図1', figure: graph }]) ?? '', /大問1の図1：図の中の「太郎」は Word の画像では文字が出ない/);
  assert.match(checkDocFigures([{ where: '大問2の問10の図', figure: { shapes: [] } }]) ?? '', /大問2の問10の図：range は/);
  assert.equal(checkDocFigures([{ where: 'x', figure: { ...graph, shapes: [{ segment: [[0, 0], 'p'], label: 'A' }] } }]), null);
});
