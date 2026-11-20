// 重要タスク評価のダウンロード（taskEval.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentDisposition, findEvalFile, parseEvalFiles } from './taskEval.ts';

const SHEET = 'Googleスプレッドシート';
const ITEMS = [
  { id: 'sheet1102aaaaaa', name: '20261102_中等部重要タスクAI評価_評価シート_1024-1030', kind: SHEET },
  { id: 'sheet1109aaaaaa', name: '20261109_中等部重要タスクAI評価_評価シート_1102-1107', kind: SHEET },
  { id: 'sheet1116aaaaaa', name: '20261116_中等部重要タスクAI評価_評価シート_1109-1114', kind: SHEET },
  { id: 'pdf1116aaaaaaaa', name: '20261116_中等部重要タスクAI評価_A4版_1109-1114.pdf', kind: 'PDF' },
  { id: 'pdf1102aaaaaaaa', name: '20261102_中等部重要タスクAI評価_A4版_1024-1030.pdf', kind: 'PDF' },
  { id: 'folderaaaaaaaaa', name: '20261116_中等部重要タスクAI評価_評価シート_1109-1114', kind: 'フォルダ', folder: true },
  { id: 'otheraaaaaaaaaa', name: '中等部議事録', kind: SHEET },
  { id: 'wrongextaaaaaaa', name: '20261116_中等部重要タスクAI評価_評価シート_1109-1114.pdf', kind: 'PDF' },
];

test('parseEvalFiles: 週ごとに評価シートと A4版をまとめ、新しい週から並べる', () => {
  const weeks = parseEvalFiles(ITEMS);
  assert.deepEqual(weeks.map((w) => [w.week, w.label, w.created, w.sheet?.id, w.pdf?.id]), [
    ['1109-1114', '11/9〜11/14', '2026-11-16', 'sheet1116aaaaaa', 'pdf1116aaaaaaaa'],
    ['1102-1107', '11/2〜11/7', '2026-11-09', 'sheet1109aaaaaa', undefined],
    ['1024-1030', '10/24〜10/30', '2026-11-02', 'sheet1102aaaaaa', 'pdf1102aaaaaaaa'],
  ]);
});

test('parseEvalFiles: 同じ週が2つあるときは作った日が新しいほうを使う', () => {
  const weeks = parseEvalFiles([
    { id: 'oldsheetaaaaaa', name: '20261116_中等部重要タスクAI評価_評価シート_1109-1114', kind: SHEET },
    { id: 'newsheetaaaaaa', name: '20261117_中等部重要タスクAI評価_評価シート_1109-1114', kind: SHEET },
  ]);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].sheet?.id, 'newsheetaaaaaa');
  assert.equal(weeks[0].created, '2026-11-17');

  // 種類ごとに比べる（評価シートが新しくても、古い A4版で新しい A4版を上書きしない）
  const mixed = parseEvalFiles([
    { id: 'pdf1116aaaaaaaa', name: '20261116_中等部重要タスクAI評価_A4版_1109-1114.pdf', kind: 'PDF' },
    { id: 'sheet1118aaaaaa', name: '20261118_中等部重要タスクAI評価_評価シート_1109-1114', kind: SHEET },
    { id: 'pdf1117aaaaaaaa', name: '20261117_中等部重要タスクAI評価_A4版_1109-1114.pdf', kind: 'PDF' },
    { id: 'pdf1115aaaaaaaa', name: '20261115_中等部重要タスクAI評価_A4版_1109-1114.pdf', kind: 'PDF' },
  ]);
  assert.equal(mixed[0].pdf?.id, 'pdf1117aaaaaaaa');
  assert.equal(mixed[0].sheet?.id, 'sheet1118aaaaaa');
  assert.equal(mixed[0].created, '2026-11-18');
});

test('findEvalFile: 一覧にあるファイルを、種類に合う形でだけ返す', () => {
  const weeks = parseEvalFiles(ITEMS);
  assert.deepEqual(findEvalFile(weeks, 'sheet1116aaaaaa', 'xlsx'), {
    file: { id: 'sheet1116aaaaaa', name: '20261116_中等部重要タスクAI評価_評価シート_1109-1114' },
    format: 'xlsx', filename: '20261116_中等部重要タスクAI評価_評価シート_1109-1114.xlsx',
  });
  assert.equal(findEvalFile(weeks, 'pdf1116aaaaaaaa', 'pdf')?.filename, '20261116_中等部重要タスクAI評価_A4版_1109-1114.pdf');
  assert.equal(findEvalFile(weeks, 'sheet1116aaaaaa', 'pdf'), null); // 評価シートを PDF では出さない
  assert.equal(findEvalFile(weeks, 'otheraaaaaaaaaa', 'xlsx'), null); // 一覧に無いファイル
  assert.equal(findEvalFile(weeks, '../x', 'pdf'), null);
});

test('contentDisposition: 日本語のファイル名を filename* で渡す', () => {
  const v = contentDisposition('20261116_評価.pdf');
  assert.match(v, /^attachment; filename="20261116___\.pdf"; filename\*=UTF-8''20261116_%E8%A9%95%E4%BE%A1\.pdf$/);
});
