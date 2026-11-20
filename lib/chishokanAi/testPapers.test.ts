// 中学校のテスト問題の保存と検索（testPapers.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSaveInput,
  checkSearchInput,
  filterTestPapers,
  formatTestPapers,
  parseFilesCell,
  schoolKey,
  testFileName,
  toYear,
  type TestPaperRec,
} from './testPapers.ts';

const AV = ['期末_数学_問題.pdf', '期末_数学_解答.pdf', 'IMG_0001.jpg'];
const BASE = {
  files: [{ name: '期末_数学_問題.pdf', role: '問題' }, { name: '期末_数学_解答.pdf', role: '解答' }],
  kind: '定期テスト',
  year: 2026,
  school: '佐世保市立日宇中学校',
  grade: '中2',
  subject: '数学',
  term: '2学期期末',
  topics: '大問1 一次関数のグラフ／大問2 連立方程式の文章題',
};

test('保存の入力：添付が無い・添付に無い名前・必須の項目が無いときは断る', () => {
  assert.equal(checkSaveInput(BASE, []).ok, false);
  const bad = checkSaveInput({ ...BASE, files: [{ name: 'ない.pdf' }] }, AV);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.message, /ない\.pdf/);
  assert.equal(checkSaveInput({ ...BASE, kind: '模試' }, AV).ok, false);
  assert.equal(checkSaveInput({ ...BASE, year: '' }, AV).ok, false);
  assert.equal(checkSaveInput({ ...BASE, school: ' ' }, AV).ok, false);
  assert.equal(checkSaveInput({ ...BASE, subject: '技術' }, AV).ok, false);
  assert.equal(checkSaveInput({ ...BASE, term: '' }, AV).ok, false); // 定期テストは時期が必須
  assert.equal(checkSaveInput({ ...BASE, topics: '' }, AV).ok, false);
});

test('保存の入力：整える（役目の既定・同じファイルは1つ・題名を作る・入試は中3・令和の年度）', () => {
  const r = checkSaveInput({ ...BASE, files: [{ name: 'IMG_0001.jpg' }, { name: 'IMG_0001.jpg' }] }, AV);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.files, [{ name: 'IMG_0001.jpg', role: '問題' }]);
  assert.equal(r.value.title, '2026年度 佐世保市立日宇中学校 中2 数学 2学期期末');
  const nyushi = checkSaveInput({ ...BASE, kind: '入試問題', grade: '', term: '', school: '長崎県公立高校', year: '令和8年度' }, AV);
  assert.ok(nyushi.ok);
  if (nyushi.ok) {
    assert.equal(nyushi.value.grade, '中3');
    assert.equal(nyushi.value.year, 2026);
    assert.equal(nyushi.value.title, '2026年度 長崎県公立高校 中3 数学 入試問題');
  }
  assert.equal(toYear('2025年度'), 2025);
  assert.equal(toYear('令和元年'), 2019);
  assert.equal(toYear(1999), 0);
});

test('ファイル名：年度_種類_学校_学年_教科_時期_役目。同じ役目が続くと番号', () => {
  const r = checkSaveInput(BASE, AV);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(testFileName(r.value, '問題', 'application/pdf'), '2026年度_定期テスト_佐世保市立日宇中学校_中2_数学_2学期期末_問題.pdf');
  assert.equal(testFileName(r.value, '問題', 'image/jpeg', 1), '2026年度_定期テスト_佐世保市立日宇中学校_中2_数学_2学期期末_問題2.jpg');
});

const rec = (o: Partial<TestPaperRec>): TestPaperRec => ({
  id: 'x', ts: '2026/11/20 10:00', user: '太田', campus: '小中等部', kind: '定期テスト', year: '2026', school: '佐世保市立日宇中学校',
  grade: '中2', subject: '数学', term: '2学期期末', title: '', topics: '大問1 一次関数／大問2 連立方程式', note: '',
  files: [{ role: '問題', name: 'a.pdf', url: 'https://drive.google.com/file/d/A/view' }], ...o,
});
const ROWS = [
  rec({ id: '1' }),
  rec({ id: '2', year: '2025', term: '学年末', topics: '大問1 確率／大問2 図形の証明' }),
  rec({ id: '3', school: '佐世保市立大野中学校', subject: '5教科', topics: '数学 大問3 一次関数' }),
  rec({ id: '4', kind: '入試問題', school: '長崎県公立高校', grade: '中3', subject: '英語', term: '一般入試', topics: '長文読解・英作文' }),
];

test('検索：学校名は一部でよい・教科は5教科も含む・言葉は全部を含むもの・新しい年度から', () => {
  const ids = (q: Record<string, unknown>) => filterTestPapers(ROWS, checkSearchInput(q)).map((r) => r.id);
  assert.deepEqual(ids({ school: '日宇中' }), ['1', '2']);
  assert.deepEqual(ids({ subject: '数学', query: '一次関数' }), ['1', '3']);
  assert.deepEqual(ids({ kind: '入試問題', subject: '英語' }), ['4']);
  assert.deepEqual(ids({ year: '2025年度' }), ['2']);
  assert.deepEqual(ids({ term: '期末' }), ['1', '3']);
  assert.deepEqual(ids({ query: '一次関数 連立' }), ['1']);
  assert.equal(schoolKey('佐世保市立 日宇中学校'), '佐世保市立日宇');
});

test('結果の文：リンクをそのまま出す。無ければ「保存されていない」と伝えさせる', () => {
  const q = checkSearchInput({ school: '日宇' });
  const t = formatTestPapers(filterTestPapers(ROWS, q), ROWS.length, q);
  assert.match(t, /2件／保存は全部で4件/);
  assert.match(t, /問題：https:\/\/drive\.google\.com\/file\/d\/A\/view/);
  const none = formatTestPapers([], 4, checkSearchInput({ school: '相浦' }));
  assert.match(none, /保存されていない/);
  assert.equal(checkSearchInput({ limit: 99 }).limit, 30);
});

test('シートの「ファイル」の欄を読む（URL の無い行は捨てる）', () => {
  assert.deepEqual(parseFilesCell('問題｜a.pdf｜https://drive.google.com/a\n解答｜b.pdf｜\n'), [{ role: '問題', name: 'a.pdf', url: 'https://drive.google.com/a' }]);
});
