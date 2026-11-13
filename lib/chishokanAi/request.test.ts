// 智翔館AI への要望（request.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRequest, extractUrls, formatRequest, REQUEST_KINDS } from './request.ts';

test('checkRequest：種類と内容が無ければ理由を返す', () => {
  assert.equal(checkRequest({ detail: '保護者会の資料を作りたい' }).ok, false);
  assert.equal(checkRequest({ kind: '知らない種類', detail: '保護者会の資料を作りたい' }).ok, false);
  assert.equal(checkRequest({ kind: REQUEST_KINDS[0], detail: 'ある' }).ok, false);
});

test('checkRequest・formatRequest：リンクを取り出し、シートに入れる文にする', () => {
  const r = checkRequest({
    kind: REQUEST_KINDS[3],
    detail: '校舎ごとの年間行事表を読めるようにしてほしい',
    scene: '行事の日程を聞いたとき',
    links: 'https://drive.google.com/drive/folders/abc123\nhttps://drive.google.com/drive/folders/abc123（同じ）\nメモ https://docs.google.com/spreadsheets/d/xyz/edit',
    context: { conversationId: '20261113-1648-nsk0', turn: 2, task: '数学の教材を作る' },
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.input.links, ['https://drive.google.com/drive/folders/abc123', 'https://docs.google.com/spreadsheets/d/xyz/edit']);
  const text = formatRequest(r.input);
  assert.match(text, /^【智翔館AIへの要望】ドライブのリンクで読めるようにしてほしいフォルダ・ファイル/);
  assert.match(text, /■ 使う場面・例\n行事の日程を聞いたとき/);
  assert.match(text, /- https:\/\/docs\.google\.com\/spreadsheets\/d\/xyz\/edit/);
  assert.match(text, /会話の番号：20261113-1648-nsk0（2回目のやり取りのあと）/);
});

test('extractUrls：日本語の括弧や句読点の手前で切る', () => {
  assert.deepEqual(extractUrls('こちら（https://example.com/a）。'), ['https://example.com/a']);
});
