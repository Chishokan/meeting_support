// イベント申込管理（/event）の決まりと計算。画面・API・テストから使う（ここは import を持たない＝ npm test でそのまま動く）。
//
//   名簿（Student）       … 名簿のスプレッドシートの1行＝生徒1人。夢・志／志望校から「重点」を見分ける
//   声掛けの記録（Track） … 生徒1人につき1行。チラシ・声掛け・反応・保護者への案内・手入力の申込・メモ
//   申込（Application）   … Google フォームの回答1件。氏名（＋校舎）で名簿の生徒に結び付ける
//   StudentRow            … 上の3つを合わせた、画面の1行（次にすること・段階つき）
//
// ★イベントの中身・重点の言葉・名簿の列の名前は lib/eventList/event.ts。

// ---- 型 -------------------------------------------------------------------

export type Student = {
  key: string;       // 記録を結ぶ鍵。student_id があればそれ、無ければ「校舎|氏名（空白なし）」
  studentId: string;
  campus: string;    // 所属校舎
  school: string;    // 中学校名
  grade: string;     // 中１ → 中1 にそろえる
  name: string;
  dream: string;     // 夢・志
  hope: string;      // 志望校
};

export type Reaction = '' | '参加したい' | '検討中' | '不参加';
export const REACTIONS: Reaction[] = ['', '参加したい', '検討中', '不参加'];

export type Track = {
  key: string;
  flyer: string;     // チラシを渡した日（YYYY-MM-DD）。まだなら空
  talk: string;      // 声を掛けた日
  reaction: Reaction;
  parent: string;    // 保護者へ案内した日
  applied: string;   // 手入力の申込（'1'＝申込済。フォームの回答と結べないとき・口頭や紙の申込）
  link: string;      // 名簿外になった申込を、この生徒に結び付けたときの申込ID（複数は改行で区切る）
  priority: string;  // 重点の手入力（''＝自動、'1'＝重点にする、'0'＝重点から外す）
  memo: string;
  updatedAt: string;
  updatedBy: string;
};

export type TrackField = 'flyer' | 'talk' | 'reaction' | 'parent' | 'applied' | 'link' | 'priority' | 'memo';
export const TRACK_FIELDS: TrackField[] = ['flyer', 'talk', 'reaction', 'parent', 'applied', 'link', 'priority', 'memo'];

export type Application = {
  id: string;          // 「回答日時|氏名（空白なし）」
  at: string;          // 回答日時（フォームの表示のまま）
  name: string;        // 生徒の氏名（無ければ保護者の氏名）
  campus: string;
  grade: string;
  school: string;
  parentName: string;
  student: boolean;    // 生徒が参加する
  parent: boolean;     // 保護者が参加する
  answers: [string, string][]; // 見出しと回答（詳細に出す。メール・電話なども入る）
};

export type PriorityKind = '' | 'pharma' | 'medical' | 'manual';
export type PriorityWords = { pharma: string[]; medical: string[] };

// 段階：どこまで進んだか（集計・絞り込みに使う）
export type Stage = 'applied' | 'declined' | 'wants' | 'considering' | 'talked' | 'flyer' | 'none';
export const STAGE_LABEL: Record<Stage, string> = {
  applied: '申込済', declined: '不参加', wants: '参加したい', considering: '検討中',
  talked: '声掛け済', flyer: 'チラシ配布済', none: '未着手',
};

export type StudentRow = {
  student: Student;
  track: Track;
  priority: PriorityKind;
  apps: Application[];       // この生徒に結び付いた申込
  studentApplied: boolean;   // 生徒の申込（フォーム or 手入力）
  parentApplied: boolean;    // 保護者の申込（フォーム）
  stage: Stage;
  todo: string;              // 次にすること（無ければ空）
  urgent: boolean;           // 重点で、まだ申込も不参加も決まっていない
};

// ---- 小物 -----------------------------------------------------------------

const s = (v: unknown) => (v == null ? '' : String(v).trim());

// 氏名を照合するときにそろえる異体字（左を右に読み替える）
const KANJI_VARIANTS: [string, string][] = [
  ['髙', '高'], ['﨑', '崎'], ['濵', '浜'], ['濱', '浜'], ['邊', '辺'], ['邉', '辺'], ['齋', '斉'], ['齊', '斉'], ['斎', '斉'],
  ['澤', '沢'], ['廣', '広'], ['德', '徳'], ['惠', '恵'], ['眞', '真'], ['嶋', '島'], ['嶌', '島'], ['國', '国'], ['櫻', '桜'],
  ['瀨', '瀬'], ['栁', '柳'], ['𠮷', '吉'], ['穗', '穂'], ['曾', '曽'], ['龍', '竜'], ['藏', '蔵'], ['淵', '渕'],
  ['槇', '槙'], ['條', '条'], ['冨', '富'], ['萬', '万'], ['與', '与'], ['禮', '礼'], ['實', '実'], ['壽', '寿'], ['凜', '凛'],
];

/** 氏名の照合用：全角半角をそろえ、空白を落とし、異体字を読み替える。 */
export function normName(v: unknown): string {
  let t = s(v).normalize('NFKC').replace(/\s/g, '');
  for (const [a, b] of KANJI_VARIANTS) t = t.split(a).join(b);
  return t;
}

/** 校舎の照合用：「智翔館 佐世保駅前校」「駅前」→「駅前」。 */
export function normCampus(v: unknown): string {
  return s(v).normalize('NFKC').replace(/\s/g, '')
    .replace(/智翔館(東進)?/g, '').replace(/^佐世保/, '').replace(/(校舎|教室|校)$/, '');
}

/** 学年の表記をそろえる：「中１」「中学1年」「1年」→「中1」。読めないものはそのまま。 */
export function normGrade(v: unknown): string {
  const t = s(v).normalize('NFKC').replace(/\s/g, '');
  const m = t.match(/^(小|中|高)(?:学|校)?(?:校)?([1-6])(?:年生?)?$/);
  return m ? `${m[1]}${m[2]}` : t;
}

/** 記録の link（改行区切り）→ 申込ID の並び。 */
export function linkIds(v: unknown): string[] {
  return s(v).split('\n').map((x) => x.trim()).filter(Boolean);
}

export function emptyTrack(key: string): Track {
  return { key, flyer: '', talk: '', reaction: '', parent: '', applied: '', link: '', priority: '', memo: '', updatedAt: '', updatedBy: '' };
}

/** 保存する値を整える（知らない項目・形の違う値は捨てる）。 */
export function cleanTrackFields(input: unknown): Partial<Record<TrackField, string>> {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Partial<Record<TrackField, string>> = {};
  const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(s(v)) ? s(v) : '');
  for (const f of TRACK_FIELDS) {
    if (!(f in o)) continue;
    if (f === 'flyer' || f === 'talk' || f === 'parent') out[f] = day(o[f]);
    else if (f === 'reaction') out[f] = (REACTIONS as string[]).includes(s(o[f])) ? s(o[f]) : '';
    else if (f === 'applied') out[f] = s(o[f]) === '1' ? '1' : '';
    else if (f === 'priority') out[f] = ['1', '0'].includes(s(o[f])) ? s(o[f]) : '';
    else if (f === 'link') out[f] = linkIds(o[f]).join('\n').slice(0, 1000);
    else out[f] = s(o[f]).slice(0, 500);
  }
  return out;
}

// シートが日付に読み替えて「2026/11/17」で返してきても「2026-11-17」にそろえる
function sheetDay(v: unknown): string {
  const m = s(v).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}

export function trackFromSheet(o: Record<string, unknown>): Track {
  const r = s(o['反応']);
  return {
    key: s(o['生徒キー']),
    flyer: sheetDay(o['チラシ']), talk: sheetDay(o['声掛け']),
    reaction: ((REACTIONS as string[]).includes(r) ? r : '') as Reaction,
    parent: sheetDay(o['保護者案内']), applied: s(o['申込']) === '1' ? '1' : '', link: s(o['申込ひも付け']),
    priority: ['1', '0'].includes(s(o['重点'])) ? s(o['重点']) : '', memo: s(o['メモ']),
    updatedAt: s(o['更新日時']), updatedBy: s(o['更新者']),
  };
}

// 画面の項目名 → シートの見出し（apps_script/event.gs の EVENT_TRACK_HEADERS と同じ名前）
export const TRACK_HEADERS: Record<TrackField, string> = {
  flyer: 'チラシ', talk: '声掛け', reaction: '反応', parent: '保護者案内', applied: '申込', link: '申込ひも付け', priority: '重点', memo: 'メモ',
};

// ---- 名簿 -----------------------------------------------------------------

export type RosterColumns = { no: string; campus: string; school: string; grade: string; name: string; dream: string; hope: string; studentId: string };

/**
 * 名簿のスプレッドシートの行（見出しの名前 → 値）を生徒にする。
 * 「例」の行・氏名の無い行は捨てる。同じ鍵が2回出たら後のほうを捨てる（2つのタブに同じ生徒がいるとき）。
 */
export function parseRoster(rows: Record<string, unknown>[], col: RosterColumns, noCampus: string): Student[] {
  const out: Student[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const name = s(r[col.name]).replace(/\s+/g, ' ');
    if (!name || s(r[col.no]) === '例') continue;
    const campus = s(r[col.campus]) || noCampus;
    const studentId = s(r[col.studentId]);
    const key = studentId || `${campus}|${normName(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key, studentId, campus, school: s(r[col.school]), grade: normGrade(r[col.grade]), name,
      dream: s(r[col.dream]), hope: s(r[col.hope]),
    });
  }
  return out;
}

/** 夢・志／志望校から重点を見分ける（手入力は別。effectivePriority）。 */
export function autoPriority(st: Pick<Student, 'dream' | 'hope'>, words: PriorityWords): PriorityKind {
  const text = `${st.dream}\n${st.hope}`;
  if (words.pharma.some((w) => text.includes(w))) return 'pharma';
  if (words.medical.some((w) => text.includes(w))) return 'medical';
  return '';
}

export function effectivePriority(st: Pick<Student, 'dream' | 'hope'>, track: Pick<Track, 'priority'>, words: PriorityWords): PriorityKind {
  if (track.priority === '0') return '';
  const auto = autoPriority(st, words);
  if (auto) return auto;
  return track.priority === '1' ? 'manual' : '';
}

export const PRIORITY_LABEL: Record<PriorityKind, string> = { '': '', pharma: '薬剤師・薬学', medical: '医療系', manual: '担当が指定' };

/** 校舎を決まった順に並べる（order に無い校舎は出てきた順で後ろ、noCampus は最後）。 */
export function campusList(students: Student[], order: string[], noCampus: string): string[] {
  const found: string[] = [];
  for (const st of students) if (!found.includes(st.campus)) found.push(st.campus);
  const rank = (c: string) => (c === noCampus ? 9999 : order.includes(c) ? order.indexOf(c) : 1000 + found.indexOf(c));
  return found.sort((a, b) => rank(a) - rank(b));
}

// ---- 申込フォームの回答 ------------------------------------------------------

export type FormColumns = {
  at: number; name: number; parentName: number; campus: number; grade: number; school: number;
  who: number;          // 「参加される方」「申込者」など（生徒／保護者）
  parentFlags: number[]; // 「保護者の参加」「保護者の参加人数」など
};

const KANA = /(ふりがな|フリガナ|ﾌﾘｶﾞﾅ|カナ|かな|よみ|ヨミ)/;

/**
 * フォームの回答シートの見出しから、どの列が何かを当てる。
 * ★フォームの質問の文言で決まる。当たらないときは、質問の文言をここの決まりに合わせるか、決まりを足す。
 *   生徒の氏名＝「生徒／お子／参加者／受講者」＋「氏名／名前」。無ければ、保護者・ふりがなでない「氏名／名前」
 */
export function mapFormColumns(headers: string[]): FormColumns {
  const h = headers.map((x) => s(x).normalize('NFKC'));
  const find = (ok: (t: string) => boolean) => h.findIndex((t) => t !== '' && ok(t));
  const isName = (t: string) => /(氏名|名前|お名前)/.test(t) && !KANA.test(t);
  let name = find((t) => isName(t) && /(生徒|お子|子ども|子供|参加者|受講者|塾生)/.test(t) && !/保護者/.test(t));
  if (name < 0) name = find((t) => isName(t) && !/保護者/.test(t));
  const at = find((t) => /タイムスタンプ|回答日時|送信日時/.test(t));
  const who = find((t) => !isName(t) && /(参加(される|する)(方|人)|参加者|申込者|申し込み者|どなた|参加形態|参加区分)/.test(t) && !/人数/.test(t));
  const parentFlags = h
    .map((t, i) => (/保護者/.test(t) && /(参加|人数|同伴|出席)/.test(t) && !isName(t) && i !== who ? i : -1))
    .filter((i) => i >= 0);
  return {
    at: at < 0 ? 0 : at,
    name,
    parentName: find((t) => isName(t) && /保護者/.test(t)),
    campus: find((t) => /(校舎|教室)/.test(t)),
    grade: find((t) => /学年/.test(t)),
    school: find((t) => /学校/.test(t) && !/学年/.test(t)),
    who,
    parentFlags,
  };
}

const NO_WORDS = /^(0|０|なし|無し|しない|参加しない|不参加|いいえ|no|×|✕|-|ー|―)?$/i;

/** フォームの回答（見出しと行）を申込にする。氏名の無い行は捨てる。 */
export function parseApplications(headers: string[], rows: unknown[][]): Application[] {
  const c = mapFormColumns(headers);
  const out: Application[] = [];
  const used = new Map<string, number>();
  for (const r of rows) {
    const cell = (i: number) => (i < 0 ? '' : s(r[i]));
    const parentName = cell(c.parentName);
    const name = (cell(c.name) || parentName).replace(/\s+/g, ' ');
    if (!name) continue;
    const who = cell(c.who);
    let parent = c.parentFlags.some((i) => !NO_WORDS.test(cell(i)));
    let student = cell(c.name) !== '';
    if (who) {
      const p = /(保護者|親|父|母|家族)/.test(who);
      const st = /(生徒|本人|お子|子ども|子供|塾生)/.test(who);
      if (p) parent = true;
      if (p && !st) student = false; // 「保護者のみ」
    }
    if (!student && !parent) parent = true; // 生徒の氏名が無く保護者の氏名だけの申込
    const at = cell(c.at);
    let id = `${at}|${normName(name)}`;
    const n = (used.get(id) ?? 0) + 1;
    used.set(id, n);
    if (n > 1) id = `${id}#${n}`;
    out.push({
      id, at, name, campus: cell(c.campus), grade: normGrade(cell(c.grade)), school: cell(c.school), parentName,
      student, parent,
      answers: headers.map((hd, i) => [s(hd), s(r[i])] as [string, string]).filter(([hd, v]) => hd !== '' && v !== ''),
    });
  }
  return out;
}

export type MatchResult = {
  byStudent: Map<string, Application[]>; // 生徒の鍵 → 結び付いた申込
  unmatched: Application[];              // 名簿の誰とも結び付かなかった申込
};

/**
 * 申込を名簿の生徒に結び付ける。
 *   1. 手で結び付けた分（記録の link が申込ID）を先に決める
 *   2. 氏名（空白・異体字をそろえたもの）が同じ生徒が1人ならその生徒
 *   3. 同じ氏名が複数いるときは、申込の校舎と同じ生徒が1人ならその生徒。決まらなければ名簿外に残す
 */
export function matchApplications(students: Student[], tracks: Map<string, Track>, apps: Application[]): MatchResult {
  const byStudent = new Map<string, Application[]>();
  const add = (key: string, a: Application) => { byStudent.set(key, [...(byStudent.get(key) ?? []), a]); };
  const linked = new Map<string, string>(); // 申込ID → 生徒の鍵
  const keys = new Set(students.map((st) => st.key));
  for (const t of tracks.values()) if (keys.has(t.key)) for (const id of linkIds(t.link)) linked.set(id, t.key);

  const byName = new Map<string, Student[]>();
  for (const st of students) {
    const k = normName(st.name);
    byName.set(k, [...(byName.get(k) ?? []), st]);
  }
  const unmatched: Application[] = [];
  for (const a of apps) {
    const manual = linked.get(a.id);
    if (manual) { add(manual, a); continue; }
    let cands = byName.get(normName(a.name)) ?? [];
    if (cands.length > 1 && a.campus) {
      const same = cands.filter((st) => normCampus(st.campus) === normCampus(a.campus));
      if (same.length) cands = same;
    }
    if (cands.length > 1 && a.grade) {
      const same = cands.filter((st) => st.grade === a.grade);
      if (same.length) cands = same;
    }
    if (cands.length === 1) add(cands[0].key, a);
    else unmatched.push(a);
  }
  return { byStudent, unmatched };
}

// ---- 画面の1行（次にすること） -----------------------------------------------

export function buildRows(students: Student[], tracks: Track[], apps: Application[], words: PriorityWords): { rows: StudentRow[]; unmatched: Application[] } {
  const tmap = new Map(tracks.map((t) => [t.key, t]));
  const { byStudent, unmatched } = matchApplications(students, tmap, apps);
  const rows = students.map((student) => {
    const track = tmap.get(student.key) ?? emptyTrack(student.key);
    const mine = byStudent.get(student.key) ?? [];
    const studentApplied = track.applied === '1' || mine.some((a) => a.student);
    const parentApplied = mine.some((a) => a.parent);
    const priority = effectivePriority(student, track, words);
    const stage = stageOf(track, studentApplied || parentApplied);
    return {
      student, track, priority, apps: mine, studentApplied, parentApplied, stage,
      todo: todoOf(stage, track, priority, studentApplied, parentApplied),
      urgent: priority !== '' && stage !== 'applied' && stage !== 'declined',
    };
  });
  return { rows, unmatched };
}

export function stageOf(track: Track, applied: boolean): Stage {
  if (applied) return 'applied';
  if (track.reaction === '不参加') return 'declined';
  if (track.reaction === '参加したい') return 'wants';
  if (track.reaction === '検討中') return 'considering';
  if (track.talk) return 'talked';
  if (track.flyer) return 'flyer';
  return 'none';
}

/** 教室担当が次にすること。申込済・不参加は空（保護者だけ申し込んだときは、生徒本人の申込を確かめる）。 */
export function todoOf(stage: Stage, track: Track, priority: PriorityKind, studentApplied: boolean, parentApplied: boolean): string {
  const must = priority !== '';
  switch (stage) {
    case 'applied':
      return !studentApplied && parentApplied ? '保護者のみ申込。本人も参加するか確かめる' : '';
    case 'declined':
      return '';
    case 'wants':
      return track.parent ? 'QRからの申込を確かめる（まだなら、その場で一緒に申込）' : 'QRからの申込を後押し。保護者にも案内する';
    case 'considering':
      return track.parent ? 'もう一度声を掛けて、参加するか決めてもらう' : '保護者へ案内して後押しする';
    case 'talked':
      return '反応を聞いて記録する（参加したい／検討中／不参加）';
    case 'flyer':
      return must ? '本人に直接声を掛ける（ぜひ受けてほしい生徒）' : '声を掛けて反応を聞く';
    default:
      return must ? 'チラシを渡して、直接声を掛ける（ぜひ受けてほしい生徒）' : 'チラシを渡す';
  }
}

// 並び順：重点でまだ決まっていない → することがある → 済んだ（申込済・不参加）。同じなら学年・氏名の順
const STAGE_RANK: Record<Stage, number> = { none: 0, flyer: 1, talked: 2, wants: 3, considering: 4, applied: 8, declined: 9 };
const PRIORITY_RANK: Record<PriorityKind, number> = { pharma: 0, medical: 1, manual: 2, '': 3 };

export function sortRows(rows: StudentRow[]): StudentRow[] {
  const done = (r: StudentRow) => (r.todo === '' ? 1 : 0);
  return [...rows].sort((a, b) =>
    done(a) - done(b)
    || (a.urgent ? 0 : 1) - (b.urgent ? 0 : 1)
    || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || STAGE_RANK[a.stage] - STAGE_RANK[b.stage]
    || b.student.grade.localeCompare(a.student.grade, 'ja')
    || a.student.name.localeCompare(b.student.name, 'ja'));
}

// ---- 集計（校舎ごとの進み具合） ----------------------------------------------

export type Summary = {
  campus: string;
  total: number;
  flyer: number;          // チラシを渡した
  talked: number;         // 声を掛けた（声掛けの日がある・反応が入っている・申込済）
  wants: number;          // 参加したい（まだ申込なし）
  considering: number;    // 検討中
  declined: number;
  applied: number;        // 申込済（生徒 or 保護者）
  studentApplied: number;
  parentApplied: number;
  untouched: number;      // 未着手
  todo: number;           // することが残っている人数
  priority: number;       // 重点の人数
  priorityTalked: number;
  priorityApplied: number;
  priorityOpen: number;   // 重点で、まだ申込も不参加も決まっていない
  lastUpdated: string;    // 記録の最終更新
};

const touched = (r: StudentRow) => !!r.track.talk || r.track.reaction !== '' || r.stage === 'applied';

export function summarize(campus: string, rows: StudentRow[]): Summary {
  const c = (f: (r: StudentRow) => boolean) => rows.filter(f).length;
  return {
    campus,
    total: rows.length,
    flyer: c((r) => !!r.track.flyer),
    talked: c(touched),
    wants: c((r) => r.stage === 'wants'),
    considering: c((r) => r.stage === 'considering'),
    declined: c((r) => r.stage === 'declined'),
    applied: c((r) => r.stage === 'applied'),
    studentApplied: c((r) => r.studentApplied),
    parentApplied: c((r) => r.parentApplied),
    untouched: c((r) => r.stage === 'none'),
    todo: c((r) => r.todo !== ''),
    priority: c((r) => r.priority !== ''),
    priorityTalked: c((r) => r.priority !== '' && touched(r)),
    priorityApplied: c((r) => r.priority !== '' && r.stage === 'applied'),
    priorityOpen: c((r) => r.urgent),
    lastUpdated: rows.reduce((m, r) => (r.track.updatedAt > m ? r.track.updatedAt : m), ''),
  };
}

export function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

/** 開催日（または締切）までの日数。今日が当日なら 0、過ぎていれば負の数。 */
export function daysUntil(day: string, today: string): number | null {
  const a = Date.parse(`${day}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

/** 日本時間の今日（YYYY-MM-DD）。 */
export function todayJp(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** 「2026-11-17」→「11/17」。 */
export function shortDay(day: string): string {
  const m = day.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : day;
}
