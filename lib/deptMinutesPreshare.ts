// 部門会議の「事前共有」（会議の前に、手順1の会議情報と議題・レジュメを全部門へ出しておく）。
// 「部門会議議事録」画面の［事前共有で報告する］で保存し、ダッシュボードの
// 「部門会議の事前共有」に並べる。出席者が議題・レジュメを見ながら会議を進められるようにするため。
//
// ★画面・API・テストのどこからでも読めるよう、ここには import を置かない（型と計算だけ）。
//   保存先は「部門会議事前共有」シート（apps_script/Code.gs の saveDeptPreshare_ / listDeptPreshare_）。

export type PreshareMeta = {
  title: string;
  date: string; // 開催日時（自由入力。例「2026/9/10 18:00〜19:00」）
  place: string;
  attendees: string;
  agenda: string; // 予定していた議題、または会議のレジュメ
};

export type PreshareRow = PreshareMeta & {
  id: string; // 事前共有ID。これを添えて送り直すと元の行を上書きする
  ts: string; // 最初に事前共有した日時
  campus: string;
  user: string; // 事前共有した人
  editedAt: string; // 更新したときだけ入る
  editedBy: string;
  minutesId: string; // この会議の議事録を保存すると入る（入ったらダッシュボードから外す）
};

// 開催日を過ぎても、議事録が保存されるまでは何日ぶん出しておくか。
// 会議の翌日以降に議事録を作ることもあるので、当日で消さずに少し残す。
export const PRESHARE_KEEP_DAYS = 3;

// 事前共有に必要な欄。議題・レジュメが無いと「見ながら会議を進める」役に立たないので必須にする。
const REQUIRED: { key: keyof PreshareMeta; label: string }[] = [
  { key: 'title', label: '会議名' },
  { key: 'date', label: '開催日時' },
  { key: 'agenda', label: '予定していた議題・レジュメ' },
];

/** 事前共有の前に埋まっていない欄の名前（全部そろっていれば空配列）。 */
export function missingForPreshare(meta: PreshareMeta): string[] {
  return REQUIRED.filter((f) => !String(meta[f.key] ?? '').trim()).map((f) => f.label);
}

/** 会議情報の比較用の値。事前共有したあとに手順1を直したかどうかを見分けるのに使う。 */
export function metaKey(meta: PreshareMeta): string {
  return JSON.stringify([meta.title, meta.date, meta.place, meta.attendees, meta.agenda].map((v) => String(v ?? '').trim()));
}

const pad = (n: number) => String(n).padStart(2, '0');

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// 「2026/9/10」「2026-09-10」「2026年9月10日」から年月日を取り出す。
function fullDay(s: string): string {
  const m = s.match(/(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/);
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return validDay(y, mo, d) ? ymd(y, mo, d) : '';
}

/** 'YYYY-MM-DD' 同士の日数の差（b − a）。 */
export function dayDiff(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

/**
 * 開催日時の欄から開催日（'YYYY-MM-DD'）を読む。読めなければ空文字。
 * 年を省いた「10/14 18:00」は、事前共有した日（ts）の年とみなす。
 * ただし年末に翌年1月の会議を共有したときのように、半年以上前の日付になるなら翌年とする。
 */
export function meetingDay(date: string, ts: string): string {
  const full = fullDay(date);
  if (full) return full;
  const base = fullDay(ts);
  const m = date.match(/(\d{1,2})\s*[/月]\s*(\d{1,2})/);
  if (!m || !base) return '';
  const [mo, d] = [Number(m[1]), Number(m[2])];
  let y = Number(base.slice(0, 4));
  if (!validDay(y, mo, d)) return '';
  if (dayDiff(ymd(y, mo, d), base) > 180) y += 1;
  return validDay(y, mo, d) ? ymd(y, mo, d) : '';
}

/** 端末の今日（'YYYY-MM-DD'）。社員は日本にいる前提で、端末の時計の日付をそのまま使う。 */
export function localDay(now = new Date()): string {
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// 同じ日の会議を開始時刻の順に並べるための値（「18:00〜」の 18:00）。無ければ最後に回す。
function startTime(date: string): string {
  const m = date.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  return m ? `${pad(Number(m[1]))}:${m[2]}` : '99:99';
}

export type PreshareView = {
  row: PreshareRow;
  day: string; // 開催日（読めなかったときは事前共有した日）
  offset: number; // 今日から何日後か（0＝今日、1＝明日、-1＝昨日）
  dated: boolean; // 開催日を開催日時の欄から読めたか（読めないときは「今日」などの印を付けない）
};

/**
 * ダッシュボード・議事録画面に出す事前共有を選んで並べる。
 *  ・議事録を保存した会議は外す（「直近の議事録」に移るため）
 *  ・開催日から PRESHARE_KEEP_DAYS 日を過ぎたものは外す（取りやめた会議が残り続けないように）
 *  ・今日 → 明日以降（近い順）→ 過ぎたもの（新しい順）。同じ日は開始時刻の順
 */
export function upcomingPreshares(
  rows: PreshareRow[],
  today: string,
  keepDays = PRESHARE_KEEP_DAYS,
): PreshareView[] {
  const views: PreshareView[] = [];
  for (const row of rows) {
    if (row.minutesId) continue;
    const fromDate = meetingDay(row.date, row.ts);
    const day = fromDate || fullDay(row.ts);
    if (!day) continue;
    const offset = dayDiff(today, day);
    if (offset < -keepDays) continue;
    views.push({ row, day, offset, dated: Boolean(fromDate) });
  }
  return views.sort((a, b) => {
    const pa = a.offset >= 0;
    const pb = b.offset >= 0;
    if (pa !== pb) return pa ? -1 : 1;
    if (a.day !== b.day) return pa ? a.day.localeCompare(b.day) : b.day.localeCompare(a.day);
    return startTime(a.row.date).localeCompare(startTime(b.row.date));
  });
}

/** カードに付ける「今日」「明日」「3日後」「昨日」などの印。開催日を読めなかったときは空。 */
export function whenLabel(v: Pick<PreshareView, 'offset' | 'dated'>): string {
  if (!v.dated) return '';
  if (v.offset === 0) return '今日';
  if (v.offset === 1) return '明日';
  if (v.offset === -1) return '昨日';
  return v.offset > 0 ? `${v.offset}日後` : `${-v.offset}日前`;
}

/** 開催日時をカード向けに短くする（先頭の年を落とす）。「2026/9/10 18:00〜」→「9/10 18:00〜」 */
export function shortDate(date: string): string {
  return date.trim().replace(/^\d{4}\s*[/\-.年]\s*/, '');
}
