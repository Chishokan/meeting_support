// 数値報告（「数値報告」メニュー）の項目定義とデータ整形。
// 報告は2種類あり、メニュー内で切り替える。
//   monthly … 通常期の月次報告（対象月ごと）          → スプレッドシート「月次数値」
//   season  … 講習期の報告（春期・夏期・冬期ごと）    → スプレッドシート「講習数値」
// 会議AIの「月次報告」「講習の結果報告」は、ここで登録された数値を読み取るだけで、数値を尋ねない。
// ★聞く項目・並び順を変えたいときは MONTHLY_FIELDS / SEASON_FIELDS を編集する（シートの見出しも連動する）。
//   見出しは項目名から作るので、label を変えると既存の行はその列が空として読まれる点に注意。

import { ADMIN_CAMPUS, STAFF } from './core/staff';

export type ReportKind = 'monthly' | 'season';

// short は一覧表示だけで使う短縮名（label はシート見出しに使う）。
// breakdown を持つ列は直接入力せず、ポップアップで内訳（breakdown に書いた隠し項目の各列）を入れ、その合計を入れる。
// rows は自由記入欄（1列だけの項目）の行数。
export type NumberCol = {
  key: string;
  label: string;
  short?: string;
  placeholder?: string;
  breakdown?: string;
  rows?: number;
};
// hidden の項目は入力欄の一覧に出さない（内訳の保存用。シートには列として残る）。
// depts があればその部門だけ、exceptDepts があればその部門以外に出す（どちらも無ければ全部門）。
export type NumberField = {
  key: string;
  label: string;
  short: string;
  note?: string;
  cols: NumberCol[];
  hidden?: boolean;
  depts?: string[];
  exceptDepts?: string[];
};

// 生徒数・入会・体験を持たない部門（管理・支援・経理グループ）。月次は自由記述の数値報告だけにする。
const NO_STUDENT_DEPTS = [ADMIN_CAMPUS];

// 生徒数の学年別内訳（小2〜高3）。
export const GRADES = ['小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3'];

export const MONTHLY_FIELDS: NumberField[] = [
  {
    key: 'students',
    label: '生徒数',
    short: '生徒数',
    note: '対象月の月末時点',
    exceptDepts: NO_STUDENT_DEPTS,
    cols: [
      { key: 'end', label: '月末', placeholder: '○名', breakdown: 'studentsByGrade' },
      { key: 'last', label: '昨年同月', placeholder: '○名', breakdown: 'studentsLastByGrade' },
      { key: 'target', label: '目標', placeholder: '○名' },
    ],
  },
  {
    key: 'enroll',
    label: '入会',
    short: '入会',
    exceptDepts: NO_STUDENT_DEPTS,
    cols: [
      { key: 'actual', label: '実績', placeholder: '○名', breakdown: 'enrollByGrade' },
      { key: 'last', label: '昨年同月', short: '昨年', placeholder: '○名', breakdown: 'enrollLastByGrade' },
      { key: 'target', label: '目標', placeholder: '○名' },
    ],
  },
  {
    key: 'trial',
    label: '体験',
    short: '体験',
    exceptDepts: NO_STUDENT_DEPTS,
    cols: [
      { key: 'actual', label: '実績', placeholder: '○名' },
      { key: 'target', label: '目標', placeholder: '○名' },
    ],
  },
  {
    key: 'events',
    label: 'その他、部門ごとのイベント等の目標・実績',
    short: 'イベント等',
    exceptDepts: NO_STUDENT_DEPTS,
    note: '模試・講座・説明会など、部門で目標を立てているもの',
    cols: [{ key: 'note', label: '内容', placeholder: '例）10/18 一斉模試：目標 ○名 ／ 実績 ○名' }],
  },
  // ★学年別の内訳（隠し項目）は必ず最後に置き、この順を変えない。
  //   シートの既存の列の並びを崩さないよう、後から足した列は末尾に付け足している（新しく足すときも末尾へ）。
  gradeField('studentsByGrade', '生徒数（月末）の学年別'),
  gradeField('studentsLastByGrade', '生徒数（昨年同月）の学年別'),
  gradeField('enrollByGrade', '入会（実績）の学年別'),
  gradeField('enrollLastByGrade', '入会（昨年同月）の学年別'),
  // 管理・支援・経理グループ用（生徒数・入会・体験が無いので、自由記述の数値報告だけ）。これも末尾に足した列。
  {
    key: 'freeNumbers',
    label: '数値報告（自由記述）',
    short: '数値報告',
    note: '担当業務で管理している数値を、前月・昨年・目標などと比べられる形で書いてください',
    depts: NO_STUDENT_DEPTS,
    cols: [
      {
        key: 'note',
        label: '内容',
        rows: 6,
        placeholder: '例）\n求人応募数：今月 ○件 ／ 前月 ○件\n経費精算の処理件数：○件（目標 ○件）\n問い合わせ対応：○件',
      },
    ],
  },
];

// その部門で使う項目（隠し項目を含む）。
export function fieldsFor(form: NumberForm, dept: string): NumberField[] {
  return form.fields.filter(
    (f) => (!f.depts || f.depts.includes(dept)) && !(f.exceptDepts && f.exceptDepts.includes(dept)),
  );
}

function gradeField(key: string, label: string): NumberField {
  return { key, label, short: '学年別', hidden: true, cols: GRADES.map((g) => ({ key: g, label: g, placeholder: '○' })) };
}

// 「その他、部門ごとのイベント等」に必ず入れてもらう数値（部門別）。★部門の増減・項目の変更はここを編集する。
// 画面では入力欄の上に案内を出し、template をひな形として入れられるようにする。
export const EVENT_GUIDES: Record<string, { items: string; template: string }> = {
  RED個別: {
    items: '中3県一斉模試（今年／昨年）・中3パック受講数（今年／昨年）',
    template: '中3県一斉模試：今年 ○名 ／ 昨年 ○名\n中3パック受講数：今年 ○名 ／ 昨年 ○名',
  },
  小中等部: {
    items: '模試（今年／昨年）',
    template: '模試：今年 ○名 ／ 昨年 ○名',
  },
};

// 内訳の合計（数字だけを拾って足す。1つも入っていなければ空文字）。
export function sumBreakdown(field: NumberField, values: NumberValues): string {
  let total = 0;
  let any = false;
  for (const c of field.cols) {
    const n = parseInt((values[cellKey(field, c)] ?? '').replace(/[^0-9]/g, ''), 10);
    if (!Number.isNaN(n)) {
      total += n;
      any = true;
    }
  }
  return any ? String(total) : '';
}

// 内訳を「小2 3・小3 5」の形に（入力のある学年だけ）。
export function formatBreakdown(field: NumberField, values: NumberValues): string {
  return field.cols
    .map((c) => {
      const v = (values[cellKey(field, c)] ?? '').trim();
      return v ? `${c.label} ${v}` : '';
    })
    .filter(Boolean)
    .join('・');
}

// 夏期数値をもとに、春期・夏期・冬期で共通に使えるようにした項目。
export const SEASON_FIELDS: NumberField[] = [
  {
    key: 'recruit',
    label: '講習会（招待）の外部生募集',
    short: '招待外部生',
    cols: [
      { key: 'apply', label: '申込', placeholder: '○名' },
      { key: 'target', label: '目標', placeholder: '○名' },
      { key: 'last', label: '昨年', placeholder: '○名' },
    ],
  },
  {
    key: 'interview',
    label: '外部生の継続面談（入会面談）',
    short: '継続面談',
    cols: [{ key: 'count', label: '実施数', placeholder: '○名' }],
  },
  {
    key: 'retention',
    label: '外部生の継続',
    short: '外部生継続',
    cols: [
      { key: 'count', label: '継続数', short: '継続', placeholder: '○名' },
      { key: 'lastCount', label: '昨年の継続数', short: '昨年継続', placeholder: '○名' },
      { key: 'lastTotal', label: '昨年の母数', short: '昨年母数', placeholder: '○名' },
    ],
  },
  {
    key: 'mock',
    label: '講習会前後の模試の外部生',
    short: '模試外部生',
    note: '夏期なら8月模試など、その講習期に対応する模試',
    cols: [
      { key: 'now', label: '今年', placeholder: '○名' },
      { key: 'last', label: '昨年', placeholder: '○名' },
      { key: 'target', label: '目標', placeholder: '○名' },
    ],
  },
  {
    key: 'students',
    label: '講習会後の生徒数',
    short: '生徒数',
    cols: [
      { key: 'now', label: '現在', placeholder: '○名' },
      { key: 'last', label: '昨年同時期', short: '昨年', placeholder: '○名' },
    ],
  },
  {
    key: 'grades',
    label: '通知表回収（新規入会者を含む）',
    short: '通知表回収',
    note: '100% か、あと何名か',
    cols: [{ key: 'status', label: '回収状況', placeholder: '100% ／ あと○名' }],
  },
  {
    key: 'other',
    label: 'その他、講習期の数字で報告が必要なもの',
    short: 'その他',
    note: '売上・東進の受講率など、担当で把握している数字があれば',
    cols: [{ key: 'note', label: '内容', placeholder: '項目名：今年 ○ ／ 昨年 ○ ／ 目標 ○' }],
  },
];

export type NumberForm = {
  kind: ReportKind;
  label: string; // メニュー内の切り替えタブ
  periodLabel: string; // 「対象月」「対象の講習期」
  sheet: string; // 保存先シート名（Apps Script 側の許可リストと揃える）
  fields: NumberField[];
};

export const NUMBER_FORMS: Record<ReportKind, NumberForm> = {
  monthly: {
    kind: 'monthly',
    label: '月次（通常期）',
    periodLabel: '対象月',
    sheet: '月次数値',
    fields: MONTHLY_FIELDS,
  },
  season: {
    kind: 'season',
    label: '講習期（春期・夏期・冬期）',
    periodLabel: '対象の講習期',
    sheet: '講習数値',
    fields: SEASON_FIELDS,
  },
};

export function isReportKind(v: unknown): v is ReportKind {
  return v === 'monthly' || v === 'season';
}

// --- 対象期間 ---------------------------------------------------------------
// シートには「2026年9月分」「2026年夏期」のような文字列で持つ
// （「2026-09」だとスプレッドシートが日付に変換してしまうため）。

export const SEASONS = ['春期', '夏期', '冬期'] as const;

// サーバー（UTC）でもブラウザでも同じ結果になるよう、日本時間の年月日を取り出す。
function jst(now: Date): { y: number; m: number; d: number } {
  const t = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function monthPeriod(y: number, m: number): string {
  return `${y}年${m}月分`;
}

// 講習期を「年×3＋期」の通し番号で扱う（春期=0・夏期=1・冬期=2）。
function seasonIndex(now: Date): number {
  const { y, m } = jst(now);
  // 冬期は12月の年で呼ぶ（2026年12月〜2027年1月 → 2026年冬期）。
  if (m <= 2) return (y - 1) * 3 + 2;
  if (m <= 6) return y * 3;
  if (m <= 10) return y * 3 + 1;
  return y * 3 + 2;
}

function seasonPeriod(idx: number): string {
  return `${Math.floor(idx / 3)}年${SEASONS[idx % 3]}`;
}

function currentSeason(now: Date): string {
  return seasonPeriod(seasonIndex(now));
}

// 月次の既定。報告は月末〜翌月初めに行うので、20日以降は当月、それより前は前月を選んでおく。
function currentMonth(now: Date): string {
  const { y, m, d } = jst(now);
  if (d >= 20) return monthPeriod(y, m);
  return m === 1 ? monthPeriod(y - 1, 12) : monthPeriod(y, m - 1);
}

export function defaultPeriod(kind: ReportKind, now = new Date()): string {
  return kind === 'monthly' ? currentMonth(now) : currentSeason(now);
}

// プルダウンの候補（新しい順）。月次は来月〜12か月前、講習期は今の講習期から6期前まで。
export function periodOptions(kind: ReportKind, now = new Date()): string[] {
  if (kind === 'season') {
    const cur = seasonIndex(now);
    return Array.from({ length: 6 }, (_, i) => seasonPeriod(cur - i));
  }
  const { y, m } = jst(now);
  const out: string[] = [];
  for (let i = -1; i <= 12; i++) {
    const idx = y * 12 + (m - 1) - i;
    out.push(monthPeriod(Math.floor(idx / 12), (idx % 12) + 1));
  }
  return out;
}

// --- 入力値・シートの行 -----------------------------------------------------

// 入力値は "フィールドkey.列key" をキーにしたフラットな連想配列で扱う。
export type NumberValues = Record<string, string>;

export function cellKey(field: NumberField, col: NumberCol): string {
  return `${field.key}.${col.key}`;
}

// 部門（既存の事業部区分）。
export const DEPARTMENTS: string[] = STAFF.map((s) => s.campus);

// 部門ごとの校舎プルダウン候補。★校舎の増減はここを編集する。
// 記載のない部門（LEC・英検など）は校舎名の自由入力欄になる。
// 総務・人事・支援・管理は校舎の代わりにグループ（管理・支援・経理）で報告する（シートの「校舎」列に入る）。
export const CAMPUSES_BY_DEPT: Record<string, string[]> = {
  小中等部: ['佐世保駅前校', '日野校', '大野校', '日宇校', '県中対策'],
  RED個別: ['広田教室', '京町教室', '日野教室', '佐々教室', '西海大島教室', '大野教室', 'ネクスタ'],
  高等部: ['佐世保駅前校', '日宇校', '大野校'],
  [ADMIN_CAMPUS]: ['管理', '支援', '経理'],
};

export function campusesFor(dept: string): string[] {
  return CAMPUSES_BY_DEPT[dept] ?? [];
}

// 「校舎」欄の呼び方（管理部門はグループ）。
export function unitLabel(dept: string): string {
  return dept === ADMIN_CAMPUS ? 'グループ' : '校舎';
}

const LEAD_HEADERS = ['日時', '対象', '部門', '校舎', '入力者'];

function colHeader(f: NumberField, c: NumberCol): string {
  return f.cols.length === 1 ? f.label : `${f.label}｜${c.label}`;
}

// スプレッドシートの見出し。fields と必ず同じ並びになる。
export function sheetHeaders(form: NumberForm): string[] {
  return [...LEAD_HEADERS, ...form.fields.flatMap((f) => f.cols.map((c) => colHeader(f, c)))];
}

// 見出しと同じ並びで1行分の配列にする（日時〜入力者は含めない。未入力は空文字）。
export function valuesToRow(form: NumberForm, values: NumberValues): string[] {
  return form.fields.flatMap((f) => f.cols.map((c) => (values[cellKey(f, c)] ?? '').trim()));
}

// シートの1行（見出しキーの連想配列）を入力値へ戻す。
export function rowToValues(form: NumberForm, row: Record<string, unknown>): NumberValues {
  const values: NumberValues = {};
  for (const f of form.fields) {
    for (const c of f.cols) {
      const v = row[colHeader(f, c)];
      values[cellKey(f, c)] = v == null ? '' : String(v);
    }
  }
  return values;
}

export type NumberEntry = {
  ts: string;
  period: string;
  dept: string;
  campus: string;
  user: string;
  values: NumberValues;
};

// 会議AIのプロンプト・報告文に載せる形へ整形する（未入力は「未集計」）。
export function formatNumbers(form: NumberForm, values: NumberValues, dept = ''): string {
  return fieldsFor(form, dept)
    .filter((f) => !f.hidden)
    .map((f, i) => {
      const parts = f.cols
        .map((c) => {
          const v = (values[cellKey(f, c)] ?? '').trim();
          if (!v) return f.cols.length === 1 ? '未集計' : `${c.label} 未集計`;
          // 内訳がある列は「月末 118（内訳 小2 3・小3 5…）」のように添える。
          const bf = c.breakdown ? form.fields.find((x) => x.key === c.breakdown) : undefined;
          const detail = bf ? formatBreakdown(bf, values) : '';
          const shown = detail ? `${v}（内訳 ${detail}）` : v;
          return f.cols.length === 1 ? shown : `${c.label} ${shown}`;
        })
        .join(' ／ ');
      return `${i + 1}. ${f.label}：${parts}`;
    })
    .join('\n');
}

// 画面表示用に「項目名：値」の行へ変換する（未入力は「—」）。
// 一覧は幅が狭いので、短い項目名と詰めた値（例「実績3／目標5」）にする。
export function displayRows(
  form: NumberForm,
  values: NumberValues,
  dept = '',
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const f of fieldsFor(form, dept)) {
    if (f.hidden) continue;
    const parts = f.cols
      .map((c) => {
        const v = (values[cellKey(f, c)] ?? '').trim();
        if (!v) return null;
        return f.cols.length === 1 ? v : `${c.short ?? c.label}${v}`;
      })
      .filter(Boolean);
    rows.push({ label: f.short, value: parts.length ? parts.join('／') : '—' });
    // 学年別の内訳があれば、項目の下に1行添える（例「（月末/昨年）小2 3/2・小3 5/4」）。
    const detail = breakdownByGrade(form, f, values);
    if (detail) rows.push({ label: `${f.short}内訳`, value: detail });
  }
  return rows;
}

// 項目の内訳列（学年別）を学年ごとにまとめる。入力のある学年だけ。無ければ空文字。
function breakdownByGrade(form: NumberForm, f: NumberField, values: NumberValues): string {
  const cols = f.cols
    .map((c) => ({ c, bf: c.breakdown ? form.fields.find((x) => x.key === c.breakdown) : undefined }))
    .filter((x): x is { c: NumberCol; bf: NumberField } => !!x.bf);
  if (cols.length === 0) return '';
  const grades = cols[0].bf.cols;
  const items = grades
    .map((g) => {
      const vs = cols.map(({ bf }) => (values[cellKey(bf, bf.cols.find((x) => x.key === g.key)!)] ?? '').trim());
      return vs.some(Boolean) ? `${g.label} ${vs.map((v) => v || '–').join('/')}` : '';
    })
    .filter(Boolean);
  if (items.length === 0) return '';
  const head = cols.length > 1 ? `（${cols.map(({ c }) => c.short ?? c.label).join('/')}）` : '';
  return head + items.join('・');
}

// 会議AIのプロンプトへ差し込む形に整形する。
export function formatEntries(form: NumberForm, entries: NumberEntry[]): string {
  if (entries.length === 0) return '';
  return entries
    .map((e) => `▼${e.period}／${e.dept}／${e.campus}（入力：${e.user}）\n${formatNumbers(form, e.values, e.dept)}`)
    .join('\n\n');
}

// 対象期間×校舎ごとに最新の1件だけを残す（新しい順に並んだ配列を渡す）。
export function latestByCampus(entries: NumberEntry[]): NumberEntry[] {
  const seen = new Set<string>();
  const out: NumberEntry[] = [];
  for (const e of entries) {
    const key = `${e.period}/${e.dept}/${e.campus}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

// 会議AIに渡すのは直近の期間だけにする（プロンプトを長くしすぎない）。
// 月次は来月〜2か月前、講習期は直近3期。期間の新しい順に並べる。
export function recentEntries(kind: ReportKind, entries: NumberEntry[], now = new Date()): NumberEntry[] {
  const periods = periodOptions(kind, now).slice(0, kind === 'monthly' ? 4 : 3);
  return entries
    .filter((e) => periods.includes(e.period))
    .sort((a, b) => periods.indexOf(a.period) - periods.indexOf(b.period));
}
