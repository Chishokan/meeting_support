// AI壁打ちの評価シートの読み取り・行動計画の案のチェック（taskCoach.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanHistory, cleanPlan, evaluationText, extractJson, isValidItem, itemOptions, parseEvaluation, planDates,
  MAX_ACTION_LENGTH, MAX_TURNS,
} from './taskCoach.ts';

// 評価シートの校舎タブ（A1:G32 の表示値）と同じ並び
const ROWS: string[][] = [
  ['駅前校　重要タスク評価（10/24〜30の1週間）'],
  ['報告者', '太田', '評価期間', '2026年10月24日〜30日（1週間）'],
  ['合計点（100点）', '29'],
  ['基準は10/31のマイルストーン。'],
  [],
  ['進捗（10点）'],
  ['指標', '母数', '基準', '実績', '達成率', '数字の出所'],
  ['① テ対外部（中1・中2）の申込（人）', '8', '7', '1', '14%', '営業サマリー'],
  ['② おは勉・夜のOLに参加した内部生（人・この週）', '78', '55', '30', '55%', '通常期集計'],
  ['③ 定期テスト対策の進行表（中1・中2の平均）', '41', '80%', '85%', '100%', '教室担当の報告'],
  ['進捗点（3指標の達成率の平均×配点、切り捨て）', '', '', '', '5'],
  [],
  ['行動（90点）'],
  ['指標', '段階', '点', '段階の名前', '主な出所', '判定の根拠', '行動のアドバイス'],
  ['① テ対外部の集客（中1・中2）', '1', '3', '動いているが精度が低い', '行動計画', '名前挙げの結果が無い', '出た名前の数を書く'],
  ['② おは勉・夜のOLへの参加', '2', '6', '動いているが自分ができる範囲のみ', '集計', '参加予定表', '照らし合わせる'],
  ['行動点（段階×1段階あたりの点の合計）', '', '9'],
  [],
  ['良い動き'],
  ['・進行表を85%まで上げた'],
  ['課題'],
  ['・10/30の○✕が空欄'],
];

test('parseEvaluation: 見出しの文字で、進捗・行動・良い動き・課題を読む', () => {
  const ev = parseEvaluation(ROWS);
  assert.ok(ev);
  assert.equal(ev.reporter, '太田');
  assert.equal(ev.period, '2026年10月24日〜30日（1週間）');
  assert.equal(ev.total, '29');
  assert.equal(ev.progressPoint, '5');
  assert.equal(ev.actionPoint, '9');
  assert.equal(ev.progress.length, 3);
  assert.equal(ev.progress[2].rate, '100%');
  assert.deepEqual(ev.actions.map((a) => [a.level, a.levelName]), [[1, '動いているが精度が低い'], [2, '動いているが自分ができる範囲のみ']]);
  assert.deepEqual(ev.good, ['進行表を85%まで上げた']);
  assert.deepEqual(ev.issues, ['10/30の○✕が空欄']);
});

test('parseEvaluation: 行動の行が無いタブは null', () => {
  assert.equal(parseEvaluation([['一覧'], ['校舎', '報告者']]), null);
});

test('itemOptions / isValidItem / evaluationText: 選んだ項目を先頭に詳しく出す', () => {
  const ev = parseEvaluation(ROWS)!;
  assert.deepEqual(itemOptions(ev).map((o) => o.key), ['all', '0', '1']);
  assert.equal(isValidItem(ev, '1'), true);
  assert.equal(isValidItem(ev, '2'), false);
  assert.equal(isValidItem(ev, 'x'), false);
  const text = evaluationText(ev, '1');
  assert.ok(text.indexOf('◆相談したい項目\n② おは勉') > 0);
  assert.ok(text.indexOf('◆ほかの項目\n① テ対外部') > text.indexOf('◆相談したい項目'));
  assert.ok(evaluationText(ev, 'all').includes('◆行動の段階'));
});

test('planDates: 今日から2週間・日曜を除く・日本時間', () => {
  const d = planDates(new Date('2026-11-02T00:30:00+09:00')); // 月曜
  assert.equal(d[0].value, '11/2');
  assert.equal(d[0].label, '11/2（月）');
  assert.equal(d.length, 12);
  assert.ok(!d.some((x) => x.label.includes('（日）')));
  assert.equal(planDates(new Date('2026-11-01T15:30:00Z'))[0].value, '11/2'); // UTC では 11/1
});

const DATES = ['11/2', '11/3', '11/4'];

test('cleanPlan: 区分・日付・長さを整え、書けない日付は空にする', () => {
  const r = cleanPlan({
    goal: ' テ対 8名 ', summary: 'まとめ',
    actions: [
      { date: '11/04', kind: '外部', text: '★DM生に電話する' },
      { date: '12/1', kind: '内部', text: '名前挙げの数を書く' },
      { date: '11/2', kind: '???', text: 'あ'.repeat(MAX_ACTION_LENGTH + 10) },
      { date: '11/3', kind: '他', text: '   ' },
    ],
  }, DATES, false);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plan.goal, 'テ対 8名');
  assert.deepEqual(r.plan.actions.map((a) => [a.date, a.kind]), [['11/4', '外部'], ['', '内部'], ['11/2', '他']]);
  assert.equal(r.plan.actions[0].text, 'DM生に電話する');
  assert.equal(r.plan.actions[2].text.length, MAX_ACTION_LENGTH);
});

test('cleanPlan: 書き込むときは日付が全部そろっていないと通さない', () => {
  assert.deepEqual(cleanPlan({ actions: [{ date: '', kind: '外部', text: 'a' }] }, DATES, true), { ok: false, reason: 'bad_date' });
  assert.deepEqual(cleanPlan({ actions: [] }, DATES, false), { ok: false, reason: 'no_actions' });
  assert.deepEqual(cleanPlan(null, DATES, false), { ok: false, reason: 'bad_plan' });
});

test('extractJson: 前後の文章や ``` があっても読む', () => {
  assert.deepEqual(extractJson('案です。\n```json\n{"goal":"a","actions":[]}\n```'), { goal: 'a', actions: [] });
  assert.equal(extractJson('JSON ではない'), null);
  assert.equal(extractJson('{壊れた'), null);
});

test('cleanHistory: 空・不明な役割を落とし、同じ役割は1つにまとめ、user から始める', () => {
  const h = cleanHistory([
    { role: 'assistant', content: '先に来た' },
    { role: 'user', content: 'a' }, { role: 'user', content: 'b' },
    { role: 'system', content: 'x' }, { role: 'assistant', content: '  ' }, { role: 'assistant', content: 'c' },
  ]);
  assert.deepEqual(h, [{ role: 'user', content: 'a\nb' }, { role: 'assistant', content: 'c' }]);
  const many = Array.from({ length: MAX_TURNS + 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));
  assert.equal(cleanHistory(many).length <= MAX_TURNS, true);
  assert.equal(cleanHistory(many)[0].role, 'user');
});
