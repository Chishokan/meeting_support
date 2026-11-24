import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { APP_PATHS, OPEN_PATHS, ROLE_APPS, roleCanOpenPath, roleCanUseApp } from './roleAccess.ts';

// 社員の画面・API の例（スタッフには開かないもの）
const STAFF_ONLY = [
  '/inquiry-board', '/inquiry-board/qa', '/api/inquiry-board', '/api/inquiry-board/merge', '/api/inquiry-qa',
  '/monpai', '/monpai/report', '/api/monpai/plan', '/api/monpai/records',
  '/moshi', '/moshi/report', '/api/moshi', '/api/moshi/results',
  '/aptitude', '/aptitude/c/12', '/api/aptitude/candidates', '/api/aptitude/candidates/12',
  '/helpdesk', '/helpdesk/manual', '/helpdesk/feedback', '/api/inquiry',
  '/kenshu', '/api/kenshu',
  '/api/auth/to-color',
  '/manual/meeting-dx-manual-v0.18.0.pdf',
  '/inquiry', '/inquiry-qa', '/yoko-qa', // 古い URL（ほかのアプリへ送るだけ）
];

test('社員と従来のログイン（ロール無し）は、どの画面・API も通す', () => {
  for (const role of ['admin', 'staff', 'employee', undefined]) {
    for (const p of ['/', '/dashboard', '/ai', '/event', ...STAFF_ONLY]) {
      assert.equal(roleCanOpenPath(role, p), true, `${role} ${p}`);
    }
    for (const id of ['meeting', 'chishokan-ai', 'event', 'seiseki', 'inquiry-board', 'monpai', 'helpdesk', 'aptitude', 'color-pay']) {
      assert.equal(roleCanUseApp(role, id), true, `${role} ${id}`);
    }
  }
});

test('スタッフは会議DX・智翔館AI・イベント申込管理の画面と API を開ける', () => {
  for (const p of [
    '/', '/dashboard', '/dept-minutes', '/numbers', '/chat', '/meeting-review', '/progress', '/progress/settings',
    '/task-report', '/task-coach', '/task-eval',
    '/api/dept-minutes', '/api/dept-minutes/preshare/confirm', '/api/dept-minutes/transcribe', '/api/progress/latest',
    '/api/success', '/api/share-items', '/api/yoko-qa', '/api/zoom/meetings/start', '/api/zoom/minutes',
    '/ai', '/api/chishokan-ai', '/api/chishokan-ai/conversations', '/api/chishokan-ai/preshare',
    '/event', '/api/event', '/api/event/students',
  ]) {
    assert.equal(roleCanOpenPath('teacher', p), true, p);
  }
});

test('スタッフでも、ログイン・ログアウトと別のログインの画面は開ける', () => {
  for (const p of [
    '/login', '/api/login', '/api/logout', '/api/auth/login', '/api/auth/handoff',
    '/exam/abc123', '/api/exam/abc123', '/monpai-staff', '/monpai-staff/login', '/api/monpai-staff/records',
  ]) {
    assert.equal(roleCanOpenPath('teacher', p), true, p);
  }
});

test('スタッフは、ほかのアプリの画面・API・マニュアルのファイルを開けない', () => {
  for (const p of STAFF_ONLY) assert.equal(roleCanOpenPath('teacher', p), false, p);
});

test('前方一致は「/」の区切りまで見る（似た名前の別の URL を通さない）', () => {
  for (const p of ['/events', '/aix', '/dashboard2', '/api/eventx', '/monpai-staffx', '/loginx', '/api/exams']) {
    assert.equal(roleCanOpenPath('teacher', p), false, p);
  }
});

test('総合メニューのカード：スタッフは3つだけ', () => {
  for (const id of ['meeting', 'chishokan-ai', 'event']) assert.equal(roleCanUseApp('teacher', id), true, id);
  for (const id of ['seiseki', 'inquiry-board', 'monpai', 'interview-red', 'interview-chutobu', 'aptitude', 'helpdesk', 'color-pay', 'color-hrm']) {
    assert.equal(roleCanUseApp('teacher', id), false, id);
  }
});

test('知らないロールには、どのアプリも開かない（ログインと別のログインの画面だけ）', () => {
  for (const role of ['parent', 'constructor', '__proto__', 'toString']) {
    assert.equal(roleCanUseApp(role, 'meeting'), false, role);
    assert.equal(roleCanOpenPath(role, '/dashboard'), false, role);
    assert.equal(roleCanOpenPath(role, '/api/chishokan-ai'), false, role);
    assert.equal(roleCanOpenPath(role, '/'), true, role);
    assert.equal(roleCanOpenPath(role, '/login'), true, role);
  }
});

// app/ の画面（page.tsx）と API（route.ts）の URL を集める。(グループ) のフォルダは URL に出ない。
function routes(dir = path.join(process.cwd(), 'app'), url = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...routes(full, /^\(.+\)$/.test(name) ? url : `${url}/${name}`));
    } else if (name === 'page.tsx' || name === 'route.ts') {
      out.push(url || '/');
    }
  }
  return out;
}

test('スタッフに開く URL は、どれも実在の画面・API を指している（打ち間違いが無い）', () => {
  assert.ok(existsSync(path.join(process.cwd(), 'app')), 'リポジトリの一番上で npm test を実行すること');
  const all = routes();
  const prefixes = [...OPEN_PATHS, ...Object.values(APP_PATHS).flat()];
  for (const p of prefixes) {
    assert.ok(all.some((r) => r === p || r.startsWith(`${p}/`)), `${p} に当たる画面・API が無い`);
  }
});

test('会議DX・智翔館AI・イベント申込管理の画面は、すべてスタッフに開いている', () => {
  const groups: Record<string, string[]> = { '(app)': [], '(ai)': [], '(event)': [] };
  for (const g of Object.keys(groups)) groups[g] = routes(path.join(process.cwd(), 'app', g));
  // ほかのアプリへ送るだけの古い URL は除く
  const redirectOnly = ['/inquiry', '/inquiry-qa', '/yoko-qa'];
  for (const [g, list] of Object.entries(groups)) {
    assert.ok(list.length > 0, `${g} の画面が見つからない`);
    for (const p of list.filter((x) => !redirectOnly.includes(x))) {
      assert.equal(roleCanOpenPath('teacher', p), true, `${g} ${p}`);
    }
  }
  assert.deepEqual(Object.keys(ROLE_APPS), ['teacher']);
});
