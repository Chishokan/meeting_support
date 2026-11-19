// 智翔館AI：会議の記録を読む道具（get_meeting_records）と、議題の追加の案（propose_agenda_item）。ほかに依存しない（テストしやすいように）。
//
// 2026-11-18：部門ごとの決定事項・ToDo・事前共有（これからの会議の議題）について、智翔館AI が答えられるようにした。
// 読むのは「会議サポートアプリログ」の4つのシート（Apps Script の listDeptMinutes・listDeptDecisions・listDeptPreshare・listShareItems）：
//   部門会議議事録 … 議事録の全文（決定事項・継続審議・ToDo・他部門への依頼・次回会議）
//   部門決定事項   … 決定事項を1件1行
//   部門会議事前共有 … これからの部門会議の会議名・開催日時・議題・レジュメ
//   事前共有事項   … 全体会議に向けた各部門の協議・決裁・報告
// 議題の追加は、AI が案を出し、職員が画面の［追加する］を押したときだけ書く（app/api/chishokan-ai/agenda）。
// 日付の読み方（開催日時の欄）は lib/deptMinutesPreshare.ts と同じ考え方（ここでは import しない）。

export const MEETING_WHAT = ['all', 'decisions', 'todos', 'agenda', 'share', 'minutes'] as const;
export type MeetingWhat = (typeof MEETING_WHAT)[number];

export const MEETING_RECORDS_TOOL = {
  name: 'get_meeting_records',
  description:
    '会議の記録を読む：部門会議の議事録（決定事項・継続審議・ToDo・他部門への依頼・次回会議）、部門決定事項、これからの部門会議の事前共有（会議名・開催日時・議題）、' +
    '全体会議の事前共有事項（各部門の協議・決裁・報告）。「小中等部の最近の決定事項は？」「私の ToDo は？」「次の RED個別の会議の議題は？」「全体会議の協議事項は？」などに使う。' +
    'dept は部門名（小中等部・RED個別・高等部・LEC・英検・総務 など。省くと全部門）。what で読むものを絞る（all・decisions・todos・agenda・share・minutes）。' +
    'person で担当者、query で言葉、days で何日前までか（既定 45 日）を絞る。',
  input_schema: {
    type: 'object' as const,
    properties: {
      dept: { type: 'string', description: '部門名（省くと全部門）' },
      what: { type: 'string', enum: MEETING_WHAT, description: 'all（既定）・decisions（決定事項）・todos（ToDo）・agenda（これからの会議の議題）・share（全体会議の協議・決裁・報告）・minutes（議事録の継続審議・依頼・次回会議）' },
      person: { type: 'string', description: '担当者の名前（ToDo・決定事項を絞る）' },
      query: { type: 'string', description: '言葉で絞る（例：冬期講習、英検）' },
      days: { type: 'number', description: '何日前までの記録を見るか（1〜180。既定 45）' },
    },
  },
};

export const PROPOSE_AGENDA_TOOL = {
  name: 'propose_agenda_item',
  description:
    '部門会議の議題を足す案を、画面に出す（職員が［議題に追加する］を押したときだけ、次の部門会議の事前共有の議題に足される）。' +
    '「次の小中等部の会議の議題に〇〇を入れて」と頼まれたとき、または「議題を追加する」を選んだ職員が足したい議題を伝えたときに使う。どの部門の会議にも足せる。' +
    'meeting_id は get_meeting_records の「これからの部門会議」に出た事前共有ID（省くと、その部門のいちばん近い会議）。事前共有がまだ無い部門は「議題の候補」として残り、会議の担当者が事前共有を作るときに取り込む。' +
    '回答では「追加しました」と言い切らず、「下のボタンで追加してください」と伝える。',
  input_schema: {
    type: 'object' as const,
    properties: {
      dept: { type: 'string', description: '議題を足す部門' },
      item: { type: 'string', description: '議題（1行・60字まで。例：【協議】冬期講習の外部生募集の分担）' },
      detail: { type: 'string', description: '補足（目的・資料・決めたいこと。200字まで）' },
      meeting_id: { type: 'string', description: '事前共有ID（get_meeting_records に出たもの。省いてよい）' },
    },
    required: ['dept', 'item'],
  },
};

// --- シートの行（Apps Script が返す形） ---------------------------------------------
export type MinutesRec = { id: string; ts: string; campus: string; user: string; title: string; date: string; attendees: string; agenda: string; minutes: string };
export type DecisionRec = { ts: string; campus: string; meeting: string; date: string; title: string; detail: string; owner: string; due: string; related: string };
export type PreshareRec = { id: string; ts: string; campus: string; user: string; title: string; date: string; place: string; agenda: string; minutesId: string };
export type ShareRec = { ts: string; campus: string; user: string; kind: string; title: string; background: string; point: string; opinion: string };

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 「2026/9/10」「2026-09-10」「2026年9月10日」「2026-09-14T06:08:34Z」から 'YYYY-MM-DD'。読めなければ ''。 */
export function fullDay(s: string): string {
  const m = String(s ?? '').match(/(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/);
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return valid(y, mo, d) ? ymd(y, mo, d) : '';
}

/** 開催日時の欄から開催日。年の無い「11/24」は、書いた日（ts）の年とみなす（半年以上前になるなら翌年）。 */
export function meetingDayOf(date: string, ts: string): string {
  const f = fullDay(date);
  if (f) return f;
  const base = fullDay(ts);
  const m = String(date ?? '').match(/(\d{1,2})\s*[/月]\s*(\d{1,2})/);
  if (!m || !base) return base;
  const [mo, d] = [Number(m[1]), Number(m[2])];
  let y = Number(base.slice(0, 4));
  if (!valid(y, mo, d)) return base;
  if (dayDiff(ymd(y, mo, d), base) > 180) y += 1;
  return valid(y, mo, d) ? ymd(y, mo, d) : base;
}

export function dayDiff(a: string, b: string): number {
  const t = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** 部門の名前が合うか（「中等部」で「小中等部」、「RED」で「RED個別」、「総務」で「総務・人事・支援・管理」も拾う）。 */
export function deptMatch(campus: string, dept: string): boolean {
  const a = String(campus ?? '').replace(/\s/g, '');
  const b = String(dept ?? '').replace(/\s/g, '').replace(/部門$/, '');
  if (!b) return true;
  if (!a) return false;
  return a.includes(b) || b.includes(a) || a.toLowerCase().startsWith(b.toLowerCase());
}

/** 議事録の本文から「■ 見出し」の中身（次の「■」まで）。 */
export function minutesSection(text: string, heading: string): string {
  const lines = String(text ?? '').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^■\\s*${heading}`).test(l.trim()));
  if (start < 0) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^■/.test(lines[i].trim())) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

export type Todo = { text: string; owner: string; due: string; status: '未' | '済' | '未完了' | '' };

/** 議事録の「ToDo」欄の「- [ ] 内容 ／ 担当：〜 ／ 期限：〜」を1件ずつ（[〇] は済、[✕] は未完了）。 */
export function parseTodos(section: string): Todo[] {
  const out: Todo[] = [];
  for (const raw of String(section ?? '').split('\n')) {
    const l = raw.trim();
    // 「[〇 内容」のように ] が抜けた行もあるので、印は2字までにする
    const m = /^[-*・]?\s*\[\s*([^\]\s]{0,2})\s*\]?\s*(.+)$/.exec(l);
    if (!m || !/^[-*・]?\s*\[/.test(l)) continue;
    const mark = m[1].trim();
    const parts = m[2].split(/[／/]\s*(?=担当|期限)/);
    const text = parts[0].replace(/\s*[／/]\s*$/, '').trim();
    if (!text) continue;
    const owner = (parts.find((p) => /^担当/.test(p)) ?? '').replace(/^担当[：:]\s*/, '').replace(/\s*[／/]\s*$/, '').trim();
    const due = (parts.find((p) => /^期限/.test(p)) ?? '').replace(/^期限[：:]\s*/, '').trim();
    const status = /[〇○✓✔済]/.test(mark) ? '済' : /[✕×xX]/.test(mark) ? '未完了' : mark === '' ? '未' : '';
    out.push({ text, owner, due, status });
  }
  return out;
}

const clip = (s: string, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export type RecordsData = { minutes: MinutesRec[]; decisions: DecisionRec[]; preshare: PreshareRec[]; share: ShareRec[] };
export type RecordsOpts = { dept: string; what: MeetingWhat; person: string; query: string; days: number };

/** 入力を整える。 */
export function checkRecordsInput(input: Record<string, unknown>): RecordsOpts {
  const s = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const what = (MEETING_WHAT as readonly string[]).includes(String(input?.what)) ? (input.what as MeetingWhat) : 'all';
  const d = Number(input?.days);
  return { dept: s(input?.dept, 20), what, person: s(input?.person, 20), query: s(input?.query, 40), days: Number.isFinite(d) && d >= 1 ? Math.min(180, Math.floor(d)) : 45 };
}

/** これからの部門会議の事前共有（議事録がまだ無く、開催日が昨日以降。部門・言葉で絞り、近い順に8件まで）。画面のボタンにも使う。 */
export function upcomingPreshareRows(preshare: PreshareRec[], o: RecordsOpts, today: string): { r: PreshareRec; day: string }[] {
  const hit = (...xs: string[]) => !o.query || xs.some((x) => String(x ?? '').includes(o.query));
  return preshare
    .filter((r) => !r.minutesId && deptMatch(r.campus, o.dept))
    .map((r) => ({ r, day: meetingDayOf(r.date, r.ts) }))
    .filter((x) => x.day && dayDiff(today, x.day) >= -1 && hit(x.r.title, x.r.agenda))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(0, 8);
}

/** 読んだ記録を、AI に渡す文にする（部門・期間・担当者・言葉で絞り、長くなりすぎないように切る）。 */
export function formatMeetingRecords(data: RecordsData, o: RecordsOpts, today: string, maxChars = 24_000): string {
  const inDept = (c: string) => deptMatch(c, o.dept);
  const recent = (day: string) => !day || dayDiff(day, today) <= o.days;
  const hit = (...xs: string[]) => !o.query || xs.some((x) => String(x ?? '').includes(o.query));
  const byPerson = (owner: string) => !o.person || String(owner ?? '').includes(o.person);
  const want = (w: MeetingWhat) => o.what === 'all' || o.what === w;
  const out: string[] = [];
  const head = `【会議の記録（${o.dept || '全部門'}・${o.what === 'all' ? 'すべて' : o.what}${o.person ? `・担当 ${o.person}` : ''}${o.query ? `・「${o.query}」` : ''}・${o.days}日前まで。今日 ${today}）】`;

  if (want('agenda')) {
    const rows = upcomingPreshareRows(data.preshare, o, today);
    out.push('■ これからの部門会議（事前共有）');
    if (!rows.length) out.push('（事前共有された会議はありません）');
    for (const { r, day } of rows) {
      const agenda = String(r.agenda ?? '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-14);
      out.push(`- ${r.campus}｜${r.title}｜開催 ${r.date || day}｜事前共有ID ${r.id}｜共有：${r.user}`, ...agenda.map((l) => `    ${clip(l, 120)}`));
    }
  }

  if (want('decisions')) {
    const rows = data.decisions
      .filter((d) => inDept(d.campus) && recent(meetingDayOf(d.date, d.ts)) && byPerson(d.owner) && hit(d.title, d.detail, d.related))
      .slice(0, 40);
    out.push('', '■ 決定事項（部門決定事項）');
    if (!rows.length) out.push('（該当なし）');
    for (const d of rows) {
      out.push(`- ${d.campus}｜${d.meeting} ${d.date}｜${clip(d.title, 60)}：${clip(d.detail, 120)}（担当：${d.owner || '未定'}／期限：${d.due || '未定'}${d.related && d.related !== '自部門のみ' ? `／関係：${d.related}` : ''}）`);
    }
  }

  const mins = data.minutes.filter((m) => inDept(m.campus) && recent(meetingDayOf(m.date, m.ts)));
  if (want('todos')) {
    const rows: string[] = [];
    for (const m of mins) {
      for (const t of parseTodos(minutesSection(m.minutes, 'ToDo'))) {
        if (!byPerson(t.owner) || !hit(t.text, t.owner)) continue;
        rows.push(`- ${m.campus}｜${m.title} ${m.date}｜${t.status === '済' ? '［済］' : t.status === '未完了' ? '［未完了］' : '［ ］'}${clip(t.text, 100)}（担当：${t.owner || '未定'}／期限：${t.due || '未定'}）`);
      }
    }
    out.push('', '■ ToDo（議事録の「ToDo」欄。新しい会議から）');
    out.push(...(rows.length ? rows.slice(0, 60) : ['（該当なし）']));
  }

  if (want('minutes')) {
    out.push('', '■ 議事録（継続審議・他部門への依頼・次回会議。新しい会議から）');
    const rows = mins.filter((m) => hit(m.title, m.minutes)).slice(0, 8);
    if (!rows.length) out.push('（該当なし）');
    for (const m of rows) {
      const sec = (h: string) => minutesSection(m.minutes, h).split('\n').map((l) => l.trim()).filter((l) => l && !/^(該当なし|特になし)$/.test(l)).slice(0, 6);
      out.push(`- ${m.campus}｜${m.title}｜${m.date}｜議事録ID ${m.id}`);
      for (const [label, h] of [['継続審議', '継続審議'], ['他部門への依頼', '他部門への依頼'], ['次回会議', '次回会議']] as const) {
        const ls = sec(h);
        if (ls.length) out.push(`    ［${label}］`, ...ls.map((l) => `      ${clip(l, 120)}`));
      }
    }
  }

  if (want('share')) {
    const rows = data.share.filter((s) => inDept(s.campus) && recent(fullDay(s.ts)) && hit(s.title, s.point, s.background)).slice(0, 30);
    out.push('', '■ 全体会議の事前共有事項（協議・決裁・報告）');
    if (!rows.length) out.push('（該当なし）');
    for (const s of rows) {
      out.push(`- ${s.campus}｜${fullDay(s.ts)}｜【${s.kind}】${clip(s.title, 60)}${s.point ? `／論点：${clip(s.point, 100)}` : ''}${s.opinion ? `／意見：${clip(s.opinion, 80)}` : ''}（${s.user}）`);
    }
  }

  let body = [head, ...out].join('\n');
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n…（長いので途中まで。部門・期間・担当者・言葉で絞ってもう一度読む）`;
  return (
    `${body}\n\n` +
    '答え方：聞かれた部門・項目だけを抜き出す。出典として会議名と日付を書く。生徒・保護者の名前はイニシャルにする。' +
    '記録に無いことは「記録に無い」と書く（作らない）。議題を足してと頼まれたら propose_agenda_item を使う。' +
    (want('agenda') ? `\n${AGENDA_CHOICE_RULE}` : '')
  );
}

// --- 事前共有を聞かれたときの、議題の追加を促す選択肢（2026-11-19） ----------------------
// 部門会議の事前共有（これからの会議の議題）について答えたら、回答の最後に「議題を追加する」を出して、議題の追加を促す。
// AI が付け忘れたときは、アプリ（app/api/chishokan-ai/route.ts）が回答の最後に付け足す。

export const AGENDA_CHOICE = '議題を追加する';
export const AGENDA_CHOICE_BLOCK = '```選択肢\n' + AGENDA_CHOICE + '\n```';
const AGENDA_CHOICE_RULE =
  '画面には、回答の下に会議ごとの［意見を足す］［修正する］ボタンが出る（押すと編集の小窓が開く）。事前共有に意見を書き足したい・直したいと言われたら、そのボタンを使うよう伝える。\n' +
  '部門会議の事前共有（これからの会議の議題）について答えたときは、回答の最後に次の選択肢を付けて、議題の追加を促す（選択肢のあとには何も書かない）：\n' +
  AGENDA_CHOICE_BLOCK;

/** この質問が、部門会議の事前共有（これからの会議の議題）を聞いているか。what が agenda か、all で質問に事前共有・議題の言葉があるとき。 */
export function asksAboutPreshare(what: MeetingWhat, userText: string): boolean {
  if (what === 'agenda') return true;
  return what === 'all' && /事前共有|議題|レジュメ|次の.{0,12}会議/.test(String(userText ?? ''));
}

/** 回答の最後に「議題を追加する」の選択肢を付け足すか。選択肢がもうある・議題の案を出した・回答が空なら付けない。 */
export function needsAgendaChoice(answer: string, opts: { asked: boolean; proposed: boolean }): boolean {
  if (!opts.asked || opts.proposed) return false;
  const t = String(answer ?? '');
  if (!t.trim()) return false;
  return !/```[ \t]*(?:選択肢|choices)/.test(t);
}

// --- 議題の追加の案 -----------------------------------------------------------------
export type AgendaInput = { dept: string; item: string; detail: string; meetingId: string };

export function checkAgendaInput(input: Record<string, unknown>): { ok: true; value: AgendaInput } | { ok: false; message: string } {
  const s = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const dept = s(input?.dept, 20);
  const item = s(input?.item, 60);
  if (!dept) return { ok: false, message: 'dept（議題を足す部門）がありません。' };
  if (!item) return { ok: false, message: 'item（議題）がありません。' };
  return { ok: true, value: { dept, item, detail: s(input?.detail, 200), meetingId: s(input?.meeting_id, 60) } };
}

/** 議題を足す会議を選ぶ：meeting_id があればそれ、無ければその部門のいちばん近い（今日以降の）事前共有。無ければ null（議題の候補）。 */
export function pickAgendaTarget(rows: PreshareRec[], dept: string, meetingId: string, today: string): PreshareRec | null {
  if (meetingId) {
    const r = rows.find((x) => x.id === meetingId && !x.minutesId);
    if (r) return r;
  }
  const cands = rows
    .filter((r) => !r.minutesId && deptMatch(r.campus, dept))
    .map((r) => ({ r, day: meetingDayOf(r.date, r.ts) }))
    .filter((x) => x.day && dayDiff(today, x.day) >= 0)
    .sort((a, b) => a.day.localeCompare(b.day));
  return cands[0]?.r ?? null;
}

/** 事前共有の議題に足す1行（あとから足したことと、足した人が分かるように）。 */
export function agendaLine(item: string, detail: string, user: string, stamp: string): string {
  return `・【追加】${item}${detail ? `（${detail}）` : ''}〔${user} ${stamp}〕`;
}

/** 事前共有の議題のうち、あとから足した行（「・【追加】」で始まる行）。 */
export function addedAgendaLines(agenda: string): string[] {
  return String(agenda ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('・【追加】'));
}

/** 手元の議題に、サーバ側で足された行のうち手元に無いものを足す（事前共有を上書きしても、足された議題を消さないように）。 */
export function mergeAddedAgenda(local: string, server: string): string {
  const have = new Set(String(local ?? '').split('\n').map((l) => l.trim()));
  const add = addedAgendaLines(server).filter((l) => !have.has(l));
  if (!add.length) return local;
  return `${String(local ?? '').replace(/\s+$/, '')}\n${add.join('\n')}`;
}
