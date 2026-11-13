// 智翔館AI の不具合報告（report.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReport, formatReport, REPORT_KINDS } from './report.ts';

test('checkReport：種類と詳しい状況が無ければ断る', () => {
  assert.equal(checkReport({}).ok, false);
  assert.equal(checkReport({ kind: '知らない種類', detail: '詳しく書きました' }).ok, false);
  const r = checkReport({ kind: REPORT_KINDS[0], detail: '短' });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && /詳しい状況/.test(r.message));
});

test('checkReport：長すぎるもの・形の違うものを整える', () => {
  const r = checkReport({
    kind: REPORT_KINDS[1],
    detail: 'あ'.repeat(5000),
    includeText: 'yes',
    context: { turn: 2.7, sources: ['a.md', 3, 'b.md'], question: 'い'.repeat(1000) },
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.input.detail.length < 3100);
  assert.equal(r.input.includeText, false); // true のときだけ
  assert.equal(r.input.context?.turn, 2);
  assert.deepEqual(r.input.context?.sources, ['a.md', 'b.md']);
  assert.match(r.input.context?.question ?? '', /以下略/);
});

test('formatReport：職員の入力と画面が添えた情報。質問と回答は「添える」ときだけ', () => {
  const base = {
    kind: REPORT_KINDS[0],
    detail: '冬期講習の日程が要項と違った',
    expected: '要項どおりの日程',
    context: {
      conversationId: 'ab12cd',
      turn: 3,
      task: 'flyer',
      flags: ['途中で切れた'],
      sources: ['40_要項/2026/2026-12_冬期_中等部_中3.md'],
      notices: ['埋まっていない {{講座名}} が残っています'],
      question: '中3冬期のチラシを作って',
      answer: '## 原稿 …',
      screen: '1280x800',
      userAgent: 'Chrome',
    },
  };
  const text = formatReport({ ...base, includeText: false });
  assert.match(text, /^【智翔館AI】答えが間違っている・古い/);
  assert.match(text, /■ 詳しい状況\n冬期講習の日程が要項と違った/);
  assert.match(text, /■ どうなってほしかったか\n要項どおりの日程/);
  assert.match(text, /会話の番号：ab12cd（3回目のやり取り）/);
  assert.match(text, /選んだ作業：flyer/);
  assert.match(text, /状態：途中で切れた/);
  assert.match(text, /端末：1280x800／Chrome/);
  assert.doesNotMatch(text, /中3冬期のチラシを作って/);
  assert.match(formatReport({ ...base, includeText: true }), /（質問）中3冬期のチラシを作って\n（回答）## 原稿/);
});
