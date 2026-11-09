// 議事録の1枚まとめの PDF（deptMinutesDigestPdf.ts）と Word（deptMinutesDigestDocx.ts）のテスト。  npm test
// assets/fonts/ の Noto Sans JP を実際に使って PDF を作る（数秒かかる）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { renderDigestPdf, renderDigestsPdf } from './deptMinutesDigestPdf.ts';
import { digestsDocx } from './deptMinutesDigestDocx.ts';
import type { Digest } from './deptMinutesDigest.ts';

const base: Digest = {
  id: '427f9cf1-9a07-46e1-8fb1-e9f9553d2c3c',
  dept: 'RED個別',
  title: '中高連携会議',
  date: '2026/10/28（水）',
  place: '佐世保駅前校',
  attendees: '瀬戸山、太田、田﨑、小山',
  recorder: '瀬戸山理恵',
  revised: false,
  createdAt: '2026/11/02 15:20',
  purpose: '',
  summary: '中3生の高校継続に向けた打ち合わせ。模試返却面談は冬季前に完了、スケジュール表は3部門で一本化。',
  decisions: [
    { title: '模試返却面談は冬季前に完了', detail: '対象約60人。三者面談の後に並行して進める。', owner: '太田', due: '冬季前' },
    { title: 'スケジュール表を一本化', detail: '高等部・中等部・REDの列に分けてカレンダー形式にする。', owner: '瀬戸山', due: '【要確認】' },
  ],
  todos: [
    { task: 'スケジュール表の統合', owner: '瀬戸山・太田・田﨑', due: '【要確認】', status: 'done' },
    { task: '修正依頼をまとめて依頼', owner: '瀬戸山', due: '', status: 'not_done' },
  ],
  pending: ['料金体系の扱い ✕ 結論出ず → 本部に相談'],
  reports: ['大野の継続面談は安田先生に引き継いだ'],
  next: '水曜 13:30〜14:30（日付【要確認】）',
  checks: ['担当・期限の未定が多い'],
};

const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

test('renderDigestPdf: ふつうの議事録は A4 1枚・10pt で収まる', async () => {
  const r = await renderDigestPdf(base);
  assert.equal(r.pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(r.pages, 1);
  assert.equal(pageCount(r.pdf), 1);
  assert.equal(r.fontSize, 10);
  assert.match(r.pdf.toString('latin1'), /MediaBox \[0 0 595\.28 841\.89\]/);
});

test('renderDigestPdf: 量が多いと文字を小さくして1枚に収め、それでも無理なら複数枚にする', async () => {
  const many = (n: number, text: string) => Array.from({ length: n }, (_, i) => `${text}${i + 1}`);
  const medium: Digest = {
    ...base,
    decisions: many(9, '決定事項の内容。担当と期限を確認し、次回までに進める。理由も一言添える。').map((t) => ({ title: '件名', detail: t, owner: '太田', due: '次回' })),
    todos: many(14, 'ToDoの内容を書く').map((t) => ({ task: t, owner: '瀬戸山', due: '次回', status: '' as const })),
    pending: many(6, '継続審議の内容。何が決まっていないか → 次にどうするか。'),
    reports: many(6, '報告の内容。数字と状況。'),
  };
  const m = await renderDigestPdf(medium);
  assert.equal(m.pages, 1);
  assert.ok(m.fontSize < 10 && m.fontSize >= 7.5, `fontSize ${m.fontSize}`);

  const huge: Digest = {
    ...medium,
    decisions: many(15, 'とても長い決定事項の内容。'.repeat(6)).map((t) => ({ title: '件名', detail: t, owner: '太田', due: '次回' })),
    todos: many(20, '長いToDoの内容。'.repeat(4)).map((t) => ({ task: t, owner: '瀬戸山', due: '次回', status: '' as const })),
  };
  const h = await renderDigestPdf(huge);
  assert.ok(h.pages >= 2, `pages ${h.pages}`);
  assert.equal(h.fontSize, 7.5);
  assert.equal(pageCount(h.pdf), h.pages);
});

test('renderDigestsPdf: 複数の会議を1つの PDF にし、会議ごとに新しいページから始める', async () => {
  const second: Digest = { ...base, title: '週礼', dept: '小中等部', id: '1a783aa4-e40b-4fa0-ad60-50b4d485afd3' };
  const r = await renderDigestsPdf([base, second], '部門会議 議事録まとめ（11/2〜11/8 保存分）');
  assert.equal(r.pages, 2);
  assert.equal(pageCount(r.pdf), 2);
  assert.deepEqual(r.fontSizes, [10, 10]);
  await assert.rejects(() => renderDigestsPdf([], 'x'), /会議がありません/);
});

test('digestsDocx: 会議ごとにセクションを分けた Word（docx）を作る', async () => {
  const buf = await digestsDocx([{ digest: base, size: 10 }, { digest: { ...base, title: '週礼' }, size: 9 }], '議事録まとめ');
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK');
  const xml = (await JSZip.loadAsync(buf)).file('word/document.xml');
  assert.ok(xml);
  const text = await xml.async('string');
  assert.equal((text.match(/<w:sectPr/g) || []).length, 2);
  assert.match(text, /No\. 2 \/ 2/);
  assert.match(text, /中高連携会議/);
});
