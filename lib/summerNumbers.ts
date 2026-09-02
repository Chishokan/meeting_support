// 夏の数値報告（「数値報告」メニュー）の項目定義とデータ整形。
// 会議AIの「夏の結果報告」は、ここで登録された数値を読み取るだけで、数値を尋ねない。
// ★聞く項目・並び順を変えたいときは NUMBER_FIELDS を編集する（スプレッドシートの見出しも連動する）。

import { STAFF } from './staff';

export type NumberCol = { key: string; label: string; placeholder?: string };
export type NumberField = { key: string; label: string; note?: string; cols: NumberCol[] };

export const NUMBER_FIELDS: NumberField[] = [
  {
    key: 'recruit',
    label: '夏期講習会（招待）の外部生募集',
    cols: [
      { key: 'apply', label: '申込', placeholder: '○名' },
      { key: 'target', label: '目標', placeholder: '○名' },
      { key: 'last', label: '昨年', placeholder: '○名' },
    ],
  },
  {
    key: 'interview',
    label: '外部生の継続面談（入会面談）',
    cols: [{ key: 'count', label: '実施数', placeholder: '○名' }],
  },
  {
    key: 'retention',
    label: '外部生の継続',
    cols: [
      { key: 'count', label: '継続数', placeholder: '○名' },
      { key: 'lastCount', label: '昨年の継続数', placeholder: '○名' },
      { key: 'lastTotal', label: '昨年の母数', placeholder: '○名' },
    ],
  },
  {
    key: 'mock',
    label: '8月模試の外部生',
    cols: [
      { key: 'now', label: '今年', placeholder: '○名' },
      { key: 'last', label: '昨年', placeholder: '○名' },
      { key: 'target', label: '目標', placeholder: '○名' },
    ],
  },
  {
    key: 'students',
    label: '生徒数',
    cols: [
      { key: 'sep', label: '9月現在', placeholder: '○名' },
      { key: 'lastSep', label: '昨年9月', placeholder: '○名' },
    ],
  },
  {
    key: 'grades',
    label: '通知表回収（新規入会者を含む）',
    note: '100% か、あと何名か',
    cols: [{ key: 'status', label: '回収状況', placeholder: '100% ／ あと○名' }],
  },
  {
    key: 'other',
    label: 'その他、夏の数字で報告が必要なもの',
    note: '売上・東進の受講率など、担当で把握している数字があれば',
    cols: [{ key: 'note', label: '内容', placeholder: '項目名：今年 ○ ／ 昨年 ○ ／ 目標 ○' }],
  },
];

// 入力値は "フィールドkey.列key" をキーにしたフラットな連想配列で扱う。
export type NumberValues = Record<string, string>;

export function cellKey(field: NumberField, col: NumberCol): string {
  return `${field.key}.${col.key}`;
}

// 部門（既存の事業部区分）。
export const DEPARTMENTS: string[] = STAFF.map((s) => s.campus);

// 校舎のプルダウン候補。★校舎名が確定したらここに並べる（空のままなら自由入力欄になる）。
export const CAMPUSES: string[] = [];

// スプレッドシート「夏期数値」の見出し。NUMBER_FIELDS と必ず同じ並びにする。
export const NUMBER_SHEET_HEADERS: string[] = [
  '日時',
  '部門',
  '校舎',
  '入力者',
  ...NUMBER_FIELDS.flatMap((f) =>
    f.cols.map((c) => (f.cols.length === 1 ? f.label : `${f.label}｜${c.label}`)),
  ),
];

// 見出しと同じ並びで1行分の配列にする（未入力は空文字）。
export function valuesToRow(values: NumberValues): string[] {
  return NUMBER_FIELDS.flatMap((f) => f.cols.map((c) => (values[cellKey(f, c)] ?? '').trim()));
}

// シートの1行（見出しキーの連想配列）を入力値へ戻す。
export function rowToValues(row: Record<string, unknown>): NumberValues {
  const values: NumberValues = {};
  let i = 4; // 日時・部門・校舎・入力者のあと
  for (const f of NUMBER_FIELDS) {
    for (const c of f.cols) {
      const header = NUMBER_SHEET_HEADERS[i++];
      const v = row[header];
      values[cellKey(f, c)] = v == null ? '' : String(v);
    }
  }
  return values;
}

// 会議AIのプロンプト・報告文に載せる形へ整形する（未入力は「未集計」）。
export function formatNumbers(values: NumberValues): string {
  return NUMBER_FIELDS.map((f, i) => {
    const parts = f.cols
      .map((c) => {
        const v = (values[cellKey(f, c)] ?? '').trim();
        if (!v) return f.cols.length === 1 ? '未集計' : `${c.label} 未集計`;
        return f.cols.length === 1 ? v : `${c.label} ${v}`;
      })
      .join(' ／ ');
    return `${i + 1}. ${f.label}：${parts}`;
  }).join('\n');
}

export type NumberEntry = {
  ts: string;
  dept: string;
  campus: string;
  user: string;
  values: NumberValues;
};

// 会議AIのプロンプトへ差し込む形に整形する。
export function formatEntries(entries: NumberEntry[]): string {
  if (entries.length === 0) return '';
  return entries
    .map((e) => `▼${e.dept}／${e.campus}（入力：${e.user}）\n${formatNumbers(e.values)}`)
    .join('\n\n');
}

// 校舎ごとに最新の1件だけを残す（新しい順に並んだ配列を渡す）。
export function latestByCampus(entries: NumberEntry[]): NumberEntry[] {
  const seen = new Set<string>();
  const out: NumberEntry[] = [];
  for (const e of entries) {
    const key = `${e.dept}/${e.campus}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
