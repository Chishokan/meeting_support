// 入力チェック（model.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRealDate, validateCandidate, validateHire } from './model.ts';

test('isRealDate: 実在する日付だけ通す', () => {
  assert.equal(isRealDate('2005-04-02'), true);
  assert.equal(isRealDate('2024-02-29'), true);
  assert.equal(isRealDate('2023-02-29'), false);
  assert.equal(isRealDate('2000-02-30'), false);
  assert.equal(isRealDate('2000-13-01'), false);
  assert.equal(isRealDate('2000/01/01'), false);
});

test('validateHire: 採用結果が空なら選考中、評価は1〜5の整数だけ', () => {
  assert.deepEqual(validateHire({}), { ok: true, value: { hireStatus: '選考中', postEval: null, postEvalNote: '' } });
  assert.equal(validateHire({ hireStatus: '採用', postEval: 6 }).ok, false);
  assert.equal(validateHire({ hireStatus: '保留' }).ok, false);
});

test('validateCandidate: 必須・選択肢・日付をまとめて指摘する', () => {
  const r = validateCandidate({ name: '', role: '営業', base: '東京', birthDate: '2000-02-30' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors.length, 4);
  const ok = validateCandidate({ name: ' 佐世保 花子 ', role: '事務', base: 'NEP' });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.name, '佐世保 花子');
});
