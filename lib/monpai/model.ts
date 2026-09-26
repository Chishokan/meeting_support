// 門配管理の型と計算（画面・API・保存で共通。サーバ／ブラウザどちらからも使う）。
//
// ボトム（月の最低配布数）：
//   中学校＝全校生徒数 × 20%、小学校＝小2〜6の生徒数 × 30%。募集期は どちらも 60%。
//   月別設定で、特定の月・学校だけ率を上書きできる（例：開校月は大野中 50%）。
// ★率はまず仮の値。運用しながら RATES と月別設定で微調整する。

export const DISTRICTS = ['駅前', '大野', '広田', '日野', '佐々', '西海大島'] as const;
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
    return { ...it, received, used, stock, low: stock <= it.threshold };
  });
}
