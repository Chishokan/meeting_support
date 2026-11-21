// 開催日時の文字列 ⇔ Zoom に渡す開始日時・長さ（Zoom連携）。
// 事前共有の「開催日時」は自由入力の文字列（例「2026/11/25 13:00〜14:00」）で保存している。
// Zoom ミーティングを作るには開始日時と長さが要るので、ここで読み取る。
// 画面の「日付・開始・終了」の入力は、ここの formatSchedule() で同じ形の文字列を組み立てる。
//
// ★画面・API・テストのどこからでも読めるよう、ここには import を置かない（型と計算だけ）。

export type Schedule = {
  day: string; // 'YYYY-MM-DD'
  start: string; // 'HH:mm'
  end: string; // 'HH:mm'。開催日時に終了時刻が無ければ ''
  startTime: string; // Zoom に渡す開始日時（日本時間）'YYYY-MM-DDTHH:mm:00'
  durationMin: number; // 長さ（分）
};

// 終了時刻が書かれていないときの長さ。部門会議は1時間前後が多い。
export const DEFAULT_DURATION_MIN = 60;
// Zoom に渡す長さの下限・上限。短すぎ・長すぎは入力の誤りとみなして丸める。
const MIN_DURATION_MIN = 15;
const MAX_DURATION_MIN = 8 * 60;

const pad = (n: number) => String(n).padStart(2, '0');

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function dayDiff(a: string, b: string): number {
  const utc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(b) - utc(a)) / 86400000);
}

// 「2026/11/25」「2026-11-25」「2026年11月25日」。年を省いた「11/25」は today の年とみなし、
// 半年以上前になるなら翌年とする（lib/deptMinutesPreshare.ts の meetingDay と同じ決まり）。
function readDay(s: string, today: string): string {
  const full = s.match(/(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/);
  if (full) {
    const [y, m, d] = [Number(full[1]), Number(full[2]), Number(full[3])];
    return validDay(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : '';
  }
  const short = s.match(/(\d{1,2})\s*[/月]\s*(\d{1,2})/);
  if (!short || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return '';
  const [m, d] = [Number(short[1]), Number(short[2])];
  let y = Number(today.slice(0, 4));
  if (!validDay(y, m, d)) return '';
  if (dayDiff(`${y}-${pad(m)}-${pad(d)}`, today) > 180) y += 1;
  return validDay(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : '';
}

// 「13:00」「13：00」「13時」「13時30分」を時刻として拾う。日付の「11/25」は拾わない。
function readTimes(s: string): string[] {
  const out: string[] = [];
  const re = /(\d{1,2})\s*(?:[:：]\s*(\d{2})|時\s*(?:(\d{1,2})\s*分)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const h = Number(m[1]);
    const min = Number(m[2] ?? m[3] ?? 0);
    if (h > 23 || min > 59) continue;
    out.push(`${pad(h)}:${pad(min)}`);
  }
  return out;
}

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * 開催日時の文字列から、開催日・開始・終了を読む。日付か開始時刻が読めなければ null。
 * today（'YYYY-MM-DD'）は、年を省いた日付を何年とみなすかを決めるのに使う。
 */
export function parseSchedule(date: string, today: string): Schedule | null {
  const text = String(date ?? '');
  const day = readDay(text, today);
  if (!day) return null;
  // 日付の部分に「2026/11/25」の 11/25 以外の数字は無いが、「11:25」と取り違えないよう日付を除いてから時刻を探す。
  const rest = text.replace(/(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?/, ' ');
  const times = readTimes(rest);
  if (times.length === 0) return null;
  const start = times[0];
  let end = times[1] ?? '';
  let durationMin = DEFAULT_DURATION_MIN;
  if (end) {
    const diff = minutesOf(end) - minutesOf(start);
    // 終了が開始より前（書き間違い）のときは、終了は無かったものとして既定の長さにする。
    if (diff > 0) durationMin = diff;
    else end = '';
  }
  durationMin = Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, durationMin));
  return { day, start, end, startTime: `${day}T${start}:00`, durationMin };
}

/** 日付・開始・終了から、開催日時の欄に入れる文字列を作る（例「2026/11/25 13:00〜14:00」）。 */
export function formatSchedule(day: string, start: string, end: string): string {
  const d = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d) return '';
  const head = `${Number(d[1])}/${Number(d[2])}/${Number(d[3])}`;
  if (!/^\d{2}:\d{2}$/.test(start)) return head;
  return `${head} ${start}〜${/^\d{2}:\d{2}$/.test(end) ? end : ''}`;
}

/** 開催日時の文字列を、画面の「日付・開始・終了」の入力に戻す。読めない欄は ''。 */
export function splitSchedule(date: string, today: string): { day: string; start: string; end: string } {
  const s = parseSchedule(date, today);
  if (s) return { day: s.day, start: s.start, end: s.end };
  return { day: readDay(String(date ?? ''), today), start: '', end: '' };
}
