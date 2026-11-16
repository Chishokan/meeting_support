// 中学の数学の教材で、高校で習う書き方・方法を見つける（mathScope.ts）のテスト。  npm test
// 2026-11-16 の問い合わせ：中3の模試の解説に、点と傾きの式と絶対値の記号が出た。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materialScopeMessage, outOfScope, quizScopeMessage, schoolLevel, scopeMessage } from './mathScope.ts';

test('outOfScope：会話ログに出た書き方を見つける', () => {
  // 2026-11-16 の解説（智翔館AI の回答から）
  assert.deepEqual(outOfScope('Aを通り傾き3/2の直線：$y-4=\\frac32(x+4)\\Rightarrow y=\\frac32x+10$'), ['点と傾きの式（y－b＝a(x－c) の形）']);
  assert.deepEqual(outOfScope('PR＝$|10-t|$（PRはy軸上の線分）'), ['絶対値の記号（| |）']);
  assert.deepEqual(outOfScope('面積＝$\\frac12\\times\\left|\\frac23(t-10)\\right|$'), ['絶対値の記号（| |）']);
  // 全角の記号でも見つける
  assert.deepEqual(outOfScope('点Bを通るので y－9＝－(x－6)'), ['点と傾きの式（y－b＝a(x－c) の形）']);
  assert.deepEqual(outOfScope('$y - y_1 = m(x - x_1)$'), ['点と傾きの式（y－b＝a(x－c) の形）']);
});

test('outOfScope：中学の方法・言葉は通す', () => {
  const ok = [
    '直線ABの傾きは $\\frac{9-4}{6-(-4)}=\\frac{1}{2}$。$y=\\frac12x+b$ に A(－4,4) を代入すると、$4=\\frac12\\times(-4)+b$ より $b=6$',
    '平行な直線は傾きが等しいので、傾きは－1。$y=-x+b$ に B(6,9) を代入して $b=15$',
    '$2(x+1)-y=3$、$x+y=44$ を連立方程式として解く',
    'PR＝15－t（t＜15 だから）。Qはy軸の左側にあるので、高さは $\\frac{4}{11}(15-t)$',
    '中1：－3 の絶対値は 3',
    '$y=\\frac14x^2$ に $x=-4$ を代入',
  ];
  for (const s of ok) assert.deepEqual(outOfScope(s), [], s);
});

test('outOfScope：ほかの高校の書き方・方法', () => {
  assert.deepEqual(outOfScope('$f(x)=x^2$ とおく'), ['関数の記号 f(x)']);
  assert.deepEqual(outOfScope('$\\sin 30^\\circ=\\frac12$'), ['三角比（sin・cos・tan）']);
  assert.deepEqual(outOfScope('判別式 D＞0 より'), ['判別式']);
  assert.deepEqual(outOfScope('2直線は垂直なので傾きの積が－1'), ['2直線の垂直の条件（傾きの積が－1）']);
  assert.deepEqual(outOfScope('方べきの定理より PA×PB＝PC×PD'), ['方べきの定理・接弦定理・メネラウス・チェバの定理']);
});

test('schoolLevel：指定が無ければ題名から決める（公立高校入試は中学校）', () => {
  assert.equal(schoolLevel(undefined, '中3 数学 模試 解答解説（大問１〜５）'), '中学校');
  assert.equal(schoolLevel(undefined, '公立高校入試対策 関数'), '中学校');
  assert.equal(schoolLevel(undefined, '高1 数学Ⅰ 二次関数'), '高校');
  assert.equal(schoolLevel('高校', '中3 関数'), '高校');
  assert.equal(schoolLevel('大学', '中3 関数'), '中学校');
});

test('scopeMessage：場所と書き直し方を返す。高校なら確かめない', () => {
  const parts = [
    { where: '大問3の解説', text: '$y-4=\\frac32(x+4)$、PR＝$|10-t|$' },
    { where: '大問1の答え', text: '－6' },
  ];
  const m = scopeMessage('中学校', parts) ?? '';
  assert.match(m, /大問3の解説：絶対値の記号（\| \|）・点と傾きの式/);
  assert.match(m, /y＝ax＋b に通る点の座標を代入/);
  assert.doesNotMatch(m, /大問1/);
  assert.equal(scopeMessage('高校', parts), null);
  assert.equal(scopeMessage('中学校', [{ where: '大問1の答え', text: '－6' }]), null);
});

test('materialScopeMessage・quizScopeMessage：教材と小テストの文を見る', () => {
  const material = {
    title: '中3 数学 模試',
    booklet: false,
    cover: { name: '中3 数学 模試', minutes: 50 },
    problems: [{ intro: '', numbering: 'toi' as const, side: [], items: [{ text: '直線APの式を求めよ。', sub: [] }] }],
    answers: [['$y=\\frac{11}{4}x+15$']],
    explanations: ['$y-15=\\frac{11}{4}(x-0)$'],
  };
  assert.match(materialScopeMessage(material) ?? '', /大問1の解説：点と傾きの式/);
  assert.equal(materialScopeMessage({ ...material, explanations: ['$y=\\frac{11}{4}x+b$ に P(0,15) を代入して b＝15'] }), null);
  assert.equal(materialScopeMessage({ ...material, level: '高校' }), null);

  const quiz = {
    title: '中1 正負の数 小テスト',
    series: 'ベーシック',
    startNo: 1,
    sheets: [{ sections: [{ heading: '', items: [{ text: '$|-3|$ を求めよ。', sub: [], frequent: false, answer: '3' }] }] }],
  };
  assert.match(quizScopeMessage(quiz) ?? '', /1枚目の\(1\)：絶対値の記号/);
});
