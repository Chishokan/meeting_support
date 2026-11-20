// 事前共有に意見を足す・直す（preshareEdit.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agendaTargets, checkFields, checkOpinion, editableMessage, insertOpinion, opinionLine, sameVersion, stampJst } from './preshareEdit.ts';

const AGENDA = `1. 9月の実績
2. 冬期講習の外部生募集
　└【意見】駅前校は12/1から開始したい〔太田 11/18〕
3. その他`;

test('意見を付けられる議題の行：空行と意見の行は除く', () => {
  assert.deepEqual(agendaTargets(`${AGENDA}\n\n・【意見】全体の時間を短く〔森 11/18〕\n---`), ['1. 9月の実績', '2. 冬期講習の外部生募集', '3. その他']);
});

test('選んだ議題のすぐ下（もう付いている意見のあと）に足す', () => {
  const out = insertOpinion(AGENDA, '2. 冬期講習の外部生募集', '日野校も同じ日から\nチラシは共通で', '安藤', '11/19');
  assert.deepEqual(out.split('\n'), [
    '1. 9月の実績',
    '2. 冬期講習の外部生募集',
    '　└【意見】駅前校は12/1から開始したい〔太田 11/18〕',
    '　└【意見】日野校も同じ日から ／ チラシは共通で〔安藤 11/19〕',
    '3. その他',
  ]);
  const first = insertOpinion(AGENDA, '1. 9月の実績', '前年比も出す', '安藤', '11/19');
  assert.equal(first.split('\n')[1], '　└【意見】前年比も出す〔安藤 11/19〕');
});

test('議題を選ばなければ末尾に、選んだ議題が無くなっていれば「〇〇について」を添えて末尾に', () => {
  const all = insertOpinion(AGENDA, '', '全体で45分に収めたい', '安藤', '11/19');
  assert.equal(all.split('\n').at(-1), '・【意見】全体で45分に収めたい〔安藤 11/19〕');
  const gone = insertOpinion(AGENDA, '4. 消された議題', '資料を先に配る', '安藤', '11/19');
  assert.equal(gone.split('\n').at(-1), '・【意見】（「4. 消された議題」について）資料を先に配る〔安藤 11/19〕');
  assert.equal(insertOpinion('', '', 'はじめの意見', '安藤', '11/19'), '・【意見】はじめの意見〔安藤 11/19〕');
  assert.equal(opinionLine('a', '森', '1/2', true), '　└【意見】a〔森 1/2〕');
});

test('意見の入力：短すぎ・長すぎは断る', () => {
  assert.equal(checkOpinion({ text: ' ' }).ok, false);
  assert.equal(checkOpinion({ text: 'あ'.repeat(301) }).ok, false);
  const ok = checkOpinion({ text: ' 賛成です ', target: ' 1. 9月の実績 ' });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { target: '1. 9月の実績', text: '賛成です' });
});

test('修正の入力：会議名・開催日時・議題は必須。議題の改行は残し、ほかの欄の空白はそろえる', () => {
  const ng = checkFields({ title: '小中等部会議', date: '', agenda: '' });
  assert.equal(ng.ok, false);
  if (!ng.ok) assert.match(ng.message, /開催日時・議題・レジュメ/);
  const ok = checkFields({ title: ' 小中等部会議 ', date: '2026/11/24  18:00', place: '本部', attendees: '', agenda: '1. 実績\n2. 冬期\n\n' });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { title: '小中等部会議', date: '2026/11/24 18:00', place: '本部', attendees: '', agenda: '1. 実績\n2. 冬期' });
  assert.equal(checkFields({ title: 'a', date: 'b', agenda: 'x'.repeat(6001) }).ok, false);
});

test('ほかの人が直したか：空白の違いは同じとみなす', () => {
  const a = { title: '会議', date: '11/24', place: '', attendees: '', agenda: '1. 実績\n2. 冬期' };
  assert.equal(sameVersion(a, { ...a, agenda: '1. 実績\n2. 冬期\n' }), true);
  assert.equal(sameVersion(a, { ...a, agenda: '1. 実績\n2. 冬期\n　└【意見】追加〔森 11/19〕' }), false);
  assert.equal(sameVersion(a, { ...a, date: '11/25' }), false);
});

test('議事録を保存した会議・見つからない会議は直せない', () => {
  assert.match(editableMessage({ minutesId: 'm-1' }), /議事録が保存されている/);
  assert.match(editableMessage(null), /見つかりません/);
  assert.equal(editableMessage({ minutesId: '' }), '');
});

test('日付は日本時間の M/d', () => {
  assert.equal(stampJst(new Date('2026-11-19T15:30:00Z')), '11/20');
  assert.equal(stampJst(new Date('2026-11-19T01:00:00Z')), '11/19');
});
