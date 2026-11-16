// 本番レベル模試の計算（model.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  choiceRanks, cleanExam, cleanResult, computeStats, DEFAULT_SUBJECTS, emptyScores, examMax, fitScores, historyOf,
  inputSheetRows, jpDate, nextExamNo, normalizeName, parsePaste, parseScore, planPaste, rankedRows, scoresFromCell,
  scoresToCell, strengthsAndWeaknesses, subjectMax, topicPoints,
  type MoshiExam, type MoshiResult, type Scores,
} from './model.ts';

function exam(p: Partial<MoshiExam> = {}): MoshiExam {
  return {
    id: 'exam-11', name: '2026 本番レベル模試 11月', grade: '中3', date: '2026-11-22',
    subjects: DEFAULT_SUBJECTS, schedule: [], belongings: '', notes: '', venues: {},
    createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', ...p,
  };
}

let seq = 0;
function res(p: Partial<MoshiResult> & { s?: Partial<Record<keyof Scores, (number | null)[]>> }, e = exam()): MoshiResult {
  const scores = fitScores(e, p.s ?? {});
  return {
    id: `row-${String(++seq).padStart(4, '0')}`, examId: e.id, campus: '日宇校', examNo: '', name: '', gender: '',
    choices: ['', '', '', ''], comment: '', createdAt: '', createdBy: '', updatedAt: '', updatedBy: '',
    ...p, scores,
  };
}

/** 5教科すべてを、教科の合計が t になるよう1問目に入れる（ほかの大問は 0）。 */
function full(t: [number, number, number, number, number]): Partial<Record<keyof Scores, (number | null)[]>> {
  const e = exam();
  const keys = ['ja', 'en', 'ma', 'so', 'sc'] as const;
  const out: Partial<Record<keyof Scores, (number | null)[]>> = {};
  keys.forEach((k, i) => {
    const qs = e.subjects.find((s) => s.key === k)!.questions;
    let rest = t[i];
    out[k] = qs.map((q) => { const v = Math.min(q.max, rest); rest -= v; return v; });
  });
  return out;
}

test('11月の配点：各教科100点・5教科500点（入力シートの日宇校タブと同じ）', () => {
  const e = exam();
  for (const k of ['ja', 'en', 'ma', 'so', 'sc'] as const) assert.equal(subjectMax(e, k), 100);
  assert.equal(examMax(e), 500);
  assert.equal(e.subjects.find((s) => s.key === 'sc')!.questions.length, 6);
});

test('parseScore：全角・「点」付きも読む。配点超え・小数・負は誤り', () => {
  assert.deepEqual(parseScore('２９', 31), { ok: true, value: 29 });
  assert.deepEqual(parseScore('15点', 17), { ok: true, value: 15 });
  assert.deepEqual(parseScore('', 17), { ok: true, value: null });
  assert.deepEqual(parseScore('18', 17), { ok: false });
  assert.deepEqual(parseScore('2.5', 17), { ok: false });
  assert.deepEqual(parseScore('-1', 17), { ok: false });
});

test('得点のセル：空欄を残したまま行き来できる', () => {
  assert.equal(scoresToCell([29, null, 32, 18]), '29,,32,18');
  assert.equal(scoresToCell([null, null]), '');
  assert.deepEqual(scoresFromCell('29,,32,18', 4), [29, null, 32, 18]);
  assert.deepEqual(scoresFromCell('29,15', 4), [29, 15, null, null]);
});

test('氏名：名字と名前の間は全角の空白1つ', () => {
  assert.equal(normalizeName(' 小川  妃菜 '), '小川　妃菜');
  assert.equal(normalizeName('小川 妃菜'), '小川　妃菜');
});

test('受験番号：校舎の頭4桁＋最大の次の番号', () => {
  assert.equal(nextExamNo('日宇校', ['514401', '514416', '514001']), '514417');
  assert.equal(nextExamNo('駅前校', []), '514501');
});

test('集計：順位は同点同順位、偏差値は全体の平均で50', () => {
  const e = exam();
  const rows = [
    res({ name: 'A', campus: '日宇校', s: full([80, 80, 80, 80, 80]) }),
    res({ name: 'B', campus: '日野校', s: full([60, 60, 60, 60, 60]) }),
    res({ name: 'C', campus: '日宇校', s: full([60, 60, 60, 60, 60]) }),
    res({ name: 'D', campus: '日宇校', s: { ja: [20] } }), // 国語だけ
  ];
  const s = computeStats(e, rows);
  assert.equal(s.entered, 4);
  assert.equal(s.complete, 3);
  const by = (n: string) => s.rows.find((x) => x.r.name === n)!;
  assert.equal(by('A').total, 400);
  assert.equal(by('A').rank, 1);
  assert.equal(by('B').rank, 2);
  assert.equal(by('C').rank, 2);
  assert.equal(by('C').campusRank, 2);
  assert.equal(by('B').campusRank, 1);
  assert.equal(by('D').total, null);
  assert.equal(by('D').rank, null);
  assert.equal(by('D').subRank.ja, 4);
  // 平均 (400+300+300)/3 = 333.3…、A の偏差値は 50 より上・B と C は同じ
  assert.ok((by('A').dev ?? 0) > 50);
  assert.equal(by('B').dev, by('C').dev);
  const mean = s.overall.total!.mean;
  assert.ok(Math.abs(mean - 1000 / 3) < 1e-9);
  assert.deepEqual(rankedRows(s).map((x) => x.r.name), ['A', 'B', 'C', 'D']);
  assert.deepEqual(rankedRows(s, '日宇校').map((x) => x.r.name), ['A', 'C', 'D']);
});

test('集計：大問の一部が空欄でも、入っていればその教科は受けたとして0点で足す', () => {
  const e = exam();
  const s = computeStats(e, [res({ name: 'A', s: { ja: [30, null, 20, null] } })]);
  assert.equal(s.rows[0].sub.ja, 50);
  assert.equal(s.rows[0].sub.en, null);
});

test('志望者内の順位：第一志望が同じ人の中と、第1〜4志望のどこかに書いた人の中', () => {
  const e = exam();
  const rows = [
    res({ name: 'A', choices: ['40200', '40300', '', ''], s: full([90, 90, 90, 90, 90]) }),
    res({ name: 'B', choices: ['40300', '40200', '', ''], s: full([80, 80, 80, 80, 80]) }),
    res({ name: 'C', choices: ['40200', '', '', ''], s: full([70, 70, 70, 70, 70]) }),
  ];
  const s = computeStats(e, rows);
  const c = s.rows.find((x) => x.r.name === 'C')!;
  const [first] = choiceRanks(s, c);
  assert.deepEqual(first.first, { n: 2, rank: 2 });
  assert.deepEqual(first.any, { n: 3, rank: 3 });
  const b = s.rows.find((x) => x.r.name === 'B')!;
  const rb = choiceRanks(s, b);
  assert.deepEqual(rb[0].first, { n: 1, rank: 1 });
  assert.equal(rb[1].first, null); // 第二志望には「第一志望者内」を出さない
  assert.deepEqual(rb[1].any, { n: 3, rank: 2 });
});

test('大問別：平均との差で得意・伸ばしたい分野を3つずつ', () => {
  const e = exam();
  const a = res({ name: 'A', s: { ma: [30, 0, 15, 0, 24] } });
  const b = res({ name: 'B', s: { ma: [0, 15, 0, 16, 0] } });
  const s = computeStats(e, [a, b]);
  const row = s.rows.find((x) => x.r.name === 'A')!;
  const pts = topicPoints(s, row);
  assert.equal(pts.length, 5);
  const { strong, weak } = strengthsAndWeaknesses(pts);
  assert.deepEqual(strong.map((p) => p.topic), ['計算と作図', '二次関数', '探究的な問題']);
  assert.deepEqual(weak.map((p) => p.topic), ['データの活用', '平面図形・空間図形']);
});

test('推移：氏名（空白・★を除く）と受験番号か校舎が同じ行を、実施日の古い順に', () => {
  const e10 = exam({ id: 'exam-10', name: '10月', date: '2026-10-18' });
  const e11 = exam({ id: 'exam-11', name: '11月', date: '2026-11-22' });
  const a10 = res({ name: '小川 妃菜　★', examNo: '514410', s: full([60, 60, 60, 60, 60]) }, e10);
  const a11 = res({ name: '小川　妃菜', examNo: '514410', s: full([70, 70, 70, 70, 70]) }, e11);
  const other = res({ name: '小川　妃菜', examNo: '514099', campus: '日野校', s: full([10, 10, 10, 10, 10]) }, e10);
  const all = [a10, a11, other];
  const h = historyOf([computeStats(e11, all), computeStats(e10, all)], a11);
  assert.deepEqual(h.map((x) => x.exam.id), ['exam-10', 'exam-11']);
  assert.equal(h[0].row.r.id, a10.id);
});

test('貼り付け：名簿（受験番号・氏名・性別・志望校）', () => {
  const e = exam();
  const r = parsePaste('受験番号\t氏名\t性別\n514401\t山田 太郎\t0\t40200\t佐世保西\n514402\t\t\n\t鈴木 花子\t1', e);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { examNo: '514401', name: '山田　太郎', gender: '男', choices: ['40200', '佐世保西', '', ''], scores: null });
  assert.equal(r.rows[1].examNo, '');
  assert.equal(r.rows[1].gender, '女');
  assert.deepEqual(r.warnings, []);
});

test('貼り付け：入力シートの行（A列から・非表示の列あり）から大問の得点を読み、計の列は飛ばす', () => {
  const e = exam();
  const sc = [
    [29, 15, 32, 18], [27, 21, 5, 13], [30, 12, 9, 0, 6], [16, 17, 14, 8, 14], [12, 9, 12, 18, 18, 12],
  ];
  const scoreCells: (number | string)[] = [];
  for (const s of sc) { scoreCells.push(...s, s.reduce((a, b) => a + b, 0)); }
  const cells = ['10', '514410', '小川 妃菜', '1', '40100', '40200', '40300', '81602',
    '佐世保南', '佐世保北', '佐世保西', '西海学園（特進）', '佐世保南', '佐世保北', '佐世保西', '西海学園（特進）',
    ...scoreCells, 377];
  const r = parsePaste(cells.join('\t'), e);
  assert.equal(r.rows.length, 1);
  const row = r.rows[0];
  assert.equal(row.examNo, '514410');
  assert.deepEqual(row.choices, ['40100', '40200', '40300', '81602']);
  assert.deepEqual(row.scores!.ma, [30, 12, 9, 0, 6]);
  assert.deepEqual(row.scores!.sc, [12, 9, 12, 18, 18, 12]);
});

test('貼り付け：入力シートの空き番号の行（式の 0 だけ）は飛ばす', () => {
  const e = exam();
  const zeros: string[] = [];
  for (const n of [4, 4, 5, 5, 6]) { zeros.push(...Array(n).fill(''), '0'); }
  const line = ['514420', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ...zeros, '0'].join('\t');
  assert.equal(parsePaste(line, e).rows.length, 0);
});

test('貼り付けの当てはめ：受験番号 → 氏名 の順で、同じ行に二重に当てない', () => {
  const e = exam();
  const cur = [res({ examNo: '514401', name: '山田　太郎' }), res({ examNo: '514402', name: '鈴木　花子' })];
  const plan = planPaste([
    { examNo: '514401', name: '山田　太郎', gender: '', choices: [], scores: null },
    { examNo: '', name: '鈴木 花子', gender: '', choices: [], scores: null },
    { examNo: '514403', name: '佐藤　一郎', gender: '', choices: [], scores: null },
  ], cur);
  assert.equal(plan.update.length, 2);
  assert.equal(plan.update[1].target.examNo, '514402');
  assert.equal(plan.add.length, 1);
});

test('cleanResult：配点を超える得点は止める。志望校の全角コードは半角に', () => {
  const e = exam();
  const base = { id: 'abcdef12-3456', campus: '日宇校', examNo: '５１４４０１', name: '山田 太郎', gender: '0', choices: ['４０２００'] };
  const ok = cleanResult({ ...base, scores: { ja: [31, 17, 34, 18] } }, e);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.examNo, '514401');
    assert.equal(ok.value.name, '山田　太郎');
    assert.deepEqual(ok.value.choices, ['40200', '', '', '']);
    assert.deepEqual(ok.value.scores.ja, [31, 17, 34, 18]);
    assert.deepEqual(ok.value.scores.en, [null, null, null, null]);
  }
  const bad = cleanResult({ ...base, scores: { ja: [32] } }, e);
  assert.deepEqual(bad, { ok: false, reason: 'bad_score', detail: '国語1' });
  assert.equal(cleanResult({ ...base, campus: '県中' }, e).ok, false);
});

test('cleanExam：大問は1〜10・配点は1〜100の整数', () => {
  const ok = cleanExam({ name: ' 2026 本番レベル模試 12月 ', date: '2026-12-13', subjects: DEFAULT_SUBJECTS, schedule: [{ label: '国語', time: '9:00〜9:50' }, { label: '', time: '' }] });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.name, '2026 本番レベル模試 12月');
    assert.equal(ok.value.schedule.length, 1);
  }
  const noQ = cleanExam({ name: 'x', subjects: DEFAULT_SUBJECTS.map((s) => (s.key === 'ma' ? { ...s, questions: [] } : s)) });
  assert.deepEqual(noQ, { ok: false, reason: 'bad_questions', detail: '数学' });
  assert.deepEqual(cleanExam({ name: '' }), { ok: false, reason: 'no_name' });
});

test('入力シートの形の書き出し：性別は 0/1、計と合計を入れる', () => {
  const e = exam();
  const rows = inputSheetRows(e, [res({ examNo: '514401', name: '山田　太郎', gender: '女', choices: ['40200', '佐世保西', '', ''], s: { ja: [31, 17, 34, 18] } })], (v) => (v === '40200' ? '佐世保北' : v));
  assert.equal(rows[0].length, 12 + (4 + 1) + (4 + 1) + (5 + 1) + (5 + 1) + (6 + 1) + 1);
  const r = rows[1];
  assert.equal(r[3], 1);
  assert.deepEqual(r.slice(4, 12), ['40200', '', '', '', '佐世保北', '佐世保西', '', '']);
  assert.equal(r[16], 100); // 国語計
  assert.equal(r[r.length - 1], 100);
});

test('jpDate・emptyScores', () => {
  assert.equal(jpDate('2026-11-22'), '2026年11月22日（日）');
  assert.equal(jpDate(''), '');
  assert.equal(emptyScores(exam()).sc.length, 6);
});
