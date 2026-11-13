// 智翔館AI：不具合の報告。画面の「報告」ボタンから送られた内容を、問い合わせシートに入れる文にする。ほかに依存しない。
//
// 送り先は既存の「問い合わせ」（Apps Script の saveInquiry。ヘルプデスクの「ご意見・不具合」に一覧が出て、管理者が回答できる）。
// 種別は REPORT_CATEGORY。職員が書く内容（何が起きたか・詳しい状況・どうなってほしかったか）に、
// 画面が自動で添える状況（会話の番号・何回目のやり取り・読んだ資料・出た注意・切れた/止めた/エラー・選んだ作業・ブラウザ）を付ける。
// 質問と回答の先頭は、職員が「添える」を選んだときだけ入れる（ご意見・不具合の一覧はほかの職員にも見えるため）。
// 会話の全文は会話ログ（スプレッドシート）にあり、会話の番号で探せる。

export const REPORT_CATEGORY = '智翔館AIの不具合';

export const REPORT_KINDS = [
  '答えが間違っている・古い',
  '資料を読まない・見つけられない',
  'エラーが出た・止まった・途中で切れた',
  '時間がかかりすぎる',
  '文書・スライドが作れない、作ったものがおかしい',
  'ボタン・表示がおかしい',
  'その他',
] as const;

export type ReportContext = {
  conversationId?: string;
  turn?: number;
  at?: string;
  task?: string;
  sources?: string[];
  notices?: string[];
  flags?: string[];
  question?: string;
  answer?: string;
  userAgent?: string;
  screen?: string;
};

export type ReportInput = {
  kind: string;
  detail: string;
  expected?: string;
  includeText?: boolean;
  context?: ReportContext;
};

export const MAX_DETAIL = 3000;
const MAX_QUESTION = 400;
const MAX_ANSWER = 800;

const clip = (s: unknown, n: number) => {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length > n ? `${t.slice(0, n)}…（以下略）` : t;
};

/** 入力を確かめる。足りなければ、職員に見せる理由を返す。 */
export function checkReport(raw: unknown): { ok: true; input: ReportInput } | { ok: false; message: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = typeof o.kind === 'string' && (REPORT_KINDS as readonly string[]).includes(o.kind) ? o.kind : '';
  const detail = clip(o.detail, MAX_DETAIL);
  if (!kind) return { ok: false, message: '何が起きたかを選んでください。' };
  if (detail.length < 5) return { ok: false, message: '詳しい状況を書いてください（何をしようとして、どうなったか）。' };
  const c = (o.context && typeof o.context === 'object' ? o.context : {}) as Record<string, unknown>;
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, n).map((x) => clip(x, 200)) : []);
  return {
    ok: true,
    input: {
      kind,
      detail,
      expected: clip(o.expected, 1000),
      includeText: o.includeText === true,
      context: {
        conversationId: clip(c.conversationId, 40),
        turn: typeof c.turn === 'number' && Number.isFinite(c.turn) ? Math.max(0, Math.floor(c.turn)) : undefined,
        at: clip(c.at, 40),
        task: clip(c.task, 40),
        sources: list(c.sources, 15),
        notices: list(c.notices, 6),
        flags: list(c.flags, 6),
        question: clip(c.question, MAX_QUESTION),
        answer: clip(c.answer, MAX_ANSWER),
        userAgent: clip(c.userAgent, 160),
        screen: clip(c.screen, 20),
      },
    },
  };
}

/** 問い合わせシートの「内容」に入れる文。 */
export function formatReport(r: ReportInput): string {
  const c = r.context ?? {};
  const lines: string[] = [
    `【智翔館AI】${r.kind}`,
    '',
    '■ 詳しい状況',
    r.detail,
  ];
  if (r.expected) lines.push('', '■ どうなってほしかったか', r.expected);
  const info: string[] = [];
  if (c.conversationId) info.push(`会話の番号：${c.conversationId}${c.turn ? `（${c.turn}回目のやり取り）` : ''}（会話ログで探せます）`);
  if (c.at) info.push(`回答の時刻：${c.at}`);
  if (c.task) info.push(`選んだ作業：${c.task}`);
  if (c.flags?.length) info.push(`状態：${c.flags.join('、')}`);
  if (c.sources?.length) info.push(`読んだ資料：${c.sources.join('、')}`);
  if (c.notices?.length) info.push(`画面に出た注意：${c.notices.join(' ／ ')}`);
  if (c.screen || c.userAgent) info.push(`端末：${[c.screen, c.userAgent].filter(Boolean).join('／')}`);
  if (info.length) lines.push('', '■ 画面が添えた情報', ...info.map((x) => `- ${x}`));
  if (r.includeText && (c.question || c.answer)) {
    lines.push('', '■ 質問と回答（先頭）');
    if (c.question) lines.push(`（質問）${c.question}`);
    if (c.answer) lines.push(`（回答）${c.answer}`);
  }
  return lines.join('\n');
}
