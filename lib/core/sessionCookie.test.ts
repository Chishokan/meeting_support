import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peekSessionRole } from './sessionCookie.ts';

// auth.ts の encodeSession と同じ形（v2.<内容のbase64url>.<署名>）。署名はここでは確かめないので何でもよい。
const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const v2 = (body: unknown) => `v2.${b64url(JSON.stringify(body))}.sig`;

test('署名付きの Cookie からロールを読む（氏名・部門が日本語でも）', () => {
  assert.equal(peekSessionRole(v2({ name: '智翔 太郎', campus: '小中等部', role: 'teacher', exp: 1 })), 'teacher');
  assert.equal(peekSessionRole(v2({ name: '髙﨑 花子', campus: 'RED個別', role: 'admin' })), 'admin');
});

test('base64url の長さが4の倍数でなくても読める', () => {
  for (const name of ['a', 'ab', 'abc', 'abcd']) {
    assert.equal(peekSessionRole(v2({ name, campus: 'x', role: 'staff' })), 'staff', name);
  }
});

test('ロールの無い Cookie・従来の署名なしの Cookie・壊れた Cookie は undefined', () => {
  assert.equal(peekSessionRole(v2({ name: 'a', campus: 'b' })), undefined);
  assert.equal(peekSessionRole(Buffer.from(JSON.stringify({ name: 'a', campus: 'b', role: 'teacher' })).toString('base64')), undefined);
  assert.equal(peekSessionRole('v2.@@@.sig'), undefined);
  assert.equal(peekSessionRole(`v2.${b64url('null')}.sig`), undefined);
  assert.equal(peekSessionRole(v2({ role: 1 })), undefined);
  assert.equal(peekSessionRole('v2.'), undefined);
  assert.equal(peekSessionRole(''), undefined);
  assert.equal(peekSessionRole(undefined), undefined);
});
