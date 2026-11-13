// 智翔館AI の作業の手順書（tasks.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inlineList, listTasks, loadTaskBundle, parseTask, stripFrontMatter, taskListForPrompt, taskTool } from './tasks.ts';
import { readFileDetailed } from './knowledgeTools.ts';

const TASK = `---
title: チラシを作る
task: flyer
button: チラシを作る
starter: 冬期講習のチラシを作って
use_when: チラシを新しく作るとき
reads: [35_広報・制作/チラシ制作/00_使い方.md, 40_要項/2026/下書き.md, なし.md]
must_include: 確認してほしいこと
---
# チラシを作る
1. 要項を探す
`;

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'tasks-'));
  const put = (rel: string, body: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  };
  put('05_作業/10_チラシ.md', TASK);
  put('05_作業/_ひな形.md', TASK.replace('task: flyer', 'task: template'));
  put('05_作業/20_壊れ.md', '---\ntitle: 名前なし\n---\n本文');
  put('35_広報・制作/チラシ制作/00_使い方.md', '---\ntitle: 使い方\n---\n原稿を先に固める');
  put('40_要項/2026/下書き.md', '---\ntitle: 案\nstatus: 下書き\n---\n受講料 9,999円');
  return root;
}

test('inlineList / stripFrontMatter', () => {
  assert.deepEqual(inlineList('[a.md, "b c.md" ,  ]'), ['a.md', 'b c.md']);
  assert.deepEqual(inlineList(undefined), []);
  assert.equal(stripFrontMatter('---\na: 1\n---\n\n# 本文'), '# 本文');
});

test('parseTask：task の名前が無い・形が違うものは null', () => {
  const t = parseTask('05_作業/10_チラシ.md', TASK);
  assert.equal(t?.id, 'flyer');
  assert.equal(t?.mustInclude, '確認してほしいこと');
  assert.equal(t?.reads.length, 3);
  assert.equal(t?.deepThinking, false);
  assert.equal(t?.codeExecution, false);
  const math = parseTask('x.md', '---\ntask: math-material\nthinking: adaptive\ncode_execution: on   # 検算\n---\n');
  assert.equal(math?.deepThinking, true);
  assert.equal(math?.codeExecution, true);
  assert.equal(parseTask('x.md', '---\ntask: Flyer!\n---\n'), null);
  assert.equal(parseTask('x.md', '本文だけ'), null);
});

test('listTasks：_ で始まるもの・task の無いものは除く', async () => {
  const tasks = await listTasks(fixture(), readFileDetailed);
  assert.deepEqual(tasks.map((t) => t.id), ['flyer']);
  assert.match(taskListForPrompt(tasks), /- flyer：チラシを作る（チラシを新しく作るとき）/);
  assert.deepEqual(taskTool(tasks).input_schema.properties.task.enum, ['flyer']);
});

test('loadTaskBundle：手順書と資料をまとめる。確定していない要項・無い資料は渡さず、名前と理由だけ書く', async () => {
  const root = fixture();
  const [t] = await listTasks(root, readFileDetailed);
  const b = await loadTaskBundle(root, t, readFileDetailed);
  assert.deepEqual(b.reads, ['05_作業/10_チラシ.md', '35_広報・制作/チラシ制作/00_使い方.md']);
  assert.match(b.text, /【作業の手順書：チラシを作る（05_作業\/10_チラシ\.md）】\n# チラシを作る/);
  assert.match(b.text, /■ 手順書が指す資料：35_広報・制作\/チラシ制作\/00_使い方\.md/);
  assert.doesNotMatch(b.text, /9,999円/);
  assert.match(b.text, /渡していない資料：40_要項\/2026\/下書き\.md（読めませんでした/);
  assert.doesNotMatch(b.text, /task: flyer/);
});
