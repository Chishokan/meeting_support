// 重要タスク評価のダウンロード（taskEval.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentDisposition, findEvalFile, parseEvalFiles } from './taskEval.ts';

const SHEET = 'Googleスプレッドシート';
const ITEMS = [
  { id: 'sheet1102aaaaaa', name: '20261102_中等部重要タスクAI評価_評価シート_1024-1030', kind: SHEET },
  { id: 'sheet1116aaaaaa', name: '20261116_中等部重要タスクAI評価_評価シート_1109-1114', kind: SHEET },
  { id: 'pdf1109aaaaaaaa', name: '20261109_中等部重要タスクAI評価_A4版_1102-1107.pdf', kind: 'PDF' },
  { id: 'pdf1116aaaaaaaa', name: '20261116_中等部重要タスクAI評価_A4版_1109-1114.pdf', kind: 'PDF' },
  { id: 'pdf1102aaaaaaaa', name: '20261102_中等部重要タスクAI評価_A4版_1024-1030.pdf', kind: 'PDF' },
  { id: 'folderaaaaaaaaa', name: '20261116_中等部重要タスクAI評価_A4版_1109-1114.pdf', kind: 'フォルダ', folder: true },
  { id: 'otheraaaaaaaaaa', name: '中等部議事録.pdf', kind: 'PDF' },
  { id: 'notpdfaaaaaaaaa', name: '20261116_中等部重要タスクAI評価_A4版_1109-1114.pdf', kind: 'Word' },
  { id: 'old4aaaaaaaaaaa', name: '20261116_中等部重要タスクAI評価_A4版_4校舎_1109-1114.pdf', kind: 'PDF' },
];

test('parseEvalFiles: A4版（PDF）だけを週ごとに取り出し、新しい週から並べる（評価シートは出さない）', () => {
  const weeks = parseEvalFiles(ITEMS);
  assert.deepEqual(weeks.map((w) => [w.week, w.label, w.created, w.pdf.id]), [
    ['1109-1114', '11/9〜11/14', '2026-11-16', 'pdf1116aaaaaaaa'],
    ['1102-1107', '11/2〜11/7', '2026-11-09', 'pdf1109aaaaaaaa'],
    ['1024-1030', '10/24〜10/30', '2026-11-02', 'pdf1102aaaaaaaa'],
  ]);
});

test('parseEvalFiles: 同じ週が2つあるときは作った日が新しいほうを使う', () => {
  const weeks = parseEvalFiles([
    { id: 'pdf1117aaaaaaaa', name: '20261117_中等部重要タスクAI評価_A4版_1109-1114.pdf', kind: 'PDF' },
    { id: 'pdf1116aaaaaaaa', name: '20261116_中等部重要タスクAI評価_A4版_1109-1114.pdf', kind: 'PDF' },
    { id: 'pdf1118aaaaaaaa', name: '20261118_中等部重要タスクAI評価_A4版_1109-1114.pdf', kind: 'PDF' },
  ]);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].pdf.id, 'pdf1118aaaaaaaa');
  assert.equal(weeks[0].created, '2026-11-18');
});

test('findEvalFile: 一覧にある A4版だけを返す', () => {
  const weeks = parseEvalFiles(ITEMS);
  assert.deepEqual(findEvalFile(weeks, 'pdf1116aaaaaaaa'), { id: 'pdf1116aaaaaaaa', name: '20261116_中等部重要タスクAI評価_A4版_1109-1114.pdf' });
  assert.equal(findEvalFile(weeks, 'sheet1116aaaaaa'), null); // 評価シートは渡さない
  assert.equal(findEvalFile(weeks, 'otheraaaaaaaaaa'), null); // 一覧に無いファイル
  assert.equal(findEvalFile(weeks, '../x'), null);
});

test('contentDisposition: 日本語のファイル名を filename* で渡す', () => {
  const v = contentDisposition('20261116_評価.pdf');
  assert.match(v, /^attachment; filename="20261116___\.pdf"; filename\*=UTF-8''20261116_%E8%A9%95%E4%BE%A1\.pdf$/);
});
