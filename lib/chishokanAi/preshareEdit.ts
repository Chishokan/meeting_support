// 智翔館AI：部門会議の事前共有に、チャットから意見を足す・直す（2026-11-19）。ほかに依存しない（テストしやすいように）。
//
// get_meeting_records で事前共有を読んだ回答の下に、会議ごとの［意見を足す］［修正する］を出す（画面：components/AiPreshareCards.tsx）。
// 押すとモーダルが開き、最新の事前共有を読み直してから編集する（app/api/chishokan-ai/preshare）。
// 保存は「部門会議議事録」画面と同じ saveDeptPreshare（ID を添えて上書き。最初に共有した部門・入力者は残り、更新日時・更新者が入る）。
// - 意見：選んだ議題の行のすぐ下に「　└【意見】本文〔名前 11/19〕」を足す（議題を選ばなければ末尾に「・【意見】…」）。
//         保存の直前に最新の議題を読み直して足すので、ほかの人の書き足しを消さない。
// - 修正：会議名・開催日時・場所・出席者・議題・レジュメを直す。開いてから保存するまでにほかの人が直していたら、保存せずに知らせる。
// 議事録を保存した会議（議事録IDあり）は直せない（会議は終わっている。直すなら議事録の画面で）。

export type PreshareFields = { title: string; date: string; place: string; attendees: string; agenda: string };
export type PreshareEditRow = PreshareFields & { id: string; campus: string; user: string; editedAt: string; editedBy: string; minutesId: string };

export const OPINION_MAX = 300;
const OPINION_MARK = '【意見】';
const LIMITS: Record<keyof PreshareFields, number> = { title: 100, date: 60, place: 100, attendees: 300, agenda: 6000 };
const REQUIRED: { key: keyof PreshareFields; label: string }[] = [
  { key: 'title', label: '会議名' },
  { key: 'date', label: '開催日時' },
  { key: 'agenda', label: '議題・レジュメ' },
];

const lines = (agenda: string) => String(agenda ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n');
const isSubOpinion = (l: string) => /^\s*└/.test(l);
const isOpinion = (l: string) => isSubOpinion(l) || /^[\s・\-*]*【意見】/.test(l);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 意見を付けられる議題の行（空行・意見の行を除く。同じ行は1つに）。値は行の前後の空白を除いたもの。 */
export function agendaTargets(agenda: string): string[] {
  const out: string[] = [];
  for (const l of lines(agenda)) {
    const t = l.trim();
    if (!t || isOpinion(l) || /^[-=＝ー─━・*\s]+$/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 60);
}

/** 意見の1行（改行は「／」でつなぐ）。sub なら議題の下に付ける形。 */
export function opinionLine(text: string, user: string, stamp: string, sub: boolean, about = ''): string {
  const t = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((x) => x.trim()).filter(Boolean).join(' ／ ');
  const who = `〔${String(user ?? '').trim()} ${stamp}〕`;
  return sub ? `　└${OPINION_MARK}${t}${who}` : `・${OPINION_MARK}${about ? `（「${clip(about, 30)}」について）` : ''}${t}${who}`;
}

/** 議題の行のすぐ下（その行にもう付いている意見のあと）に意見を足す。target が空なら末尾に。見つからなければ「〇〇について」を添えて末尾に。 */
export function insertOpinion(agenda: string, target: string, text: string, user: string, stamp: string): string {
  const ls = String(agenda ?? '').trim() ? lines(agenda) : [];
  const tg = String(target ?? '').trim();
  const idx = tg ? ls.findIndex((l) => l.trim() === tg && !isOpinion(l)) : -1;
  if (idx >= 0) {
    let j = idx + 1;
    while (j < ls.length && isSubOpinion(ls[j])) j++;
    ls.splice(j, 0, opinionLine(text, user, stamp, true));
  } else {
    ls.push(opinionLine(text, user, stamp, false, tg));
  }
  return ls.join('\n');
}

/** 意見の入力を確かめる。 */
export function checkOpinion(raw: unknown): { ok: true; value: { target: string; text: string } } | { ok: false; message: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (text.length < 2) return { ok: false, message: '意見を書いてください。' };
  if (text.length > OPINION_MAX) return { ok: false, message: `意見は${OPINION_MAX}字までです。` };
  const target = typeof o.target === 'string' ? o.target.trim().slice(0, 300) : '';
  return { ok: true, value: { target, text } };
}

/** 修正の入力を確かめて整える。足りない欄・長すぎる欄があれば理由を返す。 */
export function checkFields(raw: unknown): { ok: true; value: PreshareFields } | { ok: false; message: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const v = {} as PreshareFields;
  for (const k of Object.keys(LIMITS) as (keyof PreshareFields)[]) {
    const s = typeof o[k] === 'string' ? (o[k] as string).replace(/\r\n?/g, '\n') : '';
    v[k] = k === 'agenda' ? s.replace(/\s+$/, '') : s.replace(/\s+/g, ' ').trim();
    if (v[k].length > LIMITS[k]) return { ok: false, message: `長すぎる欄があります（${k === 'agenda' ? '議題・レジュメ' : k}は${LIMITS[k]}字まで）。` };
  }
  const missing = REQUIRED.filter((f) => !v[f.key].trim()).map((f) => f.label);
  if (missing.length) return { ok: false, message: `${missing.join('・')}を入れてください。` };
  return { ok: true, value: v };
}

/** 開いたときの中身（base）から、ほかの人が直していないか（同じなら true）。空白の違いは見ない。 */
export function sameVersion(latest: PreshareFields, base: PreshareFields): boolean {
  const norm = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim();
  return (Object.keys(LIMITS) as (keyof PreshareFields)[]).every((k) => norm(latest[k]) === norm(base?.[k] ?? ''));
}

/** 直せる事前共有か。議事録を保存した会議は直せない。 */
export function editableMessage(row: Pick<PreshareEditRow, 'minutesId'> | null): string {
  if (!row) return 'この事前共有が見つかりません（消されたか、別の会議に変わった可能性があります）。';
  if (row.minutesId) return 'この会議はもう議事録が保存されているので、事前共有は直せません。直すときは「部門会議議事録」の画面で議事録を直してください。';
  return '';
}

/** 日本時間の「M/d」（意見に添える日付）。 */
export function stampJst(now = new Date()): string {
  const t = new Date(now.getTime() + 9 * 3_600_000);
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`;
}
