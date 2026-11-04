// 智翔館AI のナレッジ用ツール（knowledgeTools.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { grepKnowledge, listAllowedFiles, listDir, readFile, runKnowledgeTool, safeRelPath } from './knowledgeTools.ts';

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-'));
  const put = (rel: string, body: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  };
  put('10_理念・方針/COMPANY.md', '---\ntitle: 前提\n---\n全社共通テーマ：報連想\n');
  put('40_要項/2026/確定.md', '---\ntitle: 冬期\nstatus: 確定\n---\n受講料 5,500円\n');
  put('40_要項/2026/下書き.md', '---\ntitle: 案\nstatus: 下書き   # コメント\n---\n受講料 9,999円\n');
  put('40_要項/_TEMPLATE.md', '---\ntitle: ひな形\n---\n受講料 0円\n');
  put('35_広報・制作/_原本/元.md', '受講料 1円\n');
  put('memo.txt', '受講料 2円\n');
  return root;
}

test('safeRelPath：knowledge/ の外や _ で始まる部分は拒む', () => {
  assert.equal(safeRelPath('10_理念・方針/COMPANY.md'), '10_理念・方針/COMPANY.md');
  assert.equal(safeRelPath('knowledge/10_理念・方針/COMPANY.md'), '10_理念・方針/COMPANY.md');
  assert.equal(safeRelPath('/10_理念・方針/'), '10_理念・方針');
  assert.equal(safeRelPath(''), '');
  assert.equal(safeRelPath('../package.json'), null);
  assert.equal(safeRelPath('10_理念・方針/../../.env'), null);
  assert.equal(safeRelPath('40_要項/_TEMPLATE.md'), null);
  assert.equal(safeRelPath('.git/config'), null);
  assert.equal(safeRelPath(42), null);
});

test('readFile：確定・通常のファイルは読め、下書き・テンプレート・.md 以外は読めない', async () => {
  const root = fixture();
  assert.match(await readFile(root, '10_理念・方針/COMPANY.md'), /報連想/);
  assert.match(await readFile(root, '40_要項/2026/確定.md'), /5,500円/);
  assert.doesNotMatch(await readFile(root, '40_要項/2026/下書き.md'), /9,999円/);
  assert.match(await readFile(root, '40_要項/2026/下書き.md'), /確定していない/);
  assert.doesNotMatch(await readFile(root, '40_要項/_TEMPLATE.md'), /0円/);
  assert.doesNotMatch(await readFile(root, 'memo.txt'), /2円/);
  assert.match(await readFile(root, 'なし.md'), /見つかりません/);
});

test('grepKnowledge：下書き・_ で始まるもの・.md 以外は検索に出ない', async () => {
  const root = fixture();
  const out = await grepKnowledge(root, '受講料');
  assert.match(out, /40_要項\/2026\/確定\.md:5: 受講料 5,500円/);
  assert.doesNotMatch(out, /9,999|料 0円|料 1円|料 2円/);
  assert.match(await grepKnowledge(root, '存在しない語'), /見つかりませんでした/);
  assert.match(await grepKnowledge(root, '  '), /指定してください/);
});

test('listAllowedFiles・listDir：_ で始まるものと .md 以外は並べない', async () => {
  const root = fixture();
  assert.deepEqual(await listAllowedFiles(root), [
    '10_理念・方針/COMPANY.md',
    '40_要項/2026/下書き.md',
    '40_要項/2026/確定.md',
  ].sort((a, b) => a.localeCompare(b)));
  assert.equal(await listDir(root, '40_要項'), '2026/');
  assert.match(await listDir(root, undefined), /10_理念・方針\//);
  assert.match(await listDir(root, '../'), /開けません/);
});

test('runKnowledgeTool：知らないツール名でも例外にしない', async () => {
  const root = fixture();
  assert.match(await runKnowledgeTool(root, 'delete_all', {}), /ありません/);
  assert.match(await runKnowledgeTool(root, 'read_file', { path: '10_理念・方針/COMPANY.md' }), /報連想/);
});
