// マニュアルの検索（lib/manualSearch.ts）と、並べる資料（lib/manuals.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesManual, normalizeForSearch, splitQuery } from './manualSearch.ts';
import { MANUALS, MANUAL_CATEGORIES } from './manuals.ts';

const pdf = { title: '智翔館AI（試用版）利用マニュアル', desc: '質問のしかたと回答の見方、資料の渡し方', kind: 'pdf' as const };
const video = { title: '動画：部門会議の進め方', desc: '事前共有 → 録音 → 議事録', kind: 'video' as const };

test('全角・半角、カタカナ・ひらがな、大文字・小文字をそろえる', () => {
  assert.equal(normalizeForSearch('ＡＩ　ﾛｸﾞｲﾝ'), 'ai ろぐいん');
  assert.equal(normalizeForSearch('マニュアル'), 'まにゅある');
  assert.deepEqual(splitQuery('  部門会議　動画 '), ['部門会議', '動画']);
  assert.deepEqual(splitQuery(''), []);
});

test('題名・説明・分類名・種類で探せる。言葉はすべて含むものだけ', () => {
  assert.ok(matchesManual(pdf, '智翔館AI', splitQuery('ai')));
  assert.ok(matchesManual(pdf, '智翔館AI', splitQuery('まにゅある')));
  assert.ok(matchesManual(video, '会議DX・部門会議', splitQuery('会議dx')));
  assert.ok(matchesManual(video, '会議DX・部門会議', splitQuery('議事録 動画')));
  assert.ok(!matchesManual(pdf, '智翔館AI', splitQuery('ai 動画')));
  assert.ok(matchesManual(pdf, '智翔館AI', []));
});

test('どの資料にも分類が付いていて、id が重ならない', () => {
  const ids = new Set<string>(MANUAL_CATEGORIES.map((c) => c.id));
  for (const m of MANUALS) assert.ok(ids.has(m.category), `${m.id} の分類 ${m.category} が無い`);
  assert.equal(new Set(MANUALS.map((m) => m.id)).size, MANUALS.length);
});
