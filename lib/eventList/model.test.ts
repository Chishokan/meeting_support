// イベント申込管理の決まり（model.ts）のテスト。  npm test
// ★氏名はすべて架空。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoPriority, buildRows, campusList, cleanTrackFields, daysUntil, effectivePriority, emptyTrack, mapFormColumns, matchApplications,
  normCampus, normGrade, normName, parseApplications, parseRoster, shortDay, sortRows, summarize, trackFromSheet,
  type Student, type Track,
} from './model.ts';

const WORDS = { pharma: ['薬'], medical: ['医', '看護', '療法士', '歯科'] };
const COL = { no: '№', campus: '所属校舎', school: '中学校名', grade: '学年', name: '生徒名', dream: '夢・志', hope: '志望校', studentId: 'student_id' };

const st = (key: string, name: string, campus = '駅前校', grade = '中1', dream = '', hope = ''): Student =>
  ({ key, studentId: key, campus, school: '', grade, name, dream, hope });
const tr = (key: string, f: Partial<Track> = {}): Track => ({ ...emptyTrack(key), ...f });

test('normName：空白・全角半角・異体字をそろえる', () => {
  assert.equal(normName(' 髙橋　花子 '), '高橋花子');
  assert.equal(normName('山﨑 太郎'), normName('山崎太郎'));
  assert.equal(normName('濵田ｱｲ'), '浜田アイ');
});

test('normCampus・normGrade', () => {
  assert.equal(normCampus('智翔館 佐世保駅前校'), '駅前');
  assert.equal(normCampus('駅前校'), '駅前');
  assert.equal(normCampus('県中'), '県中');
  assert.equal(normGrade('中１'), '中1');
  assert.equal(normGrade('中学2年'), '中2');
  assert.equal(normGrade('高校1年生'), '高1');
  assert.equal(normGrade('年長'), '年長');
});

test('parseRoster：「例」の行・氏名なし・重複を捨て、校舎なしは未分類', () => {
  const rows = [
    { '№': '例', 所属校舎: '駅前校', 生徒名: '見本 太郎', 学年: '中２' },
    { '№': '1', 所属校舎: '県中', 中学校名: '北', 学年: '中１', 生徒名: '青空　花', '夢・志': '薬剤師', 志望校: '九大', student_id: 'S001' },
    { '№': '2', 所属校舎: '県中', 生徒名: '', student_id: 'S002' },
    { '№': '', 所属校舎: '', 生徒名: '森 一', 学年: '中３' },
    { '№': '9', 所属校舎: '日野校', 生徒名: '青空 花', student_id: 'S001' },
  ];
  const r = parseRoster(rows, COL, '未分類');
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { key: 'S001', studentId: 'S001', campus: '県中', school: '北', grade: '中1', name: '青空 花', dream: '薬剤師', hope: '九大' });
  assert.equal(r[1].key, '未分類|森一');
  assert.equal(r[1].campus, '未分類');
});

test('重点：夢・志と志望校から見分ける。氏名の「薬」は見ない。手入力で付け外しできる', () => {
  assert.equal(autoPriority({ dream: '薬剤師', hope: '' }, WORDS), 'pharma');
  assert.equal(autoPriority({ dream: '決まっていない', hope: '九大　薬' }, WORDS), 'pharma');
  assert.equal(autoPriority({ dream: '助産師、看護師', hope: '' }, WORDS), 'medical');
  assert.equal(autoPriority({ dream: 'パン屋さん', hope: '佐世保南' }, WORDS), '');
  const yakushiji = st('k', '薬師寺 そら', '日野校', '中2', 'パン屋さん', '');
  assert.equal(autoPriority(yakushiji, WORDS), '');
  assert.equal(effectivePriority(yakushiji, { priority: '1' }, WORDS), 'manual');
  assert.equal(effectivePriority({ dream: '医者', hope: '' }, { priority: '0' }, WORDS), '');
  assert.equal(effectivePriority({ dream: '医者', hope: '' }, { priority: '1' }, WORDS), 'medical');
});

test('campusList：決まった順、知らない校舎は後ろ、未分類は最後', () => {
  const list = [st('1', 'a', '未分類'), st('2', 'b', '新校舎'), st('3', 'c', '日野校'), st('4', 'd', '駅前校')];
  assert.deepEqual(campusList(list, ['駅前校', '日野校'], '未分類'), ['駅前校', '日野校', '新校舎', '未分類']);
});

test('cleanTrackFields：知らない項目と形の違う値を捨てる', () => {
  assert.deepEqual(
    cleanTrackFields({ flyer: '2026-11-17', talk: '11/17', reaction: '行くかも', applied: 1, priority: '2', memo: ' あとで ', x: 1 }),
    { flyer: '2026-11-17', talk: '', reaction: '', applied: '1', priority: '', memo: 'あとで' },
  );
  assert.deepEqual(cleanTrackFields({ reaction: '検討中' }), { reaction: '検討中' });
});

test('trackFromSheet：シートが日付に読み替えた値もそろえる', () => {
  const t = trackFromSheet({ 生徒キー: 'S001', チラシ: '2026/11/7', 声掛け: '2026-11-17', 反応: '検討中', 申込: '1', 重点: '', メモ: 'm', 更新日時: '2026/11/17 10:00', 更新者: '太田' });
  assert.equal(t.flyer, '2026-11-07');
  assert.equal(t.talk, '2026-11-17');
  assert.equal(t.reaction, '検討中');
  assert.equal(t.applied, '1');
});

test('mapFormColumns：質問の文言から列を当てる', () => {
  const c = mapFormColumns(['タイムスタンプ', 'メールアドレス', '生徒氏名', 'ふりがな', '学年', '通っている校舎', '学校名', '保護者の参加人数', '保護者氏名']);
  assert.deepEqual(c, { at: 0, name: 2, parentName: 8, campus: 5, grade: 4, school: 6, who: -1, parentFlags: [7] });
  const d = mapFormColumns(['タイムスタンプ', 'お名前', 'お名前（フリガナ）', '参加される方', '学年']);
  assert.equal(d.name, 1);
  assert.equal(d.who, 3);
});

test('parseApplications：生徒・保護者の参加を読む', () => {
  const headers = ['タイムスタンプ', '生徒氏名', '学年', '校舎', '保護者の参加人数', '保護者氏名'];
  const apps = parseApplications(headers, [
    ['2026/11/18 10:00:00', '青空　花', '中１', '県中', '1', '青空 母'],
    ['2026/11/18 11:00:00', '森 一', '中学3年', '駅前校', '0', ''],
    ['2026/11/18 12:00:00', '', '', '', '2', '川 親'],
    ['', '', '', '', '', ''],
  ]);
  assert.equal(apps.length, 3);
  assert.deepEqual([apps[0].student, apps[0].parent, apps[0].grade], [true, true, '中1']);
  assert.deepEqual([apps[1].student, apps[1].parent, apps[1].grade], [true, false, '中3']);
  assert.deepEqual([apps[2].name, apps[2].student, apps[2].parent], ['川 親', false, true]);
  assert.equal(apps[0].id, '2026/11/18 10:00:00|青空花');

  const who = parseApplications(['タイムスタンプ', 'お名前', '参加される方'], [
    ['t1', '青空 花', '生徒と保護者'], ['t2', '森 一', '保護者のみ'], ['t3', '海 二', '生徒のみ'],
  ]);
  assert.deepEqual(who.map((a) => [a.student, a.parent]), [[true, true], [false, true], [true, false]]);
});

test('matchApplications：氏名で結び、同姓同名は校舎・学年で決め、決まらなければ名簿外', () => {
  const students = [st('S1', '髙橋 花子', '駅前校', '中1'), st('S2', '森 一', '駅前校', '中2'), st('S3', '森 一', '日野校', '中2'), st('S4', '海 二', '大野校', '中3')];
  const apps = parseApplications(['タイムスタンプ', '生徒氏名', '校舎', '学年'], [
    ['t1', '高橋花子', '', ''],
    ['t2', '森　一', '佐世保駅前校', ''],
    ['t3', '森 一', '', '中2'],
    ['t4', '外部 太郎', '', ''],
    ['t5', 'うみ じ', '', ''],
  ]);
  const tracks = new Map<string, Track>([['S4', tr('S4', { link: apps[4].id })]]);
  const m = matchApplications(students, tracks, apps);
  assert.deepEqual(m.byStudent.get('S1')?.map((a) => a.at), ['t1']);
  assert.deepEqual(m.byStudent.get('S2')?.map((a) => a.at), ['t2']);
  assert.equal(m.byStudent.get('S3'), undefined);
  assert.deepEqual(m.byStudent.get('S4')?.map((a) => a.at), ['t5']);
  assert.deepEqual(m.unmatched.map((a) => a.at), ['t3', 't4']);
});

test('buildRows：段階と次にすること', () => {
  const students = [
    st('A', '青空 花', '駅前校', '中1', '薬剤師'), st('B', '森 一', '駅前校', '中2'), st('C', '海 二', '駅前校', '中3'),
    st('D', '川 三', '駅前校', '中3', '看護師'), st('E', '山 四', '駅前校', '中1'), st('F', '谷 五', '駅前校', '中1'),
  ];
  const tracks = [
    tr('B', { flyer: '2026-11-17' }),
    tr('C', { flyer: '2026-11-17', talk: '2026-11-17', reaction: '検討中' }),
    tr('D', { flyer: '2026-11-17', talk: '2026-11-17', reaction: '不参加' }),
    tr('F', { applied: '1' }),
  ];
  const apps = parseApplications(['タイムスタンプ', '生徒氏名', '保護者の参加人数', '保護者氏名'], [['t1', '', '1', '山 親']]);
  tracks.push(tr('E', { link: apps[0].id }));
  const { rows, unmatched } = buildRows(students, tracks, apps, WORDS);
  const by = Object.fromEntries(rows.map((r) => [r.student.key, r]));
  assert.equal(unmatched.length, 0);
  assert.deepEqual([by.A.stage, by.A.urgent, by.A.priority], ['none', true, 'pharma']);
  assert.match(by.A.todo, /チラシを渡して、直接声を掛ける/);
  assert.deepEqual([by.B.stage, by.B.todo], ['flyer', '声を掛けて反応を聞く']);
  assert.deepEqual([by.C.stage, by.C.todo], ['considering', '保護者へ案内して後押しする']);
  assert.deepEqual([by.D.stage, by.D.todo, by.D.urgent], ['declined', '', false]);
  assert.deepEqual([by.E.stage, by.E.studentApplied, by.E.parentApplied], ['applied', false, true]);
  assert.match(by.E.todo, /保護者のみ申込/);
  assert.deepEqual([by.F.stage, by.F.studentApplied, by.F.todo], ['applied', true, '']);

  // 並び：重点でまだ決まっていない人が先頭、済んだ人（申込済・不参加）は後ろ
  const order = sortRows(rows).map((r) => r.student.key);
  assert.equal(order[0], 'A');
  assert.deepEqual(order.slice(-2).sort(), ['D', 'F']);

  const sum = summarize('駅前校', rows);
  assert.deepEqual(
    [sum.total, sum.flyer, sum.talked, sum.considering, sum.declined, sum.applied, sum.studentApplied, sum.parentApplied, sum.untouched, sum.todo],
    [6, 3, 4, 1, 1, 2, 1, 1, 1, 4],
  );
  assert.deepEqual([sum.priority, sum.priorityTalked, sum.priorityApplied, sum.priorityOpen], [2, 1, 0, 1]);
});

test('daysUntil・shortDay', () => {
  assert.equal(daysUntil('2026-12-03', '2026-11-17'), 16);
  assert.equal(daysUntil('2026-12-03', '2026-12-03'), 0);
  assert.equal(daysUntil('2026-12-03', '2026-12-04'), -1);
  assert.equal(daysUntil('', '2026-12-04'), null);
  assert.equal(shortDay('2026-11-07'), '11/7');
});
