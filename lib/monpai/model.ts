// 門配管理の型と計算（画面・API・保存で共通。サーバ／ブラウザどちらからも使う）。
//
// ボトム（月の最低配布数）：
//   中学校＝全校生徒数 × 20%、小学校＝小2〜6の生徒数 × 30%。募集期は どちらも 60%。
//   月別設定で、特定の月・学校だけ率を上書きできる（例：開校月は大野中 50%）。
// ★率はまず仮の値。運用しながら RATES と月別設定で微調整する。

export const DISTRICTS = ['駅前', '大野', '広田', '日宇', '日野', '佐々', '西海大島'] as const;
export type District = (typeof DISTRICTS)[number];

export type SchoolKind = '中' | '小';

export const RATES: Record<SchoolKind, { normal: number; recruit: number }> = {
  中: { normal: 0.2, recruit: 0.6 },
  小: { normal: 0.3, recruit: 0.6 },
};

export type School = {
  district: string;
  name: string; // 学校名（地区の中で一意。記録はこの名前で学校を指す）
  kind: SchoolKind;
  students: number; // 中＝全校生徒数、小＝小2〜6の生徒数
  order: number; // 画面での並び順
  note: string;
};

/** 月別設定。school が空ならその月の全校に効く。rate が null なら率は上書きしない。 */
export type MonthSetting = {
  month: string; // YYYY-MM
  school: string;
  rate: number | null; // 0.5 = 50%
  recruit: boolean; // 募集期
};

export const STATUSES = ['予定', '実施', '中止'] as const;
export type Status = (typeof STATUSES)[number];

export type MonpaiRecord = {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // 例 16:00-17:00
  district: string;
  school: string;
  staff1: string;
  staff2: string;
  material: string; // 配布物・ノベルティ
  planned: number; // 計画部数
  done: number | null; // 実施部数（未報告は null）
  status: Status;
  reason: string; // 不実施理由
  memo: string; // 反応・様子
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type RecordInput = Omit<MonpaiRecord, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>;

// ---- ボトム ---------------------------------------------------------------

export function settingFor(settings: MonthSetting[], month: string, school: string): MonthSetting | null {
  return (
    settings.find((s) => s.month === month && s.school === school) ??
    settings.find((s) => s.month === month && !s.school) ??
    null
  );
}

export function bottomOf(
  school: School,
  settings: MonthSetting[],
  month: string,
): { rate: number; bottom: number; recruit: boolean } {
  const st = settingFor(settings, month, school.name);
  const recruit = !!st?.recruit;
  const rate = st?.rate ?? (recruit ? RATES[school.kind].recruit : RATES[school.kind].normal);
  return { rate, bottom: Math.round(school.students * rate), recruit };
}

// ---- 日付 -----------------------------------------------------------------

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** 日本時間の今日（YYYY-MM-DD）。 */
export function todayJst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, diff: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + diff, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** その月の日付（YYYY-MM-DD）と曜日の一覧。 */
export function daysOf(month: string): { date: string; day: number; week: string; holiday: boolean }[] {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => {
    const w = new Date(Date.UTC(y, m - 1, i + 1)).getUTCDay();
    return {
      date: `${month}-${String(i + 1).padStart(2, '0')}`,
      day: i + 1,
      week: WEEK[w],
      holiday: w === 0 || w === 6,
    };
  });
}

export function weekOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// ---- 担当 -----------------------------------------------------------------

/**
 * ログインした人がこの記録の担当か。シートでは「安東」のように姓だけで書くことが多いので、
 * 「安東瑞輝」でログインした人は「安東」「安東瑞輝」のどちらでも一致とみなす。
 */
export function isMine(r: Pick<MonpaiRecord, 'staff1' | 'staff2'>, name: string): boolean {
  const me = name.replace(/[\s　]/g, '');
  if (!me) return false;
  return [r.staff1, r.staff2].some((s) => {
    const t = s.replace(/[\s　]/g, '');
    return t.length >= 2 && (me.startsWith(t) || t === me);
  });
}

/** 担当欄の名前を1人ずつに分ける（「中山、松田」「越智・溝口」の2人書きも1人ずつ）。 */
export function staffNames(r: Pick<MonpaiRecord, 'staff1' | 'staff2'>): string[] {
  return Array.from(new Set([r.staff1, r.staff2].flatMap((s) => (s || '').split(/[、,，・\s　]+/)).filter(Boolean)));
}

/** 同じ人か。姓だけ（「越智」）と姓名（「越智浩晃」）も同じ人とみなす。 */
export function samePerson(a: string, b: string): boolean {
  if (a.length < 2 || b.length < 2) return a === b;
  return a.startsWith(b) || b.startsWith(a);
}

/** 門配の時間の目安の長さ（終わりが書かれていないとき） */
const DEFAULT_MINUTES = 30;

/** 「16:00-17:00」「15:15-」「17:30」→ 分に直した [始まり, 終わり)。読めなければ null。 */
export function timeRange(t: string): { start: number; end: number } | null {
  const m = /(\d{1,2})[:：](\d{2})(?:\s*[-~〜～－]\s*(\d{1,2})[:：](\d{2}))?/.exec(t || '');
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = m[3] ? Number(m[3]) * 60 + Number(m[4]) : start + DEFAULT_MINUTES;
  return { start, end: end > start ? end : start + DEFAULT_MINUTES };
}

export type StaffConflict = {
  date: string;
  staff: string;
  kind: '重なり' | '時間未定'; // 重なり＝時間が重なる／時間未定＝どちらかの時間が書かれておらず重なるか分からない
  items: MonpaiRecord[];
};

/**
 * 同じ人が同じ日に、時間の重なる門配を2か所以上持っていないかを探す（地区をまたいで見る）。
 * 同じ日に2校でも、時間がずれていれば（大野小15:15→大野中17:30 など）重なりにしない。中止は数えない。
 */
export function findStaffConflicts(records: MonpaiRecord[]): StaffConflict[] {
  const active = records.filter((r) => r.status !== '中止' && staffNames(r).length > 0);
  const byDate = new Map<string, MonpaiRecord[]>();
  active.forEach((r) => byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]));
  const out = new Map<string, StaffConflict>();
  for (const [date, rs] of Array.from(byDate)) {
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        const who = staffNames(a).find((n) => staffNames(b).some((m) => samePerson(n, m)));
        if (!who) continue;
        const ta = timeRange(a.time), tb = timeRange(b.time);
        const kind = !ta || !tb ? '時間未定' : ta.start < tb.end && tb.start < ta.end ? '重なり' : null;
        if (!kind) continue;
        const key = `${date}|${who}`;
        const c = out.get(key) ?? { date, staff: who, kind, items: [] };
        if (kind === '重なり') c.kind = '重なり';
        [a, b].forEach((r) => { if (!c.items.some((x) => x.id === r.id)) c.items.push(r); });
        out.set(key, c);
      }
    }
  }
  return Array.from(out.values())
    .map((c) => ({ ...c, items: c.items.sort((x, y) => (timeRange(x.time)?.start ?? 0) - (timeRange(y.time)?.start ?? 0)) }))
    .sort((x, y) => x.date.localeCompare(y.date) || x.staff.localeCompare(y.staff));
}

// ---- 入力チェック -----------------------------------------------------------

const int = (v: unknown): number | null => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : NaN;
};

export function validateRecord(body: unknown): { ok: true; value: RecordInput } | { ok: false; errors: string[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string, max = 200) => String(b[k] ?? '').trim().slice(0, max);
  const errors: string[] = [];

  const date = str('date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('日付を選んでください。');
  const district = str('district', 20);
  if (!(DISTRICTS as readonly string[]).includes(district)) errors.push('地区を選んでください。');
  const school = str('school', 60);
  if (!school) errors.push('学校を選んでください。');

  const planned = int(b.planned);
  if (Number.isNaN(planned)) errors.push('計画部数は0以上の整数で入力してください。');
  const done = int(b.done);
  if (Number.isNaN(done)) errors.push('実施部数は0以上の整数で入力してください。');

  let status = str('status', 4) as Status;
  if (!(STATUSES as readonly string[]).includes(status)) status = '予定';
  // 実施部数が入ったら「実施」。中止は明示されたときだけ。
  if (status !== '中止') status = done != null && !Number.isNaN(done) ? '実施' : '予定';

  const reason = str('reason', 500);
  if (status === '中止' && !reason) errors.push('中止のときは不実施理由を入力してください。');

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      date, district, school, status, reason,
      time: str('time', 40),
      staff1: str('staff1', 30),
      staff2: str('staff2', 30),
      material: str('material', 100),
      planned: planned ?? 0,
      done: done ?? null,
      memo: str('memo', 1000),
    },
  };
}

// ---- 配布物・ノベルティ -------------------------------------------------------
//
// 在庫は「入出庫の合計 − 実績で配った数」で毎回計算する（在庫数そのものは保存しない）。
// こうすると実績を直したり消したりしても在庫が自動で合う。
// 1回の門配で複数の配布物を渡すときは、配布物の欄に「チラシA、ノートB」のように区切って書く。
// それぞれの品目から「実施部数」ずつ減る。

export const MATERIAL_KINDS = ['チラシ', 'ノベルティ', 'その他'] as const;

export type MaterialItem = {
  name: string; // 品名（一意）
  kind: string;
  prep: string; // 準備担当（NEP／教室 など）
  threshold: number; // 発注目安（これ以下で「残りわずか」）
  note: string;
};

export type MaterialMovement = {
  date: string; // YYYY-MM-DD
  name: string; // 品名
  qty: number; // 入庫はプラス、廃棄・調整はマイナス
  memo: string;
  user: string;
};

export type MaterialStock = MaterialItem & { received: number; used: number; stock: number; low: boolean };

/** 配布物の欄を品名ごとに分ける。 */
export function splitMaterials(material: string): string[] {
  return material.split(/[、,，＋+／/]/).map((s) => s.trim()).filter(Boolean);
}

export function computeStock(
  items: MaterialItem[],
  movements: MaterialMovement[],
  usage: { material: string; done: number | null }[],
): MaterialStock[] {
  return items.map((it) => {
    const received = movements.filter((m) => m.name === it.name).reduce((a, m) => a + m.qty, 0);
    const used = usage
      .filter((u) => u.done != null && splitMaterials(u.material).includes(it.name))
      .reduce((a, u) => a + (u.done ?? 0), 0);
    const stock = received - used;
    // 発注目安を下回ったら「残りわずか」（目安が0なら出さない）
    return { ...it, received, used, stock, low: it.threshold > 0 && stock < it.threshold };
  });
}

// ---- 学校マスタ・月別設定の編集 ------------------------------------------------

/** 学校マスタ・月別設定を編集できる部門（ボトムの計算のもとになるので絞る）。★増やすときはここだけ直す */
export const MASTER_EDIT_DEPTS = ['総務・人事・支援・管理'];
export const canEditMaster = (campus: string) => MASTER_EDIT_DEPTS.includes(campus);

export function validateSchool(b: Record<string, unknown>): { ok: true; value: School } | { ok: false; errors: string[] } {
  const str = (k: string, max: number) => String(b[k] ?? '').trim().slice(0, max);
  const errors: string[] = [];
  const name = str('name', 40);
  if (!name) errors.push('学校名を入力してください。');
  const district = str('district', 20);
  if (!(DISTRICTS as readonly string[]).includes(district)) errors.push('地区を選んでください。');
  const kind = str('kind', 2);
  if (kind !== '中' && kind !== '小') errors.push('種別（中・小）を選んでください。');
  const students = Number(b.students);
  if (!Number.isInteger(students) || students < 0 || students > 5000) errors.push('生徒数は0〜5000の整数で入力してください。');
  const order = Number(b.order ?? 0);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { name, district, kind: kind as SchoolKind, students, order: Number.isFinite(order) ? Math.trunc(order) : 0, note: str('note', 100) },
  };
}

export function validateSetting(b: Record<string, unknown>): { ok: true; value: MonthSetting } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const month = String(b.month ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) errors.push('月を選んでください。');
  const school = String(b.school ?? '').trim().slice(0, 40);
  const rawRate = String(b.rate ?? '').replace('%', '').trim();
  let rate: number | null = null;
  if (rawRate !== '') {
    const n = Number(rawRate);
    // 「50」でも「0.5」でも 50% として扱う
    rate = n > 1 ? n / 100 : n;
    if (!(rate > 0 && rate <= 1)) errors.push('率は1〜100（%）で入力してください。');
  }
  const recruit = b.recruit === true || b.recruit === 'true' || b.recruit === '1';
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { month, school, rate, recruit } };
}

// ---- 月の集計（/monpai/summary）------------------------------------------------
//
// 1か月の門配を全地区まとめて、地区・学校・担当ごとに数える。数え方は月間一覧の集計表と同じ：
//   計画＝中止を除いた計画部数の合計／実績＝報告済みの実施部数の合計（中止は数えない）
//   ボトムは学校マスタに載っている学校の分だけ。学校マスタに無い学校の記録も実績には数える。

export type Tally = {
  bottom: number;
  planned: number;
  done: number;
  visits: number; // 実施を報告した回数（0部の回も含む）
  canceled: number; // 中止
  unreported: number; // 日付が過ぎたのに実績が未報告
  upcoming: number; // 今日以降の予定
};

export type SchoolTally = Tally & { district: string; school: string; registered: boolean };
export type DistrictTally = Tally & { district: string; schools: SchoolTally[] };
export type StaffTally = { name: string; visits: number; done: number; canceled: number; unreported: number };

export type MonthSummary = {
  month: string;
  total: Tally;
  districts: DistrictTally[];
  staff: StaffTally[];
  unreported: MonpaiRecord[]; // 日付順
  canceled: MonpaiRecord[]; // 日付順
};

const emptyTally = (): Tally => ({ bottom: 0, planned: 0, done: 0, visits: 0, canceled: 0, unreported: 0, upcoming: 0 });

function addTally(a: Tally, b: Tally): Tally {
  return {
    bottom: a.bottom + b.bottom, planned: a.planned + b.planned, done: a.done + b.done, visits: a.visits + b.visits,
    canceled: a.canceled + b.canceled, unreported: a.unreported + b.unreported, upcoming: a.upcoming + b.upcoming,
  };
}

/** 記録1件の数え分け。today（YYYY-MM-DD）より前で実績が無ければ未報告。 */
function tallyOf(r: MonpaiRecord, today: string): Tally {
  const t = emptyTally();
  if (r.status === '中止') { t.canceled = 1; return t; }
  t.planned = r.planned;
  if (r.done != null) { t.done = r.done; t.visits = 1; }
  else if (r.date < today) t.unreported = 1;
  else t.upcoming = 1;
  return t;
}

export function summarizeMonth(
  records: MonpaiRecord[],
  schools: School[],
  settings: MonthSetting[],
  month: string,
  today: string,
): MonthSummary {
  const rs = records.filter((r) => monthOf(r.date) === month).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const extra = Array.from(new Set(rs.map((r) => r.district))).filter((d) => !(DISTRICTS as readonly string[]).includes(d));

  const districts: DistrictTally[] = [...DISTRICTS, ...extra].map((district) => {
    const inD = rs.filter((r) => r.district === district);
    const master = schools.filter((s) => s.district === district).sort((a, b) => a.order - b.order);
    const others = Array.from(new Set(inD.map((r) => r.school))).filter((n) => !master.some((s) => s.name === n));
    const rows: SchoolTally[] = [
      ...master.map((s) => ({ name: s.name, bottom: bottomOf(s, settings, month).bottom, registered: true })),
      ...others.map((name) => ({ name, bottom: 0, registered: false })),
    ].map(({ name, bottom, registered }) => ({
      ...inD.filter((r) => r.school === name).reduce((a, r) => addTally(a, tallyOf(r, today)), { ...emptyTally(), bottom }),
      district, school: name, registered,
    }));
    return { ...rows.reduce(addTally, emptyTally()), district, schools: rows };
  });

  // 担当は「中山、松田」の2人書きも1人ずつ数える。2人で担当した回は、それぞれに部数を数える。
  // 姓だけ（「越智」）と姓名（「越智浩晃」）は同じ人にまとめ、長いほうの名前で出す（同じ姓が2人以上いれば分けたまま）
  const staff: StaffTally[] = [];
  for (const r of rs) {
    const t = tallyOf(r, today);
    if (t.upcoming) continue;
    for (const n of staffNames(r)) {
      const hit = staff.filter((s) => samePerson(s.name, n));
      let s = hit.length === 1 ? hit[0] : staff.find((x) => x.name === n);
      if (!s) staff.push((s = { name: n, visits: 0, done: 0, canceled: 0, unreported: 0 }));
      if (n.length > s.name.length) s.name = n;
      s.visits += t.visits; s.done += t.done; s.canceled += t.canceled; s.unreported += t.unreported;
    }
  }
  staff.sort((a, b) => b.done - a.done || b.visits - a.visits || a.name.localeCompare(b.name));

  return {
    month,
    total: districts.reduce(addTally, emptyTally()),
    districts,
    staff,
    unreported: rs.filter((r) => tallyOf(r, today).unreported),
    canceled: rs.filter((r) => r.status === '中止'),
  };
}

// ---- 門配スタッフ（大学生・アルバイト。/monpai-staff だけを使う人） -----------------------
//
// 社員は職員マスタ（lib/core/staff.ts）でログインする。門配スタッフは別の名簿で、別のログインにする
// （会議DXなど他のアプリには入れない）。名簿の編集は学校マスタと同じく MASTER_EDIT_DEPTS だけ。

export type MonpaiStaff = {
  affiliation: string; // 所属
  name: string;
  order: number;
  active: boolean; // false＝ログインできない
  note: string;
};

export function validateStaff(b: Record<string, unknown>): { ok: true; value: MonpaiStaff } | { ok: false; errors: string[] } {
  const str = (k: string, max: number) => String(b[k] ?? '').replace(/[\s　]+/g, ' ').trim().slice(0, max);
  const errors: string[] = [];
  const affiliation = str('affiliation', 40);
  if (!affiliation) errors.push('所属を入力してください。');
  // 名前の間の空白は落とす（記録の担当欄は空白なしで書くので、そろえないと担当として一致しない）
  const name = str('name', 30).replace(/ /g, '');
  if (name.length < 2) errors.push('名前を2文字以上で入力してください。');
  const order = Number(b.order ?? 0);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      affiliation, name,
      order: Number.isFinite(order) ? Math.trunc(order) : 0,
      active: b.active !== false && b.active !== 'false',
      note: str('note', 100),
    },
  };
}

/** 所属ごとにまとめる（ログイン画面のプルダウン用）。並び順 → 名前の順。 */
export function groupStaff(list: MonpaiStaff[]): { affiliation: string; names: string[] }[] {
  const sorted = [...list].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ja'));
  const out: { affiliation: string; names: string[] }[] = [];
  for (const s of sorted) {
    const g = out.find((x) => x.affiliation === s.affiliation);
    if (g) g.names.push(s.name); else out.push({ affiliation: s.affiliation, names: [s.name] });
  }
  return out;
}
