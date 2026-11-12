import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown, safeHref, splitRow, toPlainText } from './markdown.ts';

test('parseInline: 太字・コード・リンク・そのままのURLを分ける', () => {
  assert.deepEqual(parseInline('冬期は**12月26日（土）**から'), [
    { t: 'text', v: '冬期は' },
    { t: 'bold', c: [{ t: 'text', v: '12月26日（土）' }] },
    { t: 'text', v: 'から' },
  ]);
  assert.deepEqual(parseInline('`read_file` を使う'), [{ t: 'code', v: 'read_file' }, { t: 'text', v: ' を使う' }]);
  assert.deepEqual(parseInline('[文書](https://docs.google.com/document/d/abc)'), [
    { t: 'link', href: 'https://docs.google.com/document/d/abc', c: [{ t: 'text', v: '文書' }] },
  ]);
  // URLの後ろの日本語の括弧・句読点はURLに含めない
  assert.deepEqual(parseInline('URL：https://example.com/a）。'), [
    { t: 'text', v: 'URL：' },
    { t: 'link', href: 'https://example.com/a', c: [{ t: 'text', v: 'https://example.com/a' }] },
    { t: 'text', v: '）。' },
  ]);
});

test('parseInline: 閉じていない ** はそのまま文字にする（届いている途中）', () => {
  assert.deepEqual(parseInline('**途中'), [{ t: 'text', v: '**途中' }]);
});

test('safeHref: http / https 以外はリンクにしない', () => {
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('https://chishokan.co.jp/'), 'https://chishokan.co.jp/');
  for (const src of ['[押す](javascript:alert)', '[押す](javascript:alert(1))', 'javascript:alert(1)']) {
    assert.ok(parseInline(src).every((n) => n.t !== 'link'), src);
  }
});

test('parseMarkdown: 見出し・段落・区切り線', () => {
  const b = parseMarkdown('## 結論\n冬期は2本立てです。\n詳しくは下へ。\n\n---\n本文');
  assert.equal(b[0].t, 'heading');
  assert.equal(b[0].t === 'heading' && b[0].level, 2);
  assert.equal(b[1].t, 'para');
  assert.equal(b[1].t === 'para' && b[1].lines.length, 2);
  assert.equal(b[2].t, 'hr');
  assert.equal(b[3].t, 'para');
});

test('parseMarkdown: 表（区切り行のあとだけ表にする）', () => {
  const b = parseMarkdown('| 校舎 | 人数 |\n|---|---:|\n| 日野校 | 12 |\n| 駅前校 | 30 |\n\n後ろ');
  assert.equal(b[0].t, 'table');
  if (b[0].t !== 'table') return;
  assert.equal(b[0].head.length, 2);
  assert.equal(b[0].rows.length, 2);
  assert.deepEqual(b[0].rows[1][0], [{ t: 'text', v: '駅前校' }]);
  assert.equal(b[1].t, 'para');
  // 区切り行がまだ届いていなければ段落のまま
  assert.equal(parseMarkdown('| 校舎 | 人数 |')[0].t, 'para');
});

test('splitRow: \\| はセルの区切りにしない', () => {
  assert.deepEqual(splitRow('| a \\| b | c |'), ['a | b', 'c']);
});

test('parseMarkdown: 箇条書き（番号・入れ子・続きの行）', () => {
  const b = parseMarkdown('1. 原稿を作る\n   - 要項から写す\n2. 確認する\n   担当者に見てもらう');
  assert.equal(b.length, 1);
  if (b[0].t !== 'list') return assert.fail('list');
  assert.deepEqual(b[0].items.map((i) => [i.level, i.marker]), [[0, '1.'], [1, '◦'], [0, '2.']]);
  assert.deepEqual(b[0].items[2].c, [{ t: 'text', v: '確認する\n担当者に見てもらう' }]);
});

test('parseMarkdown: コード枠（閉じていなければ最後まで）', () => {
  const b = parseMarkdown('プロンプトです。\n```\n# 智翔館 中等部\n====================\n【サイズ】A4');
  assert.equal(b[1].t, 'code');
  assert.equal(b[1].t === 'code' && b[1].v, '# 智翔館 中等部\n====================\n【サイズ】A4');
  const closed = parseMarkdown('```text\nA\n```\n後ろ');
  assert.equal(closed[0].t === 'code' && closed[0].lang, 'text');
  assert.equal(closed[1].t, 'para');
});

test('toPlainText: 記号を外し、表はタブ区切り、コード枠は中身そのまま', () => {
  const md = '## 結論\n**冬期**は2本立て。\n\n- 中1・2\n- 中3\n\n| 校舎 | 人数 |\n|---|---|\n| 日野校 | 12 |\n\n```\n【サイズ】A4\n```';
  assert.equal(toPlainText(md), '【結論】\n\n冬期は2本立て。\n\n・中1・2\n・中3\n\n校舎\t人数\n日野校\t12\n\n【サイズ】A4');
});
