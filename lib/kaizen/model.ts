// つきいち改善（月1改善ビフォーアフター）の型と計算。画面・API・保存で共通（サーバ／ブラウザどちらからも使う）。
//
// 流れ（旧スプレッドシート「智翔館 つきいち改善リニューアルシステム」と同じ）：
//   1. その月のうちに改善を1つ提出する（Before／After の説明と写真）
//   2. 翌月、前の月に出た改善へ投票する（1人3票まで・自分の改善には入れられない・締め切りまでは入れ直せる）
//   3. 得票がいちばん多い改善が優秀賞（同票は全員）
// 投票は翌月の末日で自動的に締まる。管理部門はそれより早く締め切れる（全体会議で発表する前など）。
// 締め切るまで得票は管理部門にしか見せない（途中の順位を見て票が流れないようにするため）。
//
// ★旧システムとの違い：旧 Web アプリは投票者ごとに1行しか残さず、翌月に投票すると前の月の票が消えていた。
//   ここでは「対象月×投票者」で1件にしている。

export const KAIZEN_CAMPUSES = ['駅前', 'ネクスタ', '大野', '日宇', '日野', '広田', '大島', '佐々', '京町'] as const;

/** 1人が1か月に入れられる票の数。 */
export const MAX_VOTES = 3;

/** 未提出者・未投票者を出すときの名簿（旧スプレッドシートの「スタッフ名簿」。2026年10月時点）。
 *  ★人が増えた・辞めたらここを直す。会議DXにログインできるのは lib/core/staff.ts の職員だけなので、
 *   ここにしかいない人は、ログインできる人が「一緒に取り組んだ人」として名前を入れて提出する。 */
export const KAIZEN_ROSTER: string[] = [
  '大谷朋美', '冨松太一', '浦上仁美', '永田一羽', '岩永凜音', '岩本瑞生', '吉田りあ', '宮ケ中葉子', '宮城明希', '宮川祥真',
  '宮本珠里', '古川花', '溝口隆大', '高松佑匡', '在津英晟', '三根康浩', '山本梨沙', '山縣謙晶', '宗像美涼', '小潟理紗',
  '松井雄希', '松下真緒', '松尾誠隆', '新山七瀬', '新山青', '森美紀子', '深川雛', '石橋美姫', '千代碧', '浅井来斗',
  '浅田翔瑛', '大隈朋美', '大瀬良強', '中川慧哉', '渡辺安優奈', '東愛', '板垣南由太', '冨岡千愛', '平野智大', '柳田優',
  '安田浩晃', '安東瑞輝', '安藤純平', '越智秀也', '亀谷新', '山中誠子', '山田佑咲', '瀬戸山理恵', '太田暁', '檀上徳之',
  '池田貴光', '中山信哉', '田﨑幸治', '冨田翔太', '福元崇恭', '直江英恵', '直江弘明',
];

// 入力の上限（スプレッドシートの1セルに収まり、画面で読み切れる長さ）
export const LIMITS = { title: 100, text: 3000, members: 10, name: 30 } as const;

export type Kaizen = {
  id: string;
  month: string; // 対象月 YYYY-MM
  submittedAt: string; // 提出日時 YYYY/MM/DD HH:mm
  members: string[]; // 提出者（先頭が代表。一緒に取り組んだ人も入る）
  campus: string; // 校舎（「校」は付けない）
  title: string;
  before: string;
  after: string;
  beforePhotos: string[]; // 写真の URL（Drive）。開発中だけ data URL
  afterPhotos: string[];
  enteredBy: string; // 入力した人（ログインしていた人）
  enteredDept: string; // 入力した人の部門
  updatedAt: string;
  updatedBy: string;
  source: string; // 旧スプレッドシートから取り込んだ行の目印（アプリから出したものは空）
};

export type KaizenVote = {
  month: string; // 投票した対象月
  voter: string;
  dept: string;
  ids: string[]; // 投票先の改善 ID
  votedAt: string;
};

/** 管理部門が早めに締め切った（または再開した）記録。対象月ごとに1件。 */
export type KaizenClose = { month: string; closed: boolean; by: string; at: string };

export type KaizenInput = {
  month: string;
  members: string[];
  campus: string;
  title: string;
  before: string;
  after: string;
};

// ---- 月の計算（日本時間） -------------------------------------------------

/** 今日（日本時間）の YYYY-MM-DD。 */
export function todayJst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** 日本時間の YYYY/MM/DD HH:mm（シートに書く日時の形）。 */
export function nowJstText(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}/${g('month')}/${g('day')} ${g('hour')}:${g('minute')}`;
}

/** 「2026-09」「2026/09」「2026/9/30 12:00」などを YYYY-MM にそろえる。読めなければ空。 */
export function normalizeMonth(s: string): string {
  const m = String(s ?? '').trim().match(/^(\d{4})[-/年](\d{1,2})/);
  if (!m) return '';
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return '';
  return `${m[1]}-${String(mo).padStart(2, '0')}`;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** 2026-09 → 2026年9月 */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return y && m ? `${y}年${m}月` : month;
}

/** 2026-09 → 9月 */
export function shortMonthLabel(month: string): string {
  const m = Number(month.split('-')[1]);
  return m ? `${m}月` : month;
}

/** その月の改善への投票が自動で締まる日（翌月の末日）。2026-09 → 10月31日 */
export function voteDeadlineLabel(month: string): string {
  const next = addMonths(month, 1);
  const [y, m] = next.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${m}月${last}日`;
}

// ---- 投票の受付状態 -------------------------------------------------------

/**
 * collecting … 提出を受け付けている月（今月）
 * open       … 投票を受け付けている月（先月。管理部門が締め切るまで）
 * closed     … 投票が締まった月（先々月より前、または管理部門が締め切った先月）
 */
export type VotingState = 'collecting' | 'open' | 'closed';

export function findClose(closes: KaizenClose[], month: string): KaizenClose | undefined {
  return closes.find((c) => c.month === month);
}

export function votingState(month: string, today: string, closes: KaizenClose[]): VotingState {
  const cur = today.slice(0, 7);
  if (month >= cur) return 'collecting';
  if (month === addMonths(cur, -1)) return findClose(closes, month)?.closed ? 'closed' : 'open';
  return 'closed';
}

/** 提出先に選べる月。今月と、投票中の先月（出し忘れ用。締め切るまで）。 */
export function submittableMonths(today: string, closes: KaizenClose[]): string[] {
  const cur = today.slice(0, 7);
  const prev = addMonths(cur, -1);
  return votingState(prev, today, closes) === 'open' ? [cur, prev] : [cur];
}

// ---- 提出 ---------------------------------------------------------------

/** 自分の改善か（入力した人、または提出者に名前がある人）。 */
export function isOwner(k: Kaizen, user: string): boolean {
  return k.enteredBy === user || k.members.includes(user);
}

/** 直したり消したりできるか。管理部門はいつでも、本人はその月の投票が締まるまで。 */
export function canEdit(k: Kaizen, user: string, isAdmin: boolean, today: string, closes: KaizenClose[]): boolean {
  if (isAdmin) return true;
  return isOwner(k, user) && votingState(k.month, today, closes) !== 'closed';
}

/** 名前の並び（「、」「,」改行区切り）を配列にする。旧スプレッドシートは「, 」で並んでいる。 */
export function splitNames(s: string): string[] {
  return String(s ?? '')
    .split(/[、,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 写真の URL の並び（改行・空白・カンマ区切り）を配列にする。 */
export function splitUrls(s: string): string[] {
  return String(s ?? '')
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter((x) => /^(https?:|data:image\/)/.test(x));
}

function cleanText(v: unknown, max: number): string {
  return String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

/** 画面から届いた入力を整える（型をそろえ、前後の空白と重複した名前を落とす）。 */
export function normalizeInput(raw: unknown): KaizenInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const members: string[] = [];
  const list = Array.isArray(r.members) ? r.members : splitNames(String(r.members ?? ''));
  for (const m of list) {
    const n = cleanText(m, LIMITS.name);
    if (n && !members.includes(n)) members.push(n);
  }
  return {
    month: normalizeMonth(String(r.month ?? '')),
    members: members.slice(0, LIMITS.members),
    campus: cleanText(r.campus, 20),
    title: cleanText(r.title, LIMITS.title).replace(/\n+/g, ' '),
    before: cleanText(r.before, LIMITS.text),
    after: cleanText(r.after, LIMITS.text),
  };
}

/** 入力の不足を利用者向けの文で返す。問題なければ null。 */
export function validateInput(input: KaizenInput, allowedMonths: string[]): string | null {
  if (!allowedMonths.includes(input.month)) return 'この月にはもう提出できません（投票が締め切られています）。';
  if (input.members.length === 0) return '提出者を入れてください。';
  if (!(KAIZEN_CAMPUSES as readonly string[]).includes(input.campus)) return '校舎を選んでください。';
  if (!input.title) return '改善タイトルを入れてください。';
  if (!input.before) return 'Before（改善前）を入れてください。';
  if (!input.after) return 'After（改善後）を入れてください。';
  return null;
}

// ---- 表示 ---------------------------------------------------------------

/** 日野 → 日野校（すでに「校」が付いていればそのまま）。 */
export function campusLabel(c: string): string {
  if (!c) return '';
  return c.endsWith('校') ? c : `${c}校`;
}

/** 旧スプレッドシートの投票と同じ書き方：日野校：安東瑞輝「おはよう勉強会リフレクション集」 */
export function kaizenLabel(k: Pick<Kaizen, 'campus' | 'members' | 'title'>): string {
  return `${campusLabel(k.campus)}：${k.members.join('・')}「${k.title}」`;
}

/** Drive の URL からファイル ID を取り出す（open?id=… / file/d/…/view の両方）。 */
export function driveFileId(url: string): string {
  const m = url.match(/[?&]id=([\w-]{10,})/) || url.match(/\/d\/([\w-]{10,})/);
  return m ? m[1] : '';
}

/** 画面に出す縮小画像の URL。Drive の写真はサムネイル（リンクを知っている人が見られる設定のときだけ表示できる）。 */
export function photoThumbUrl(url: string, width = 800): string {
  if (url.startsWith('data:')) return url;
  const id = driveFileId(url);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w${width}` : url;
}

// ---- 投票 ---------------------------------------------------------------

export type VoteCheck =
  | { ok: true; ids: string[] }
  | { ok: false; reason: 'closed' | 'too_many' | 'bad_choice' | 'own'; message: string };

/** 投票の中身を確かめる。ids は重複を落として返す（0件は「投票を取り消す」）。 */
export function checkVote(args: {
  month: string;
  ids: string[];
  voter: string;
  items: Kaizen[];
  today: string;
  closes: KaizenClose[];
}): VoteCheck {
  const { month, voter, items, today, closes } = args;
  if (votingState(month, today, closes) !== 'open') {
    return { ok: false, reason: 'closed', message: `${monthLabel(month)}分の投票は受け付けていません。` };
  }
  const ids = Array.from(new Set(args.ids.map(String).filter(Boolean)));
  if (ids.length > MAX_VOTES) {
    return { ok: false, reason: 'too_many', message: `選べるのは${MAX_VOTES}つまでです。` };
  }
  for (const id of ids) {
    const k = items.find((x) => x.id === id && x.month === month);
    if (!k) return { ok: false, reason: 'bad_choice', message: '選んだ改善が見つかりません。画面を読み込み直してください。' };
    if (k.members.includes(voter)) {
      return { ok: false, reason: 'own', message: `自分の改善（「${k.title}」）には投票できません。` };
    }
  }
  return { ok: true, ids };
}

/** 同じ月・同じ人の票が2件以上あれば、新しいほうだけを残す（シートを手で直したときの保険）。 */
export function latestVotes(votes: KaizenVote[]): KaizenVote[] {
  const by = new Map<string, KaizenVote>();
  for (const v of votes) {
    const key = `${v.month}|${v.voter}`;
    const cur = by.get(key);
    if (!cur || v.votedAt >= cur.votedAt) by.set(key, v);
  }
  return Array.from(by.values());
}

export type TallyRow = { id: string; votes: number; rank: number };
export type Tally = {
  rows: TallyRow[]; // 得票の多い順（同票は提出の早い順）
  awards: string[]; // 優秀賞（最多得票。同票は全員。0票なら無し）
  voters: { name: string; count: number }[]; // 人別の投票数
};

/** 1か月分の得票を数える。消された改善・ほかの月の改善への票は数えない。 */
export function tallyMonth(month: string, items: Kaizen[], votes: KaizenVote[]): Tally {
  const monthItems = items.filter((k) => k.month === month);
  const valid = new Set(monthItems.map((k) => k.id));
  const counts = new Map<string, number>(monthItems.map((k) => [k.id, 0]));
  const voters: { name: string; count: number }[] = [];
  for (const v of latestVotes(votes)) {
    if (v.month !== month) continue;
    const ids = Array.from(new Set(v.ids)).filter((id) => valid.has(id)).slice(0, MAX_VOTES);
    if (ids.length === 0) continue;
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    voters.push({ name: v.voter, count: ids.length });
  }
  const order = new Map(monthItems.map((k) => [k.id, k]));
  const rows = monthItems
    .map((k) => ({ id: k.id, votes: counts.get(k.id) ?? 0, rank: 0 }))
    .sort((a, b) => {
      if (b.votes !== a.votes) return b.votes - a.votes;
      const ka = order.get(a.id)!;
      const kb = order.get(b.id)!;
      return ka.submittedAt.localeCompare(kb.submittedAt) || ka.title.localeCompare(kb.title);
    });
  rows.forEach((r, i) => {
    r.rank = i > 0 && rows[i - 1].votes === r.votes ? rows[i - 1].rank : i + 1;
  });
  const top = rows[0]?.votes ?? 0;
  return { rows, awards: top > 0 ? rows.filter((r) => r.votes === top).map((r) => r.id) : [], voters };
}

/** 名簿のうち、その月に提出者として名前が無い人。 */
export function missingSubmitters(month: string, items: Kaizen[], roster: string[]): string[] {
  const done = new Set(items.filter((k) => k.month === month).flatMap((k) => k.members));
  return roster.filter((n) => !done.has(n));
}

// ---- 画面に渡す形 ---------------------------------------------------------

export type MonthView = {
  month: string;
  state: VotingState;
  closedBy: string; // 管理部門が早めに締め切ったときの名前
  count: number; // 提出件数
  voterCount: number; // 投票した人数
  myVote: string[];
  myVotedAt: string;
  /** 得票。締め切った月は全員に、受付中の月は管理部門にだけ見せる。 */
  tally: Tally | null;
  /** 管理部門だけに見せる：まだ提出していない人・まだ投票していない人 */
  admin: { missing: string[]; nonVoters: string[] } | null;
};

export type KaizenItemView = Kaizen & { mine: boolean; canEdit: boolean };

export type KaizenView = {
  today: string;
  currentMonth: string;
  votingMonth: string;
  isAdmin: boolean;
  submittableMonths: string[];
  items: KaizenItemView[]; // 新しい順
  months: MonthView[]; // 新しい順（提出のある月＋今月＋投票中の月）
  people: string[]; // 「一緒に取り組んだ人」の候補
};

export function buildView(args: {
  items: Kaizen[];
  votes: KaizenVote[];
  closes: KaizenClose[];
  user: string;
  isAdmin: boolean;
  today: string;
  roster?: string[];
  staffNames?: string[];
}): KaizenView {
  const { items, closes, user, isAdmin, today } = args;
  const roster = args.roster ?? KAIZEN_ROSTER;
  const votes = latestVotes(args.votes);
  const currentMonth = today.slice(0, 7);
  const votingMonth = addMonths(currentMonth, -1);

  const monthSet = new Set<string>([currentMonth, votingMonth, ...items.map((k) => k.month).filter(Boolean)]);
  const months: MonthView[] = Array.from(monthSet)
    .sort((a, b) => b.localeCompare(a))
    .map((month) => {
      const state = votingState(month, today, closes);
      const tally = tallyMonth(month, items, votes);
      const mine = votes.find((v) => v.month === month && v.voter === user);
      const close = findClose(closes, month);
      const visible = state === 'closed' || (state === 'open' && isAdmin);
      const voted = new Set(tally.voters.map((v) => v.name));
      return {
        month,
        state,
        closedBy: state === 'closed' && close?.closed ? close.by : '',
        count: items.filter((k) => k.month === month).length,
        voterCount: tally.voters.length,
        myVote: mine ? mine.ids.filter((id) => items.some((k) => k.id === id && k.month === month)) : [],
        myVotedAt: mine?.votedAt ?? '',
        tally: visible ? tally : null,
        admin: isAdmin ? { missing: missingSubmitters(month, items, roster), nonVoters: roster.filter((n) => !voted.has(n)) } : null,
      };
    });

  const people = Array.from(new Set([...roster, ...(args.staffNames ?? [])]));
  const sorted = [...items].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return {
    today,
    currentMonth,
    votingMonth,
    isAdmin,
    submittableMonths: submittableMonths(today, closes),
    items: sorted.map((k) => ({ ...k, mine: isOwner(k, user), canEdit: canEdit(k, user, isAdmin, today, closes) })),
    months,
    people,
  };
}
