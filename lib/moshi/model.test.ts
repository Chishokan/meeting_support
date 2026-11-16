// 本番レベル模試の計算（model.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  choiceRanks, cleanExam, cleanResult, computeStats, DEFAULT_JUDGE_OPTIONS, DEFAULT_SUBJECTS, devBins, judgeOf, parseRule, reportFigures, ruleMax,
  scoreBins, trendRows, yearExams, emptyOutside, emptyScores, examMax, fitScores, historyOf,
  inputSheetRows, jpDate, nextExamNo, normalizeName, parsePaste, parseScore, planPaste, rankedRows, scoresFromCell,
  scoresToCell, subjectMax,
  type MoshiExam, type MoshiResult, type Scores,
} from './model.ts';
import { REFERENCES, TO_REF, refSchoolFor } from './reference.ts';

function exam(p: Partial<MoshiExam> = {}): MoshiExam {
  return {
    id: 'exam-11', name: '2026 本番レベル模試 11月', grade: '中3', date: '2026-11-22',
    subjects: DEFAULT_SUBJECTS, schedule: [], belongings: '', notes: '', venues: {}, outside: emptyOutside(), judges: [],
    judgeOptions: { ...DEFAULT_JUDGE_OPTIONS },
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

test('設問別の平均：その教科を受けた人の大問ごとの平均点（空欄は0点）', () => {
  const e = exam();
  const a = res({ name: 'A', s: { ma: [30, 0, 15, 0, 24] } });
  const b = res({ name: 'B', s: { ma: [0, 15, 0, 16, 0] } });
  const s = computeStats(e, [a, b, res({ name: 'C', s: { ja: [10] } })]);
  assert.deepEqual(s.overall.questionMean.ma, [15, 7.5, 7.5, 8, 12]);
  assert.equal(s.overall.sub.ma!.n, 2);
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

test('貼り付け：大問の数が違う回の形の行（計が合わない）は、得点を読まずに名簿だけ読む', () => {
  const e = exam();
  // 前の回の形：数学の大問が6つ（30,14,12,19,13,12）
  const old = [[29, 15, 32, 18], [27, 21, 5, 13], [30, 12, 9, 0, 6, 10], [16, 17, 14, 8, 14], [12, 9, 12, 18, 18, 12]];
  const cells: (number | string)[] = [];
  for (const s of old) cells.push(...s, s.reduce((a, b) => a + b, 0));
  const line = ['514001', '山田 太郎', '0', '40200', '', '', '', '', '', '', '', '佐世保北', '', '', '', ...cells, 380].join('\t');
  const r = parsePaste(line, e);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].scores, null);
  assert.equal(r.rows[0].name, '山田　太郎');
  assert.match(r.warnings[0], /数学の「計」が大問の合計と合いません/);
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

test('成績表の得点表：三教科（国英数）と五教科。業者の平均点・標準偏差があればその値で偏差値と母数を出す', () => {
  const rows = [
    res({ name: 'A', s: full([80, 70, 60, 50, 40]) }),
    res({ name: 'B', s: full([60, 60, 60, 60, 60]) }),
    res({ name: 'C', s: { ja: [10], en: [10], ma: [10] } }), // 三教科だけ
  ];
  const inside = computeStats(exam(), rows);
  const a = inside.rows.find((x) => x.r.name === 'A')!;
  assert.equal(a.total3, 210);
  assert.equal(a.rank3, 1);
  assert.equal(inside.overall.total3!.n, 3);
  const f = reportFigures(inside, a);
  assert.deepEqual(f.map((x) => x.label), ['国語', '英語', '数学', '社会', '理科', '三教科', '五教科']);
  assert.equal(f[5].score, 210);
  assert.equal(f[5].max, 300);
  assert.equal(f[6].n, 2);
  assert.equal(f[6].outside, false);

  const outside = computeStats(exam({ outside: { source: '', n: 967, mean: { ja: 55.4, k5: 244.8 }, sd: { k5: 80 } } }), rows);
  const fo = reportFigures(outside, outside.rows.find((x) => x.r.name === 'A')!);
  assert.equal(fo[0].mean, 55.4);
  assert.equal(fo[0].outside, true);
  assert.equal(fo[0].n, 967);
  assert.ok(Math.abs((fo[6].dev as number) - (50 + 10 * (300 - 244.8) / 80)) < 1e-9);
  assert.equal(fo[1].outside, false); // 英語は業者の値なし → 智翔館の平均
  assert.equal(fo[6].rank, 1);        // 順位は智翔館の中
});

const KEN = REFERENCES[0];
const withRef = (p: Partial<MoshiExam> = {}) => exam({ outside: { source: KEN.label, n: null, mean: { ...KEN.mean }, sd: { ...KEN.sd } }, ...p });

test('換算表：県一斉模試の平均点・標準偏差で換算し、25.0〜75.0 に収める（換算表の値と同じ）', () => {
  const s = computeStats(withRef(), [
    res({ name: 'A', s: { ja: [31, 17, 34, 18], en: [27, 30, 11, 32], ma: [30, 15, 15, 16, 24], so: [23, 19, 24, 17, 17], sc: [15, 15, 19, 18, 18, 15] } }), // 500点
    res({ name: 'B', s: full([80, 80, 80, 80, 80]) }), // 400点
    res({ name: 'C', s: full([19, 1, 0, 0, 0]) }),
  ]);
  const dev = (n: string, k: number) => reportFigures(s, s.rows.find((x) => x.r.name === n)!)[k].dev;
  assert.equal(dev('A', 6), 75);                          // 500点 → 75.0（上限）
  assert.equal(Math.round((dev('B', 6) as number) * 10) / 10, 65.3); // 400点 → 65.3
  assert.equal(Math.round((dev('A', 1) as number) * 10) / 10, 72.9); // 英語100点 → 72.9
  assert.equal(dev('C', 0), 25);                          // 国語19点 → 25.0（下限）
  assert.equal(reportFigures(s, s.rows[0])[0].mean, 57.8);
});

test('判定教科の読み取り：判定基準得点一覧の書き方と満点', () => {
  const e = exam();
  const max = (r: string) => ruleMax(e, parseRule(r)!);
  assert.equal(max('5科合計'), 500);
  assert.equal(max('3科合計'), 300);
  assert.equal(max('国数のみ'), 200);
  assert.equal(max('国数英1.5倍'), 650);
  assert.equal(max('数英1.5倍'), 600);
  assert.equal(max('国2倍'), 600);
  assert.equal(max('英数2倍、国理1.5倍'), 800);
  assert.equal(max('英語2倍、数国1.5倍'), 700);
  assert.deepEqual(parseRule('英数2倍、国理1.5倍'), { ja: 1.5, en: 2, ma: 2, so: 1, sc: 1.5 });
  assert.equal(parseRule('よく分からない'), null);
  assert.equal(parseRule('国数英1.5倍と面接'), null);
});

test('参考データ：判定基準の満点が判定教科と合い、入力シートのコードから学校が引ける', () => {
  const e = exam();
  assert.ok(KEN.schools.length > 150);
  for (const s of KEN.schools) {
    const w = parseRule(s.rule);
    assert.ok(w, `${s.ref} ${s.rule}`);
    assert.equal(ruleMax(e, w!), s.max, `${s.ref} ${s.name}`);
    assert.ok(s.bScore <= s.max);
  }
  assert.equal(new Set(KEN.schools.map((s) => s.ref)).size, KEN.schools.length);
  for (const [code, ref] of Object.entries(TO_REF)) assert.ok(KEN.schools.some((s) => s.ref === ref), `${code} → ${ref}`);
  assert.equal(refSchoolFor(KEN, '40200')!.name, '県立佐世保北 普通科');
  assert.equal(refSchoolFor(KEN, '43004')!.ref, '599-50');
  assert.equal(refSchoolFor(KEN, '40400'), undefined); // 学科が分からない
});

test('判定：判定教科の倍率をかけた得点を B判定基準と比べ、偏差値 step ずつで A〜E。定員から仮想順位', () => {
  const kita = KEN.schools.find((s) => s.ref === '518-01')!; // 県立佐世保北 国数英1.5倍 B 424/650（偏差値57）
  const judge = { code: '40200', ref: kita.ref, refName: kita.name, rule: kita.rule, bDev: kita.bDev, bScore: kita.bScore, capacity: 280 };
  const e = withRef({ judges: [judge], judgeOptions: { step: 3, spread: 5 } });
  const s = computeStats(e, [
    res({ name: 'A', choices: ['40200', '', '', ''], s: full([80, 70, 60, 60, 60]) }), // 1.5×(80+70+60)+60+60 = 435
    res({ name: 'B', choices: ['40200', '', '', ''], s: full([40, 30, 30, 30, 30]) }), // 1.5×100+60 = 210
    res({ name: 'C', choices: ['40200', '', '', ''], s: { ja: [10] } }),                // 英数が無い
  ]);
  const j = judgeOf(s, s.rows[0], '40200');
  // 平均（判定用）= 1.5×(57.8+49.0+52.7)+50.9+53.7 = 343.85、偏差値1あたり (424−343.85)/7 ≈ 11.45点
  assert.equal(j.score, 435);
  assert.equal(j.max, 650);
  assert.deepEqual(j.lines, { A: 459, B: 424, C: 390, D: 356 });
  assert.equal(j.grade, 'B');
  assert.deepEqual(j.next, { grade: 'A', gap: 24 });
  assert.ok(Math.abs((j.dev as number) - (50 + (435 - 343.85) / ((424 - 343.85) / 7))) < 1e-9);
  assert.deepEqual(j.rank, { rank: 119, capacity: 280 }); // 偏差値 57.96：真ん中（57）より少し上
  const b = judgeOf(s, s.rows[1], '40200');
  assert.equal(b.grade, 'E');
  assert.deepEqual(b.next, { grade: 'D', gap: 146 });
  assert.equal(b.rank!.rank, 280);                         // 定員のいちばん下に収める
  assert.equal(judgeOf(s, s.rows[2], '40200').grade, null); // 判定教科がそろっていない
  assert.equal(judgeOf(s, s.rows[0], '40300').line, null);  // 基準が無い学校
  const noCap = computeStats(withRef({ judges: [{ ...judge, capacity: null }] }), [res({ s: full([80, 70, 60, 60, 60]) })]);
  assert.equal(judgeOf(noCap, noCap.rows[0], '40200').rank, null);
});

test('得点の分布は25点きざみで高い点から、偏差値の分布は2.5きざみ', () => {
  const rows = [res({ name: 'A', s: full([100, 100, 100, 100, 100]) }), res({ name: 'B', s: full([5, 5, 5, 5, 5]) }), res({ name: 'C', s: full([50, 50, 50, 50, 51]) })];
  const s = computeStats(exam(), rows);
  const bins = scoreBins(s, s.rows.find((x) => x.r.name === 'C')!);
  assert.equal(bins.length, 20);
  assert.equal(bins[0].label, '476～500');
  assert.equal(bins[0].count, 1);
  assert.equal(bins[19].label, '0～25');
  assert.equal(bins[19].count, 1); // B（25点）は「0～25」
  assert.equal(bins[18].count, 0); // 「26～50」
  assert.ok(bins.find((b) => b.mine)!.label === '251～275');
  const d = devBins(s, s.rows[0]);
  assert.equal(d[0].label, '75.0以上');
  assert.equal(d[d.length - 1].label, '25.0未満');
  assert.equal(d.reduce((a, b) => a + b.count, 0), 3);
  assert.equal(d.filter((b) => b.mine).length, 1);
});

test('教科別偏差値推移：同じ年度・学年の回を古い順に。受けていない回は空', () => {
  const e7 = exam({ id: 'e7', name: '7月', date: '2026-07-12' });
  const e11 = exam({ id: 'e11', name: '11月', date: '2026-11-22' });
  const e1 = exam({ id: 'e1', name: '1月', date: '2027-01-17' });
  const old = exam({ id: 'old', name: '前年度', date: '2026-02-01' });
  const me7 = res({ name: '山田　太郎', examNo: '514401', s: full([60, 60, 60, 60, 60]) }, e7);
  const other7 = res({ name: '鈴木　花子', examNo: '514402', s: full([40, 40, 40, 40, 40]) }, e7);
  const me11 = res({ name: '山田　太郎', examNo: '514401', s: full([70, 70, 70, 70, 70]) }, e11);
  const all = [me7, other7, me11];
  const list = [e1, e11, e7, old].map((e) => computeStats(e, all));
  assert.deepEqual(yearExams(list.map((x) => x.exam), e11).map((e) => e.id), ['e7', 'e11', 'e1']);
  const t = trendRows(list, e11, me11);
  assert.deepEqual(t.map((x) => x.exam.id), ['e7', 'e11', 'e1']);
  assert.ok((t[0].dev.k5 as number) > 50);
  assert.equal(t[1].dev.k5, 50); // 11月は1人だけ
  assert.equal(t[2].dev.ja, null);
});

test('cleanExam：換算の基準と判定基準', () => {
  const ok = cleanExam({
    name: 'x', subjects: DEFAULT_SUBJECTS,
    outside: { source: ' 第2回 長崎県一斉模試 ', n: '967', mean: { ja: '55.4', k5: '' }, sd: { k5: '81.7' } },
    judges: [{ code: '４０２００', ref: '518-01', refName: '県立佐世保北 普通科', rule: '国数英1.5倍', bDev: '57', bScore: '424', capacity: '' }, { code: '', bDev: '1' }],
    judgeOptions: { step: '4', spread: '' },
  });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.value.outside, { source: '第2回 長崎県一斉模試', n: 967, mean: { ja: 55.4 }, sd: { k5: 81.7 } });
    assert.deepEqual(ok.value.judges, [{ code: '40200', ref: '518-01', refName: '県立佐世保北 普通科', rule: '国数英1.5倍', bDev: 57, bScore: 424, capacity: null }]);
    assert.deepEqual(ok.value.judgeOptions, { step: 4, spread: 5 });
  }
  assert.deepEqual(cleanExam({ name: 'x', subjects: DEFAULT_SUBJECTS, judges: [{ code: '40200', bDev: 'abc' }] }), { ok: false, reason: 'bad_judge', detail: '40200' });
  assert.deepEqual(cleanExam({ name: 'x', subjects: DEFAULT_SUBJECTS, judges: [{ code: '40200', rule: '面接' }] }), { ok: false, reason: 'bad_rule', detail: '40200 面接' });
  assert.deepEqual(cleanExam({ name: 'x', subjects: DEFAULT_SUBJECTS, outside: { n: '-1' } }), { ok: false, reason: 'bad_outside' });
});
