// 本番レベル模試の計算（model.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  choiceRanks, cleanExam, cleanResult, computeStats, DEFAULT_JUDGE_OPTIONS, DEFAULT_SUBJECTS, devBins, judgeOf, parseRule, reportFigures, ruleMax,
  scoreBins, trendRows, yearExams, emptyOutside, emptyScores, examMax, fitScores, historyOf,
  campusOfVenue, cleanKenItem, devBinsOf, kenFitOf, kenFits, kenJudgeDetail, kenSchoolGroup, kenFirstChoiceMean, kenHistory, kenPoints, prevRecordFor, studentHistory, honbanFirstChoiceMean, pointsOf, kenChoiceRank, kenExamRef, kenNames, kenStatsOf, scoreBinsOf, kenExams, kenGuessFromFileName, kenIdMap, kenRoster, kenScores, kenTable, parseCsv, inputSheetRows, jpDate, nextExamNo, normalizeChoice, normalizeExamNo, normalizeName, parsePaste, parseScore, planPaste, rankedRows, scoresFromCell,
  scoresToCell, subjectMax, parseInputSheetCsv, toCsv, SUBJECT_KEYS,
  type MoshiExam, type MoshiResult, type Scores,
} from './model.ts';
import { REFERENCES, TO_REF, refSchoolByCode, refSchoolFor, referenceForDate } from './reference.ts';
import { PAST_EXAMS, matchPastQuestions, pastBinOf, pastBinRange, pastExamById, pastMax, pastN, pastRank } from './pastData.ts';

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

test('受験番号：県一斉模試と同じ校舎ごとの4桁。次の番号は校舎の中の最大＋1', () => {
  // こちらで付ける番号は 300番台（県一斉模試の 0001〜 と重ならない）
  assert.equal(nextExamNo('日宇校', ['0001', '0016', '0003']), '0301');
  assert.equal(nextExamNo('日宇校', ['0001', '0301', '0305']), '0306');
  assert.equal(nextExamNo('駅前校', []), '0301');
  const full = Array.from({ length: 100 }, (_, i) => String(300 + i).padStart(4, '0'));
  assert.equal(nextExamNo('日野校', full.filter((n) => n !== '0342')), '0342'); // 399 まで使っていれば空き
  assert.equal(nextExamNo('日野校', [...full, '0012']), '0400');
  assert.equal(normalizeExamNo('10'), '0010');
  assert.equal(normalizeExamNo('０００５'), '0005');
  assert.equal(normalizeExamNo('514410'), '0010'); // 前の入力シートの番号（日宇校の10番）
  assert.equal(normalizeExamNo(''), '');
  assert.equal(campusOfVenue('智翔館　佐世保駅前校'), '駅前校');
  assert.equal(campusOfVenue('智翔館　日宇校'), '日宇校');
  assert.equal(campusOfVenue('自立学習RED　佐世保日野教室'), ''); // RED・ネクスタは入れない
});

test('志望校コード：県一斉模試の形（518-01）にそろえ、前の入力シートの5桁は読み替える', () => {
  const legacy = (c: string) => (c === '40200' ? '518-01' : '');
  assert.equal(normalizeChoice('518-01'), '518-01');
  assert.equal(normalizeChoice('５１８ー０１'), '518-01');
  assert.equal(normalizeChoice('40200', legacy), '518-01');
  assert.equal(normalizeChoice('40400', legacy), '40400'); // 読み替えられないコードは残す
  assert.equal(normalizeChoice('佐世保北'), '佐世保北');
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
  const legacy = (c: string) => (c === '40200' ? '518-01' : '');
  const r = parsePaste('受験番号\t氏名\t性別\n0001\t山田 太郎\t0\t518-01\t佐世保西\n0002\t\t\n\t鈴木 花子\t1', e);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { examNo: '0001', name: '山田　太郎', gender: '男', choices: ['518-01', '佐世保西', '', ''], scores: null });
  // 前の入力シートの番号・コードは読み替える
  assert.deepEqual(parsePaste('514401\t山田 太郎\t0\t40200', e, legacy).rows[0].choices, ['518-01', '', '', '']);
  assert.equal(parsePaste('514401\t山田 太郎', e).rows[0].examNo, '0001');
  assert.equal(parsePaste('5\t山田 太郎', e).rows[0].examNo, '0005');
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
  assert.equal(row.examNo, '0010');
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
  const base = { id: 'abcdef12-3456', campus: '日宇校', examNo: '１２', name: '山田 太郎', gender: '0', choices: ['５１８ー０１'] };
  const ok = cleanResult({ ...base, scores: { ja: [31, 17, 34, 18] } }, e);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.examNo, '0012');
    assert.equal(ok.value.name, '山田　太郎');
    assert.deepEqual(ok.value.choices, ['518-01', '', '', '']);
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

test('入力シートの CSV：書き出したものをそのまま取り込める（校舎の列で今の校舎の行だけ）', () => {
  const e = exam();
  const rs = [
    res({ examNo: '0001', name: '山田　太郎', gender: '女', choices: ['518-01', '佐世保西', '', ''], s: { ja: [31, 17, 34, 18], sc: [10, 0, null, 5, 8, 9] } }, e),
    res({ examNo: '0301', name: '佐藤　次郎', gender: '男' }, e),
    res({ examNo: '0002', name: '鈴木　花子', campus: '大野校', s: { en: [20, 20, 20, 20] } }, e),
  ];
  const csv = toCsv(inputSheetRows(e, rs, (v) => (v === '518-01' ? '佐世保北' : v)));
  const r = parseInputSheetCsv(csv, e, '日宇校');
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], {
    examNo: '0001', name: '山田　太郎', gender: '女', choices: ['518-01', '佐世保西', '', ''],
    scores: { ja: [31, 17, 34, 18], en: [null, null, null, null], ma: [null, null, null, null, null], so: [null, null, null, null, null], sc: [10, 0, null, 5, 8, 9] },
  });
  assert.deepEqual(r.rows[1], { examNo: '0301', name: '佐藤　次郎', gender: '男', choices: ['', '', '', ''], scores: null });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /大野校 1人/);
  // 名簿への当て方は貼り付けと同じ
  const plan = planPaste(r.rows, rs.slice(0, 2));
  assert.equal(plan.update.length, 2);
  assert.equal(plan.add.length, 0);
});

test('入力シートの CSV：Excel で直したもの（頭の0が落ちた・計が古いまま・Shift_JIS 由来の見出しの空白）', () => {
  const e = exam();
  const csv = toCsv(inputSheetRows(e, [res({ examNo: '0007', name: '山田　太郎', s: { ja: [31, 17, 34, 18] } }, e)], (v) => v));
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n').map((l) => l.split(','));
  lines[0][2] = '氏 名';
  lines[1][1] = '7';
  lines[1][12] = '30'; // 国語1 を 31 → 30（国語計は 100 のまま）
  lines[1][17] = '25'; // 英語1 を足す
  const r = parseInputSheetCsv(lines.map((l) => l.join(',')).join('\n'), e, '日宇校');
  assert.equal(r.warnings.length, 0);
  assert.equal(r.rows[0].examNo, '0007');
  assert.equal(r.rows[0].name, '山田　太郎');
  assert.deepEqual(r.rows[0].scores?.ja, [30, 17, 34, 18]);
  assert.deepEqual(r.rows[0].scores?.en, [25, null, null, null]);
});

test('入力シートの CSV：大問の数が違う教科は読まない・配点超え・同じ番号・見出しの無い CSV', () => {
  const e = exam();
  const csv = toCsv(inputSheetRows(e, [
    res({ examNo: '0001', name: '山田　太郎', s: { ja: [31, 17, 34, 18], ma: [10, 10, 10, 10, 10] } }, e),
    res({ examNo: '0001', name: '山田　二郎' }, e),
  ], (v) => v));
  const e6 = exam({ subjects: DEFAULT_SUBJECTS.map((s) => (s.key === 'ma' ? { ...s, questions: [...s.questions, { max: 10, topic: '' }] } : s)) });
  const r = parseInputSheetCsv(csv, e6, '日宇校');
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0].scores?.ja, [31, 17, 34, 18]);
  assert.deepEqual(r.rows[0].scores?.ma, [null, null, null, null, null, null]);
  assert.ok(r.warnings.some((w) => /数学の大問の列の数/.test(w)));
  assert.ok(r.warnings.some((w) => /同じ受験番号/.test(w)));

  const over = csv.replace('\r\n日宇校,0001,山田　太郎,,,,,,,,,,31,', '\r\n日宇校,0001,山田　太郎,,,,,,,,,,999,');
  const r2 = parseInputSheetCsv(over, e, '日宇校');
  assert.equal(r2.rows[0].scores?.ja[0], null);
  assert.ok(r2.warnings.some((w) => /国語1 の得点が読めない/.test(w)));

  // 見出しの無い CSV は貼り付けと同じに読む
  const plain = parseInputSheetCsv('0001,山田 太郎,0,518-01\n0002,鈴木 花子,1', e, '日宇校');
  assert.deepEqual(plain.rows.map((x) => [x.examNo, x.name, x.gender, x.choices[0]]), [['0001', '山田　太郎', '男', '518-01'], ['0002', '鈴木　花子', '女', '']]);
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
  assert.deepEqual(t.map((x) => x.key), ['e7', 'e11', 'e1']);
  assert.deepEqual(t.map((x) => x.current), [false, true, false]);
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
    assert.deepEqual(ok.value.outside, { source: '第2回 長崎県一斉模試', n: 967, mean: { ja: 55.4 }, sd: { k5: 81.7 }, ref: '' });
    assert.deepEqual(ok.value.judges, [{ code: '40200', ref: '518-01', refName: '県立佐世保北 普通科', rule: '国数英1.5倍', bDev: 57, bScore: 424, capacity: null }]);
    assert.deepEqual(ok.value.judgeOptions, { step: 4, spread: 5 });
  }
  assert.deepEqual(cleanExam({ name: 'x', subjects: DEFAULT_SUBJECTS, judges: [{ code: '40200', bDev: 'abc' }] }), { ok: false, reason: 'bad_judge', detail: '40200' });
  assert.deepEqual(cleanExam({ name: 'x', subjects: DEFAULT_SUBJECTS, judges: [{ code: '40200', rule: '面接' }] }), { ok: false, reason: 'bad_rule', detail: '40200 面接' });
  assert.deepEqual(cleanExam({ name: 'x', subjects: DEFAULT_SUBJECTS, outside: { n: '-1' } }), { ok: false, reason: 'bad_outside' });
  // 過去の実施データの id は英小文字・数字・ハイフンだけ残す
  const withRef = cleanExam({ name: 'x', subjects: DEFAULT_SUBJECTS, outside: { ref: 'shuki-2023-10' } });
  assert.ok(withRef.ok && withRef.value.outside.ref === 'shuki-2023-10');
  const badRef = cleanExam({ name: 'x', subjects: DEFAULT_SUBJECTS, outside: { ref: '<script>' } });
  assert.ok(badRef.ok && badRef.value.outside.ref === '');
});

// ---- 県一斉模試の取り込み（氏名と成績を一緒に扱わない） -----------------------------

const KEN_HEAD = 'ID,部門,会場名称,受験番号,氏名,性別,内申点,5科合計 得点,5科合計 偏差値,5科合計 順位,3科合計 得点,3科合計 偏差値,3科合計 順位,英語 得点,英語 偏差値,英語 順位,数学 得点,数学 偏差値,数学 順位,国語 得点,国語 偏差値,国語 順位,理科 得点,理科 偏差値,理科 順位,社会 得点,社会 偏差値,社会 順位,公立第1 コード,公立第1 志望校名称,公立第1 判定,公立第1 合格確率,公立第2 コード,公立第2 志望校名称,公立第2 判定,公立第2 合格確率,国・私立第1 コード,国・私立第1 志望校名称,国・私立第1 判定,国・私立第1 合格確率,国・私立第2 コード,国・私立第2 志望校名称,国・私立第2 判定,国・私立第2 合格確率  ';
const kenRow = (id: string, venue: string, no: string, name: string, k5: string) =>
  `${id},中等部,${venue},${no},${name},男,,${k5},55.5,10,150,56.1,8,50,52.0,20,55,53.3,12,45,49.9,30,40,48.0,33,50,51.2,22,518-01,県立佐世保北　普通科,C,50%,520-01,県立佐世保西　普通科,A,80%,,,,,,,,`;
const META = { examId: 'ken-2026-10-01', examName: '長崎県一斉模試 2026年10月', date: '2026-10-01' };

test('parseCsv：BOM・ダブルクォート・セル内の改行・空行', () => {
  const rows = parseCsv('\uFEFFa,"b,1","c""d"\r\n\r\n"e\nf", g \n');
  assert.deepEqual(rows, [['a', 'b,1', 'c"d'], ['e\nf', 'g']]);
  assert.deepEqual(kenTable('A　 B,国・私立第2 合格確率  \n1,2').head, ['A B', '国・私立第2 合格確率']);
});

test('県一斉の成績：氏名の列があっても読まない。中等部の会場だけ、受験番号は4桁', () => {
  const csv = [KEN_HEAD,
    kenRow('M1', '智翔館　日野校', '12', '山田　太郎', '250'),
    kenRow('M2', '智翔館　佐世保駅前校', '0003', '鈴木　花子', '300'),
    kenRow('M3', '個別指導ネクスタ　佐世保駅前校', '0001', '佐藤　一郎', '200'),
    kenRow('M4', '自立学習RED　佐世保日野教室', '0002', '田中　次郎', '210'),
    kenRow('M5', '智翔館　大野校', '', '高橋　三郎', '220'),
  ].join('\n');
  const r = kenScores(kenTable(csv), META);
  assert.deepEqual(r.missing, []);
  assert.equal(r.other, 2);
  assert.equal(r.noNumber, 1);
  assert.deepEqual(r.items.map((x) => [x.campus, x.examNo]), [['日野校', '0012'], ['駅前校', '0003']]);
  const a = r.items[0];
  assert.equal(a.stats.k5.score, 250);
  assert.equal(a.stats.k5.dev, 55.5);
  assert.equal(a.stats.ja.score, 45);
  assert.equal(a.stats.en.rank, 20);
  assert.equal(a.choices[0].code, '518-01');
  assert.equal(a.choices[1].judge, 'A');
  assert.equal(a.choices[2].code, '');
  // 取り込む行に氏名は入らない
  assert.ok(!JSON.stringify(r.items).includes('山田'));
  assert.ok(!('name' in a));
});

test('県一斉の成績（受験番号の無いファイル）：氏名対応表から ID → 校舎・受験番号だけを引く', () => {
  const scores = 'ID,部門,会場名称,性別,内申点,5科合計 得点,5科合計 偏差値,5科合計 順位\nM1,中等部,智翔館　日宇校,女,,300,60.1,3\nM9,中等部,智翔館　日宇校,男,,100,40,90';
  const noMap = kenScores(kenTable(scores), META);
  assert.equal(noMap.items.length, 0);
  assert.deepEqual(noMap.missing, ['受験番号']);
  assert.equal(noMap.needMap, true);
  const roster = 'ID,会場名称,受験番号,氏名\nM1,智翔館　日宇校,0007,山田　太郎\nM2,自立学習RED　佐々教室,0001,鈴木　花子';
  const idMap = kenIdMap(kenTable(roster));
  assert.deepEqual([...idMap.entries()], [['M1', { campus: '日宇校', examNo: '0007' }]]);
  assert.ok(!JSON.stringify([...idMap.values()]).includes('山田'));
  const r = kenScores(kenTable(scores), META, idMap);
  assert.deepEqual(r.items.map((x) => [x.campus, x.examNo, x.gender, x.stats.k5.score]), [['日宇校', '0007', '女', 300]]);
  assert.equal(r.noNumber, 1); // M9 は対応表に無い
});

test('県一斉の名簿：校舎・受験番号・氏名だけ（成績の列は読まない）', () => {
  const csv = [KEN_HEAD, kenRow('M1', '智翔館　日野校', '12', '山田　太郎', '250'), kenRow('M4', '自立学習RED　佐世保日野教室', '0002', '田中　次郎', '210')].join('\n');
  const r = kenRoster(kenTable(csv));
  assert.deepEqual(r.rows, [{ campus: '日野校', examNo: '0012', name: '山田　太郎' }]);
  assert.equal(r.other, 1);
  assert.deepEqual(kenRoster(kenTable('会場名称,受験番号\n智翔館　日野校,1')).missing, ['氏名']);
});

test('県一斉の回の一覧・ファイル名から回名・API の1行の確かめ', () => {
  assert.deepEqual(kenGuessFromFileName('成績表_氏名なし_2026年10月_中等部.csv'), { name: '長崎県一斉模試 2026年10月', date: '2026-10-01' });
  assert.equal(kenGuessFromFileName('x.csv').date, '');
  const items = kenScores(kenTable([KEN_HEAD, kenRow('M1', '智翔館　日野校', '1', 'x', '250'), kenRow('M2', '智翔館　日野校', '2', 'y', '200')].join('\n')), META).items;
  assert.deepEqual(kenExams(items), [{ id: META.examId, name: META.examName, date: META.date, count: 2, byCampus: { '日野校': 2 } }]);
  const c = cleanKenItem({ ...items[0], name: '山田　太郎' }, META);
  assert.ok(c && !('name' in c));
  assert.equal(c?.stats.k5.score, 250);
  assert.equal(cleanKenItem({ ...items[0], campus: 'RED' }, META), null);
  assert.equal(cleanKenItem({ ...items[0], examNo: '' }, META), null);
  assert.equal(cleanKenItem({ ...items[0], stats: { k5: { score: 9999, dev: 55 } } }, META)?.stats.k5.score, null);
});

test('教科別偏差値推移に県一斉模試の回を日付順で混ぜる（校舎＋受験番号で結ぶ。氏名は使わない）', () => {
  const e11 = exam({ id: 'e11', name: '11月', date: '2026-11-22' });
  const me = res({ name: '山田　太郎', campus: '日野校', examNo: '0012', s: full([70, 70, 70, 70, 70]) }, e11);
  const list = [computeStats(e11, [me])];
  const csv = [KEN_HEAD, kenRow('M1', '智翔館　日野校', '0012', '別の名前', '250'), kenRow('M2', '智翔館　大野校', '0012', 'x', '100')].join('\n');
  const ken = [
    ...kenScores(kenTable(csv), { examId: 'ken-2026-10-18', examName: '長崎県一斉模試 2026年10月', date: '2026-10-18' }).items,
    ...kenScores(kenTable(csv), { examId: 'ken-2026-03-01', examName: '長崎県一斉模試 2026年3月', date: '2026-03-01' }).items, // 前の年度
  ];
  const t = trendRows(list, e11, me, ken);
  assert.deepEqual(t.map((x) => [x.kind, x.label]), [['ken', '10月'], ['honban', '11月']]);
  assert.equal(t[0].dev.k5, 55.5);
  assert.equal(t[0].dev.ja, 49.9);
  assert.equal(t[0].dev.ma, 53.3);
  // 受験番号が無ければ県一斉は空（氏名では結ばない）
  const t2 = trendRows(list, e11, { ...me, examNo: '' }, ken);
  assert.equal(t2[0].dev.k5, null);
});

test('県一斉模試の成績表：名簿から氏名、塾内順位・塾内平均、志望者の中の順位', () => {
  const csv = [KEN_HEAD,
    kenRow('M1', '智翔館　日野校', '0001', 'x', '300'),
    kenRow('M2', '智翔館　日野校', '0002', 'x', '250'),
    kenRow('M3', '智翔館　大野校', '0001', 'x', '250'),
  ].join('\n');
  const items = kenScores(kenTable(csv), META).items;
  items[2].choices[0] = { code: '608-01', name: '西海学園', judge: 'B', prob: '60%' };
  // 名簿：同じ人が2つの回にいれば新しい回の氏名。校舎がちがえば同じ受験番号でも別の人
  const e7 = exam({ id: 'e7', date: '2026-07-12' });
  const e11 = exam({ id: 'e11', date: '2026-11-22' });
  const names = kenNames([
    res({ examId: 'e11', campus: '日野校', examNo: '0001', name: '山田　太郎' }, e11),
    res({ examId: 'e7', campus: '日野校', examNo: '0001', name: '山田　太' }, e7),
    res({ examId: 'e11', campus: '大野校', examNo: '0001', name: '鈴木　花子' }, e11),
  ], [e7, e11]);
  assert.equal(names.get('日野校|0001'), '山田　太郎');
  const ks = kenStatsOf(items, META.examId, names)!;
  assert.equal(ks.rows.length, 3);
  assert.equal(ks.n.k5, 3);
  assert.equal(Math.round(ks.mean.k5! * 10) / 10, 266.7);
  const [a, b, c] = ks.rows;
  assert.deepEqual([a.name, b.name, c.name], ['山田　太郎', '', '鈴木　花子']);
  assert.deepEqual([a.inside.k5, b.inside.k5, c.inside.k5], [1, 2, 2]); // 同点は同じ順位
  // 518-01 は3人とも書いている（kenRow の公立第1）。608-01 は大野校の1人だけ
  assert.deepEqual(kenChoiceRank(ks, b, '518-01'), { n: 2, rank: 2 }); // c は第1を 608-01 に変えた
  assert.deepEqual(kenChoiceRank(ks, c, '608-01'), { n: 1, rank: 1 });
  assert.equal(kenChoiceRank(ks, a, ''), null);
  assert.equal(kenStatsOf(items, 'ken-none', names), null);
});

test('分布：得点（25点きざみ）と偏差値（2.5きざみ）は本番レベル模試と同じ作り', () => {
  const sb = scoreBinsOf([500, 250, 251, 0], 251, 500);
  assert.equal(sb.length, 20);
  assert.equal(sb[0].label, '476～500');
  assert.equal(sb[0].count, 1);
  assert.equal(sb.find((x) => x.label === '251～275')!.mine, true);
  assert.equal(sb[sb.length - 1].count, 1);
  const db = devBinsOf([80, 50, 51, 20], 51);
  assert.equal(db[0].label, '75.0以上');
  assert.equal(db[0].count, 1);
  assert.equal(db.find((x) => x.label === '50.0')!.count, 2);
  assert.equal(db.find((x) => x.label === '50.0')!.mine, true);
  assert.equal(db[db.length - 1].count, 1);
});

test('県一斉模試の回を「この回」にした推移：同じ年度の本番レベル模試の回も並び、県一斉の回が current', () => {
  const e11 = exam({ id: 'e11', name: '11月', date: '2026-11-22' });
  const me = res({ name: '山田　太郎', campus: '日野校', examNo: '0012', s: full([70, 70, 70, 70, 70]) }, e11);
  const list = [computeStats(e11, [me])];
  const csv = [KEN_HEAD, kenRow('M1', '智翔館　日野校', '0012', 'x', '250')].join('\n');
  const ken = [
    ...kenScores(kenTable(csv), { examId: 'ken-2026-08-23', examName: '長崎県一斉模試 2026年8月', date: '2026-08-23' }).items,
    ...kenScores(kenTable(csv), { examId: 'ken-2026-10-18', examName: '長崎県一斉模試 2026年10月', date: '2026-10-18' }).items,
  ];
  const t = trendRows(list, kenExamRef({ id: 'ken-2026-10-18', name: '長崎県一斉模試 2026年10月', date: '2026-10-18' }), { name: '山田　太郎', campus: '日野校', examNo: '0012' }, ken);
  assert.deepEqual(t.map((x) => [x.kind, x.label, x.current]), [['ken', '8月', false], ['ken', '10月', true], ['honban', '11月', false]]);
  assert.equal(t[2].dev.k5, 50); // 本番は氏名＋受験番号で同じ生徒を見つける
});

// 県一斉模試の1行（教科の得点・偏差値だけ）
function kenItem(examId: string, campus: string, examNo: string, sc: Partial<Record<'ja' | 'en' | 'ma' | 'so' | 'sc' | 'k3' | 'k5', [number, number]>>, codes: string[] = []) {
  const stats = {} as Record<string, { score: number | null; dev: number | null; rank: number | null }>;
  for (const key of ['ja', 'en', 'ma', 'so', 'sc', 'k3', 'k5']) {
    const v = (sc as Record<string, [number, number] | undefined>)[key];
    stats[key] = { score: v ? v[0] : null, dev: v ? v[1] : null, rank: null };
  }
  return {
    examId, examName: examId, date: '2026-10-18', campus, examNo, gender: '' as const, naishin: '',
    stats: stats as never, choices: [0, 1, 2, 3].map((i) => ({ code: codes[i] ?? '', name: '', judge: '', prob: '' })),
  };
}

test('県平均・標準偏差：得点と偏差値の組から当てはめる（25〜75 の外は使わない）', () => {
  const dev = (x: number) => 50 + (10 * (x - 264.3)) / 88.8; // 実際のファイルは0.1に丸めてあるが、行が多いので同じ値になる
  const items = [120, 180, 230, 264, 300, 350, 420, 480].map((x, i) => kenItem('ken-a', '日野校', String(i + 1).padStart(4, '0'), { k5: [x, dev(x)] }));
  items.push(kenItem('ken-a', '日野校', '0099', { k5: [500, 80] })); // 75 を超える偏差値は使わない
  const f = kenFitOf(items, 'ken-a', 'k5')!;
  assert.equal(Math.round(f.mean * 10) / 10, 264.3);
  assert.equal(Math.round(f.sd * 10) / 10, 88.8);
  assert.equal(f.n, 8);
  assert.equal(kenFitOf(items.slice(0, 3), 'ken-a', 'k5'), null); // 5つ未満
  assert.equal(kenFits(items, 'ken-a').ja, null);
});

test('判定の中身：判定得点・判定偏差値・基準まであと何点（業者の画面の数字と同じ）', () => {
  const fits = { ja: { mean: 57.8, sd: 15.2, n: 99 }, en: { mean: 49.0, sd: 22.3, n: 99 }, ma: { mean: 52.7, sd: 20.6, n: 99 }, so: { mean: 50.9, sd: 20.7, n: 99 }, sc: { mean: 53.7, sd: 21.5, n: 99 }, k3: null, k5: null };
  const k = kenItem('ken-a', '日野校', '0001', { en: [51, 50.9], ma: [55, 51.1], ja: [48, 43.5], sc: [57, 51.5], so: [66, 57.3] });
  const base = refSchoolByCode(REFERENCES[0], '518-01')!; // 県立佐世保北 普通科：国数英1.5倍・基準偏差値57・基準得点424
  const d = kenJudgeDetail(k, base, fits, true)!;
  assert.equal(d.score, 354);
  assert.equal(d.max, 650);
  assert.equal(d.dev, 50.9);
  assert.equal(d.bDev, 57);
  assert.equal(d.toB, 70);
  // 資料が別の回のものなら、判定偏差値・基準得点・あと何点は出さない
  const other = kenJudgeDetail(k, base, fits, false)!;
  assert.deepEqual([other.score, other.dev, other.bScore, other.toB], [354, null, null, null]);
  // 教科が欠けていれば判定得点は出ない
  assert.equal(kenJudgeDetail(kenItem('ken-a', '日野校', '0002', { en: [51, 50] }), base, fits, true)!.score, null);
  assert.equal(referenceForDate('2026-10-18')?.id, 'kenitsu-2026-10');
  assert.equal(referenceForDate('2026-08-23'), undefined);
});

test('塾内の志望者・第1志望者の平均・これまでの回', () => {
  const s5 = (x: number): [number, number] => [x, 50];
  const items = [
    kenItem('ken-a', '日野校', '0001', { ja: [80, 60], en: [70, 55], k5: s5(350) }, ['518-01', '', '608-01']),
    kenItem('ken-a', '日野校', '0002', { ja: [60, 50], en: [50, 50], k5: s5(300) }, ['520-01', '518-01']),
    kenItem('ken-a', '大野校', '0001', { ja: [40, 40], en: [30, 40], k5: s5(250) }, ['518-01']),
    { ...kenItem('ken-b', '日野校', '0001', { k5: s5(320) }), date: '2026-08-23' },
  ];
  const ks = kenStatsOf(items, 'ken-a', new Map())!;
  const me = ks.rows[1]; // 日野校 0002
  const g = kenSchoolGroup(ks, me, '518-01', null, {} as never, false)!;
  assert.deepEqual([g.n, g.rank], [3, 2]);
  assert.equal(kenSchoolGroup(ks, me, '', null, {} as never, false), null);
  const fc = kenFirstChoiceMean(ks, '518-01'); // 第1志望（公立第1・国私立第1）は 日野0001・大野0001
  assert.equal(fc.n, 2);
  assert.equal(fc.mean.ja, 60);
  assert.equal(fc.mean.en, 50);
  assert.equal(kenFirstChoiceMean(ks, '608-01').n, 1);
  assert.deepEqual(kenHistory(items, '日野校', '0001').map((x) => x.examId), ['ken-b', 'ken-a']);
});

test('成績のポイント：得意・のばしたい教科、前回からの上がり下がり、5教科の県平均との差', () => {
  const now = kenItem('ken-b', '日野校', '0001', { ja: [52, 46.2], en: [55, 52.7], ma: [81, 63.7], so: [34, 41.8], sc: [80, 62.2], k5: [302, 54.2] });
  const before = kenItem('ken-a', '日野校', '0001', { ja: [60, 53.0], en: [50, 49.0], ma: [75, 59.3], so: [60, 55.4], sc: [80, 62.0], k5: [320, 56.7] });
  const fits = { ja: null, en: null, ma: null, so: null, sc: null, k3: null, k5: { mean: 264.3, sd: 88.8, n: 99 } };
  const p = kenPoints(now, before, fits);
  assert.deepEqual(p.strong.map((x) => x.key), ['ma', 'sc']);
  assert.deepEqual(p.weak.map((x) => x.key), ['so', 'ja']);
  assert.deepEqual(p.up, [{ key: 'ma', diff: 4.4 }, { key: 'en', diff: 3.7 }]);
  assert.deepEqual(p.down, [{ key: 'so', diff: -13.6 }, { key: 'ja', diff: -6.8 }]); // 理科 +0.2 はどちらにも入れない
  assert.equal(p.vsMean, 37.7);
  const first = kenPoints(now, null, fits);
  assert.deepEqual([first.up.length, first.down.length], [0, 0]);
});

test('本番レベル模試の前回：この回より前のいちばん新しい回（11月なら10月の県一斉模試）', () => {
  const e7 = exam({ id: 'e7', name: '7月', date: '2026-07-12' });
  const e11 = exam({ id: 'e11', name: '2026 本番レベル模試 11月', date: '2026-11-22' });
  const me7 = res({ name: '山田　太郎', campus: '日野校', examNo: '0012', s: full([60, 60, 60, 60, 60]) }, e7);
  const me11 = res({ name: '山田　太郎', campus: '日野校', examNo: '0012', choices: ['518-01', '', '', ''], s: full([70, 70, 70, 70, 70]) }, e11);
  const list = [computeStats(e7, [me7]), computeStats(e11, [me11])];
  const ken = [
    { ...kenItem('ken-2026-10-18', '日野校', '0012', { ja: [52, 46.2], k5: [302, 54.2] }, ['518-01']), examName: '長崎県一斉模試 2026年10月', date: '2026-10-18' },
    { ...kenItem('ken-2026-08-23', '日野校', '0012', { k5: [290, 52.0] }), examName: '長崎県一斉模試 2026年8月', date: '2026-08-23' },
    { ...kenItem('ken-2026-10-18', '大野校', '0012', { k5: [100, 30] }), date: '2026-10-18' }, // 別の校舎の同じ番号は別の人
  ];
  ken[0].choices[0] = { code: '518-01', name: '県立佐世保北 普通科', judge: 'B-', prob: '64%' };
  const p = prevRecordFor(list, ken, e11, me11)!;
  assert.deepEqual([p.kind, p.label, p.rankLabel, p.stats.k5.score, p.stats.k5.dev, p.stats.ja.dev], ['ken', '10月県', '県内順位', 302, 54.2, 46.2]);
  assert.equal(p.choices?.[0].judge, 'B-');
  // 10月の県一斉が無ければ、その前の回（8月の県一斉）
  assert.equal(prevRecordFor(list, ken.slice(1), e11, me11)!.label, '8月県');
  // 県一斉模試が無ければ本番レベル模試の前の回
  const ph = prevRecordFor(list, [], e11, me11)!;
  assert.deepEqual([ph.kind, ph.label, ph.rankLabel, ph.stats.k5.score], ['honban', '7月', '塾内順位', 300]);
  assert.equal(prevRecordFor(list, ken, e7, me7), null); // 7月より前は無い
  // 過去テスト一覧：新しい順に県一斉と本番が並ぶ
  const h = studentHistory(list, ken, me11, (c) => c);
  assert.deepEqual(h.map((x) => `${x.kind}:${x.date}`), ['honban:2026-11-22', 'ken:2026-10-18', 'ken:2026-08-23', 'honban:2026-07-12']);
  assert.equal(h[1].rank, '');
  assert.equal(h[0].score5, 350);
  // 第1志望者の平均（本番）
  assert.deepEqual([honbanFirstChoiceMean(list[1], '518-01').n, honbanFirstChoiceMean(list[1], '518-01').mean.ja], [1, 70]);
  // 成績のポイント（本番の数字で）
  const pts = pointsOf({ ja: { dev: 60 }, en: { dev: 40 }, ma: { dev: 55 }, so: { dev: 50 }, sc: { dev: 45 }, k5: { score: 300 } }, { ja: { dev: 50 }, en: { dev: 45 } }, 264.3);
  assert.deepEqual(pts.strong.map((x) => x.key), ['ja', 'ma']);
  assert.deepEqual(pts.up, [{ key: 'ja', diff: 10 }]);
  assert.deepEqual(pts.down, [{ key: 'en', diff: -5 }]);
  assert.equal(pts.vsMean, 35.7);
});

test('受験しない：cleanResult で受け取り、集計（順位・平均・一覧）には入れない', () => {
  const e = exam();
  const a = res({ name: '山田　太郎', examNo: '0001', s: full([70, 70, 70, 70, 70]) }, e);
  const b = res({ name: '鈴木　花子', examNo: '0002', s: full([50, 50, 50, 50, 50]) }, e);
  const c = { ...res({ name: '佐藤　一郎', examNo: '0301' }, e), absent: true };
  const st = computeStats(e, [a, b, c]);
  assert.equal(st.rows.length, 2);
  assert.ok(!st.rows.some((x) => x.r.id === c.id));
  assert.equal(st.complete, 2);
  const ok = cleanResult({ id: 'row-abcdefgh', campus: '日宇校', examNo: '301', name: '佐藤　一郎', absent: true, scores: {} }, e);
  assert.ok(ok.ok && ok.value.absent === true && ok.value.examNo === '0301');
  const off = cleanResult({ id: 'row-abcdefgh', campus: '日宇校', name: 'x', scores: {} }, e);
  assert.ok(off.ok && off.value.absent === false);
});

// ---- 過去の実施データ（lib/moshi/pastData.ts） ----------------------------------

test('過去の実施データ：度数分布から出した平均点・標準偏差が帳票の値と合う（読み取りの確かめ）', () => {
  for (const p of PAST_EXAMS) {
    for (const k of ['ja', 'en', 'ma', 'so', 'sc', 'k3', 'k5'] as const) {
      const bins = p.bins[k];
      const step = p.step[k];
      const n = pastN(p, k);
      const mid = (i: number) => (pastBinRange(step, i)[0] + pastBinRange(step, i)[1]) / 2;
      const mean = bins.reduce((a, c, i) => a + c * mid(i), 0) / n;
      const sd = Math.sqrt(bins.reduce((a, c, i) => a + c * (mid(i) - mean) ** 2, 0) / n);
      // 階級の真ん中で数えるので、平均点は 1点・標準偏差は 0.5点 くらいまでの違いは出る
      assert.ok(Math.abs(mean - p.mean[k]) < 1, `${p.id} ${k} 平均 ${mean.toFixed(1)} / ${p.mean[k]}`);
      assert.ok(Math.abs(sd - p.sd[k]) < 0.5, `${p.id} ${k} 標準偏差 ${sd.toFixed(1)} / ${p.sd[k]}`);
      assert.ok(n > 700 && n <= 800);
    }
    // 設問別：配点の合計は100点、得点率の平均から出した平均点が帳票の平均点と合う
    for (const k of SUBJECT_KEYS) {
      const qs = p.questions[k];
      assert.equal(qs.reduce((a, q) => a + q.max, 0), 100, `${k} 配点`);
      const est = qs.reduce((a, q) => a + (q.max * q.rate) / 100, 0);
      assert.ok(Math.abs(est - p.mean[k]) < 1, `${k} 設問別から ${est.toFixed(1)} / ${p.mean[k]}`);
    }
  }
  assert.equal(pastN(PAST_EXAMS[0], 'k5'), 793);
  assert.equal(pastMax(PAST_EXAMS[0], 'k5'), 500);
  assert.equal(pastMax(PAST_EXAMS[0], 'k3'), 300);
  assert.equal(pastExamById('shuki-2023-10')?.held, '2023-10');
  assert.equal(pastExamById(''), undefined);
});

test('過去の実施データ：階級と県内のおよその順位', () => {
  const p = PAST_EXAMS[0];
  assert.equal(pastBinOf(25, 0), 0);
  assert.equal(pastBinOf(25, 25), 0);
  assert.equal(pastBinOf(25, 26), 1);
  assert.equal(pastBinOf(25, 500), 19);
  assert.deepEqual(pastBinRange(5, 0), [0, 5]);
  assert.deepEqual(pastBinRange(5, 19), [96, 100]);
  // 五教科 426〜450 に2人、それより上は0人 → 450点は1位、426点は2〜3位
  assert.deepEqual(pastRank(p, 'k5', 450), { rank: 1, n: 793 });
  assert.ok([2, 3].includes(pastRank(p, 'k5', 426)!.rank));
  // 帳票の得点順の一覧の「五教科の得点 → 県内順位」と、およそ合う（平均の違いが4位以内）
  const pairs: [number, number][] = [[415, 6], [394, 19], [386, 21], [380, 27], [374, 38], [365, 50], [361, 55], [359, 61], [357, 66], [349, 83], [340, 90]];
  const mae = pairs.reduce((a, [s, want]) => a + Math.abs(pastRank(p, 'k5', s)!.rank - want), 0) / pairs.length;
  assert.ok(mae <= 4, `平均の違い ${mae.toFixed(1)}`);
  // 満点の人は1位、0点はいちばん下のあたり
  assert.equal(pastRank(p, 'k5', 500)?.rank, 1);
  assert.ok((pastRank(p, 'k5', 0)?.rank ?? 0) >= 790);
  // 平均点くらいなら真ん中くらい
  const mid = pastRank(p, 'k5', 245)!.rank;
  assert.ok(mid > 330 && mid < 460, String(mid));
  // 満点が違う回・得点なしは出さない
  assert.equal(pastRank(p, 'ja', 50, 120), null);
  assert.equal(pastRank(p, 'ja', null), null);
  assert.ok(pastRank(p, 'ja', 50, 100));
});

test('過去の実施データ：回の大問と設問の行を結ぶ（2つの大問で1行も）', () => {
  const p = PAST_EXAMS[0];
  assert.deepEqual(matchPastQuestions([31, 17, 34, 18], p.questions.ja), [[0], [1], [2], [3]]);
  assert.deepEqual(matchPastQuestions([30, 14, 12, 19, 13, 12], p.questions.ma), [[0], [1], [2], [3], [4], [5]]);
  // 社会は 1・2 / 3・4 / 5・6 で1行
  assert.deepEqual(matchPastQuestions([20, 15, 17, 20, 14, 14], p.questions.so), [[0, 1], [2, 3], [4, 5]]);
  assert.deepEqual(matchPastQuestions([35, 37, 28], p.questions.so), [[0], [1], [2]]);
  // 配点・数が違えば null（別の問題）
  assert.equal(matchPastQuestions([30, 15, 15, 16, 24], p.questions.ma), null);
  assert.equal(matchPastQuestions([23, 19, 24, 17, 17], p.questions.so), null);
  assert.equal(matchPastQuestions([31, 17, 34], p.questions.ja), null);
  assert.equal(matchPastQuestions([31, 17, 34, 18, 5], p.questions.ja), null);
  // 2026年11月の初期値の大問は、国語・英語だけ合う
  const ok = DEFAULT_SUBJECTS.map((s) => [s.key, matchPastQuestions(s.questions.map((q) => q.max), p.questions[s.key]) != null]);
  assert.deepEqual(Object.fromEntries(ok), { ja: true, en: true, ma: false, so: false, sc: false });
});
