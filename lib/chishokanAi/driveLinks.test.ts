// Google ドライブのリンクの読み取り（driveLinks.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDriveIds, reasonText } from './driveLinks.ts';

test('extractDriveIds：ドキュメント・スプレッドシート・スライド・ドライブのリンクを拾う', () => {
  const text = [
    'これ見て https://docs.google.com/document/d/1AbcDEfGhIJkLmNoPqRsTu/edit?usp=sharing',
    'https://docs.google.com/spreadsheets/u/0/d/1SheetIdAAAAAAAAAAAA/edit#gid=0',
    'https://docs.google.com/presentation/d/1SlideIdBBBBBBBBBB/edit',
    'https://drive.google.com/file/d/1FileIdCCCCCCCCCCC/view',
  ].join('\n');
  assert.deepEqual(extractDriveIds(text, 10), [
    '1AbcDEfGhIJkLmNoPqRsTu', '1SheetIdAAAAAAAAAAAA', '1SlideIdBBBBBBBBBB', '1FileIdCCCCCCCCCCC',
  ]);
});

test('extractDriveIds：重複は1つにし、上限で切る。関係ないURLは拾わない', () => {
  const a = 'https://docs.google.com/document/d/1AAAAAAAAAAAAA/edit';
  const text = `${a} ${a} https://drive.google.com/open?id=1BBBBBBBBBBBBB https://example.com/d/1CCCCCCCCCCCC https://docs.google.com/document/d/1DDDDDDDDDDDDD/edit https://docs.google.com/document/d/1EEEEEEEEEEEEE/edit`;
  assert.deepEqual(extractDriveIds(text), ['1AAAAAAAAAAAAA', '1BBBBBBBBBBBBB', '1DDDDDDDDDDDDD']);
  assert.deepEqual(extractDriveIds('リンクなし'), []);
});

test('reasonText：理由を職員向けの言葉にする', () => {
  assert.match(reasonText('not_allowed'), /フォルダの外/);
  assert.match(reasonText('blocked_name'), /名簿/);
  assert.match(reasonText('???'), /失敗/);
});

test('extractDriveFolderIds・driveIdFrom：フォルダのリンクとIDを取り出す', async () => {
  const { extractDriveFolderIds, driveIdFrom } = await import('./driveLinks.ts');
  assert.deepEqual(
    extractDriveFolderIds('見て https://drive.google.com/drive/folders/16VRA3zstFpsKGKc2UsFX?usp=drive_link と https://drive.google.com/drive/u/0/folders/1AnotherFolderXX'),
    ['16VRA3zstFpsKGKc2UsFX', '1AnotherFolderXX'],
  );
  assert.equal(driveIdFrom('https://docs.google.com/document/d/1DocIdAAAAAAAA/edit'), '1DocIdAAAAAAAA');
  assert.equal(driveIdFrom('https://drive.google.com/drive/folders/1FolderIdBBBBBB'), '1FolderIdBBBBBB');
  assert.equal(driveIdFrom('  1RawIdCCCCCCCCC '), '1RawIdCCCCCCCCC');
  assert.equal(driveIdFrom('短い'), null);
  assert.equal(driveIdFrom(42), null);
});
