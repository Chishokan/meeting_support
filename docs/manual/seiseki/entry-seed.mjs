// 成績管理「成績入力」マニュアルの写真用の架空のデータ（実在の生徒ではない）を .data/moshi.json に作る。
//   node --experimental-strip-types docs/manual/seiseki/entry-seed.mjs（配点は lib/moshi/model.ts から読む）
// 回：2026 本番レベル模試 11月。名簿：日野校 0001〜0008（氏名は架空）。
// 得点：国語は全員、英語は6人、数学は4人と1人途中（0005）、社会・理科はまだ（写真の中で入れる）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_BELONGINGS, DEFAULT_JUDGE_OPTIONS, DEFAULT_NOTES, DEFAULT_SCHEDULE, DEFAULT_SUBJECTS, SUBJECT_KEYS, emptyOutside } from '../../../lib/moshi/model.ts';

const exam = {
  id: 'exam-2026-11', name: '2026 本番レベル模試 11月', grade: '中3', date: '2026-11-22',
  subjects: DEFAULT_SUBJECTS, schedule: DEFAULT_SCHEDULE, belongings: DEFAULT_BELONGINGS, notes: DEFAULT_NOTES, venues: {},
  outside: emptyOutside(), judges: [], judgeOptions: { ...DEFAULT_JUDGE_OPTIONS },
  createdAt: '2026/11/01 09:00', createdBy: '智翔 花子', updatedAt: '', updatedBy: '',
};

const NAMES = ['智翔　一郎', '智翔　二葉', '智翔　三郎', '智翔　四季', '智翔　五月', '智翔　六花', '智翔　七海', '智翔　八雲'];
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const score = (max, a) => Math.max(0, Math.min(max, Math.round(max * (a + (rnd() - 0.5) * 0.3))));

const results = NAMES.map((name, i) => {
  const a = 0.45 + rnd() * 0.4;
  const scores = {};
  for (const k of SUBJECT_KEYS) {
    const qs = DEFAULT_SUBJECTS.find((s) => s.key === k).questions;
    const done = k === 'ja' || (k === 'en' && i < 6) || (k === 'ma' && i < 4);
    scores[k] = qs.map((q) => (done ? score(q.max, a) : null));
    if (k === 'ma' && i === 4) scores[k] = qs.map((q, j) => (j === 0 || j === 2 ? score(q.max, a) : null)); // 途中
  }
  return {
    id: `manual-${String(i + 1).padStart(4, '0')}`, examId: exam.id, campus: '日野校', examNo: String(i + 1).padStart(4, '0'), name,
    gender: i % 2 ? '女' : '男', choices: ['518-01', '', '', ''], scores, comment: '',
    createdAt: '2026/11/01 09:00', createdBy: '智翔 花子', updatedAt: '', updatedBy: '',
  };
});

mkdirSync('.data', { recursive: true });
writeFileSync('.data/moshi.json', JSON.stringify({ exams: [exam], results }, null, 2));
console.log('exams 1, results', results.length);
