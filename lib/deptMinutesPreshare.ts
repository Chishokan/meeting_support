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

// ---- 議事録 → 次回の事前共有（部門会議のループ） ----
// 保存した議事録から、次回の会議情報と議題の下書きを作る。
// 引き継ぐのは「話し合えなかった議題」「決定事項（進捗確認）」「継続審議・保留」「ToDo」
// 「次回会議の持ち越し・準備事項」。会議名・場所・出席者は前回と同じものを入れておく。
// ★議事録の見出しは lib/deptMinutesTemplate.ts の MINUTES_SECTIONS と対になっている。
//   見出しの切り出しは lib/deptMinutesDraft.ts の draftForNext() で行い、ここには文字列だけを渡す。

export type CarryDecision = { title: string; owner: string; due: string };

// 次回の議題の下書きの見出し。カードの要約（agendaPreview）もこれを目印にする。
const CARRY_HEAD = 'からの引き継ぎ】';
const CURRENT_HEAD = '【今回の議題】';
// 終わっていない ToDo を並べる見出し。議事録のAI（lib/deptMinutesPrompt.ts）は、この見出しの ToDo を
// 会議で触れられなくても「■ ToDo」に残し、進捗を添える。そうすることで ToDo は終わるまで次回へ回り続ける。
export const TODO_CHECK_HEADING = 'ToDo の進捗確認';

export type NextAgendaInput = {
  title: string; // 前回の会議名
  date: string; // 前回の開催日時
  agenda: string; // ■ 議題
  decisions: CarryDecision[]; // ■ 決定事項
  pending: string; // ■ 継続審議・保留
  todos: string; // ■ ToDo（アクション項目）
  next: string; // ■ 次回会議
};

// 中身の無い行（テンプレートのままの「（〜）」・該当なし・【要確認】だけ）か。
function emptyValue(v: string): boolean {
  const t = v.trim();
  return !t || /^[（(].*[）)]$/.test(t) || /^(該当なし|特になし|なし|未定|空欄|【要確認】)$/.test(t);
}

// 「担当：池田 ／ 期限：」のように「／」で並んだ項目から、空の項目を落とす。
// 区切りは全角の「／」だけ（半角の「/」は「10/21」のような日付に使われるため）。
function dropEmptyFields(line: string): string {
  return line
    .split(/\s*／\s*/)
    .filter((part) => {
      const m = part.match(/^[^:：]{1,10}[:：]\s*(.*)$/);
      return m ? !emptyValue(m[1]) : !emptyValue(part);
    })
    .join('／');
}

// 見出しの中身を、1行1件の引き継ぎ項目にする（箇条書きの記号・番号・チェック欄を落とす）。
function itemsOf(section: string): string[] {
  const out: string[] = [];
  for (const raw of section.split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    // 済みの ToDo は引き継がない
    if (/^[-*・]?\s*\[[xX✓]\]/.test(line)) continue;
    line = line
      .replace(/^[-*・•]\s*/, '')
      .replace(/^\[\s?\]\s*/, '')
      .replace(/^\d+[.．)、]\s*/, '')
      .trim();
    // 「持ち越す議題：〜」のような見出し付きの行は、中身が空なら落とす。
    // 見出しに「／」を含むもの（「資料共有 ／ 担当：」のような ToDo の行）は見出しとみなさない。
    const labeled = line.match(/^([^:：／]{1,10})[:：]\s*(.*)$/);
    if (labeled && emptyValue(labeled[2])) continue;
    line = dropEmptyFields(line);
    if (emptyValue(line)) continue;
    out.push(line);
  }
  return out;
}

// 「■ ToDo」から、終わっていないものだけを「内容（担当：〜／期限：〜／進捗：〜）」の形で取り出す。
// 済み（- [x]、または「進捗：完了」）は引き継がない。担当・期限・進捗の空欄は落とす。
function openTodos(section: string): string[] {
  const out: string[] = [];
  for (const raw of section.split('\n')) {
    let line = raw.trim();
    if (!line || /^[-*・]?\s*\[[xX✓]\]/.test(line)) continue;
    line = line
      .replace(/^[-*・•]\s*/, '')
      .replace(/^\[\s?\]\s*/, '')
      .replace(/^\d+[.．)、]\s*/, '')
      .trim();
    const [head = '', ...rest] = line.split(/\s*／\s*/);
    const what = head.replace(/^内容\s*[:：]\s*/, '').trim();
    if (emptyValue(what)) continue;
    const fields = rest
      .map((p) => p.trim())
      .filter((p) => {
        const m = p.match(/^[^:：]{1,10}[:：]\s*(.*)$/);
        return m ? !emptyValue(m[1]) : !emptyValue(p);
      });
    if (fields.some((f) => /^進捗\s*[:：]\s*完了/.test(f))) continue;
    out.push(fields.length ? `${what}（${fields.join('／')}）` : what);
  }
  return out;
}

const DATE_IN_LINE = /(\d{4}\s*[/\-.年]\s*)?\d{1,2}\s*[/月]\s*\d{1,2}/;

/** 議事録の「■ 次回会議」から次回の開催日時を読む（「日時：10/21 18:00〜」→「10/21 18:00〜」）。無ければ空文字。 */
export function nextMeetingDate(next: string): string {
  for (const raw of next.split('\n')) {
    const line = raw.trim().replace(/^[-*・•]\s*/, '');
    if (!DATE_IN_LINE.test(line) || line.includes('要確認')) continue;
    const labeled = line.match(/^(?:次回)?(?:日時|日程|開催日時?)\s*[:：]\s*(.*)$/);
    return (labeled ? labeled[1] : line).trim();
  }
  return '';
}

/** 前回の議事録から、次回の「予定していた議題・レジュメ」の下書きを作る。 */
export function buildNextAgenda(input: NextAgendaInput): string {
  const groups: { heading: string; items: string[] }[] = [
    {
      heading: '前回話し合えなかった議題',
      items: itemsOf(input.agenda)
        .filter((l) => /[（(]未実施[）)]/.test(l))
        .map((l) => l.replace(/\s*[（(]未実施[）)]\s*/, '').trim()),
    },
    {
      heading: '前回の決定事項の進捗確認',
      items: input.decisions
        .filter((d) => d.title.trim())
        .map((d) => {
          const meta = [d.owner && `担当：${d.owner}`, d.due && `期限：${d.due}`].filter(Boolean).join('／');
          return meta ? `${d.title}（${meta}）` : d.title;
        }),
    },
    { heading: '継続審議・保留', items: itemsOf(input.pending) },
    { heading: TODO_CHECK_HEADING, items: openTodos(input.todos) },
    {
      heading: '前回決めた持ち越し・準備事項',
      // 開催日時の行は会議情報の「開催日時」に入れるので、ここには並べない
      items: itemsOf(input.next).filter((l) => !(DATE_IN_LINE.test(l) && /^(?:次回)?(?:日時|日程|開催日時?)/.test(l))),
    },
  ].filter((g) => g.items.length > 0);

  const from = [shortDate(input.date), input.title].filter(Boolean).join(' ');
  const lines = [`【前回${from ? `（${from}）` : ''}からの引き継ぎ】`];
  if (groups.length === 0) {
    lines.push('引き継ぐ項目はありませんでした。');
  } else {
    groups.forEach((g, i) => {
      lines.push(`${i + 1}. ${g.heading}`);
      for (const it of g.items) lines.push(`   ・${it}`);
    });
  }
  lines.push('', CURRENT_HEAD, '');
  return lines.join('\n');
}

/**
 * 事前共有のカードに出す議題の要約（先頭 max 行）。
 * 次回の下書き（buildNextAgenda）から作った議題は、今回の議題を先に出し、
 * 前回からの引き継ぎは「前回からの引き継ぎ N件」の1行にまとめる（見出しだけでカードが埋まらないように）。
 */
export function agendaPreview(agenda: string, max = 3): string[] {
  const notHeading = (l: string) => !/^【.*】$/.test(l);
  const at = agenda.indexOf(CURRENT_HEAD);
  if (at < 0 || !agenda.slice(0, at).includes(CARRY_HEAD)) return itemsOf(agenda).filter(notHeading).slice(0, max);
  const current = itemsOf(agenda.slice(at + CURRENT_HEAD.length)).filter(notHeading);
  const carried = agenda.slice(0, at).split('\n').filter((l) => /^\s*・/.test(l)).length;
  if (carried === 0) return current.slice(0, max);
  return [...current.slice(0, max - 1), `前回からの引き継ぎ ${carried}件`];
}
