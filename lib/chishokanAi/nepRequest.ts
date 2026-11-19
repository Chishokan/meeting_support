// 智翔館AI：NEPへの作成依頼（propose_nep_request）。ほかに依存しない（テストしやすいように）。
//
// 2026-11-19：API で画像を作る道具（generate_image）を一旦止め、画像・挿絵・背景・チラシなどの制作は NEP事業部に依頼する形にした。
// AI が依頼の案（作るもの・用途・大きさ・中身・入れないもの・納品希望日）を画面に出し、
// 職員が［この内容でNEPへ作成依頼を出す］を押したときだけ送る（app/api/chishokan-ai/nep-request）。
// 送り先は「問い合わせ」（Apps Script の saveInquiry。前からあるので再デプロイは要らない）。種別「NEPへの制作依頼」で入り、
// ヘルプデスクの「ご意見・不具合」の一覧に出て、NEP（管理者）が返事を書ける。

export const NEP_REQUEST_CATEGORY = 'NEPへの制作依頼';

export const NEP_KINDS = ['画像・イラスト', 'スライドの挿絵・背景', 'チラシ', 'ポスター', 'サイネージ', 'その他'] as const;
export type NepKind = (typeof NEP_KINDS)[number];

export const PROPOSE_NEP_REQUEST_TOOL = {
  name: 'propose_nep_request',
  description:
    'NEP事業部への作成依頼の案を画面に出す（職員が［この内容でNEPへ作成依頼を出す］を押したときだけ送られる）。' +
    '画像・イラスト・スライドの挿絵や背景・チラシ・ポスター・サイネージの画像を頼まれたときに使う（智翔館AI は画像を作らない。API での画像生成は一旦停止中）。' +
    '会話で分かっていることから、作るもの（title）・種類（kind）・用途と使う場面（purpose）・大きさや枚数（size）・中身（content：何を描くか、雰囲気、配色、構図、入れる文字）・' +
    '入れないもの（avoid）・納品希望日（due）・参考（notes：スライドや資料のURL、元にする画像）を埋める。' +
    '画像を作るときの指示文の案（prompt）があれば添える。分からない項目は空にせず「未定（相談）」と書き、回答で職員に確かめる。' +
    '回答では「送りました」と言い切らず、「下の［この内容でNEPへ作成依頼を出す］を押すと送られます」と伝える。1回の回答で3つまで。',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: '作るもの（1行・60字まで。例：夢・志セミナー スライドの背景画像5枚）' },
      kind: { type: 'string', enum: NEP_KINDS, description: '種類' },
      purpose: { type: 'string', description: '用途・使う場面（例：11/22 夢・志セミナーの表紙と語りかけの枚の背景）' },
      size: { type: 'string', description: '大きさ・縦横の比・枚数（例：16:9 を5枚、A4縦）' },
      content: { type: 'string', description: '中身：何を描くか・雰囲気・配色・構図・入れる文字（1500字まで）' },
      avoid: { type: 'string', description: '入れないもの（例：人物の顔、他社のロゴ、文字）' },
      due: { type: 'string', description: '納品希望日（例：2026年11月21日（土）。分からなければ「未定（相談）」）' },
      prompt: { type: 'string', description: '画像を作るときの指示文の案（任意。1500字まで）' },
      notes: { type: 'string', description: '参考：資料・スライドのURL、元にする画像、ほかの注意（任意）' },
    },
    required: ['title', 'content'],
  },
};

export type NepRequest = {
  title: string;
  kind: NepKind;
  purpose: string;
  size: string;
  content: string;
  avoid: string;
  due: string;
  prompt: string;
  notes: string;
};

/** 1回の回答で出せる案の数。 */
export const NEP_MAX_PER_TURN = 3;

const line = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const block = (v: unknown, n: number) =>
  typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, n) : '';

/** AI が渡した入力（または画面から送り返された案）を確かめて整える。足りなければ理由を返す。 */
export function checkNepRequest(input: Record<string, unknown>): { ok: true; value: NepRequest } | { ok: false; message: string } {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const title = line(o.title, 60);
  const content = block(o.content, 1500);
  if (!title) return { ok: false, message: 'title（作るもの）がありません。' };
  if (content.length < 5) return { ok: false, message: 'content（何を描くか・雰囲気など、作るものの中身）を書いてください。' };
  const kind = (NEP_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as NepKind) : 'その他';
  return {
    ok: true,
    value: {
      title,
      kind,
      purpose: line(o.purpose, 200),
      size: line(o.size, 120),
      content,
      avoid: line(o.avoid, 300),
      due: line(o.due, 60) || '未定（相談）',
      prompt: block(o.prompt, 1500),
      notes: block(o.notes, 600),
    },
  };
}

/** 問い合わせシートの「内容」に入れる文。 */
export function formatNepRequest(r: NepRequest, ctx: { conversationId?: string } = {}): string {
  const lines: string[] = [`【NEPへの制作依頼】${r.kind}｜${r.title}`, '', `■ 納品希望日：${r.due}`];
  if (r.purpose) lines.push(`■ 用途・使う場面：${r.purpose}`);
  if (r.size) lines.push(`■ 大きさ・枚数：${r.size}`);
  lines.push('', '■ 中身', r.content);
  if (r.avoid) lines.push('', `■ 入れないもの：${r.avoid}`);
  if (r.prompt) lines.push('', '■ 画像の指示文の案', r.prompt);
  if (r.notes) lines.push('', '■ 参考', r.notes);
  if (ctx.conversationId) lines.push('', `（智翔館AI の会話の番号：${ctx.conversationId}）`);
  return lines.join('\n');
}

/** 道具の結果として AI に返す文（案を画面に出しただけで、まだ送っていない）。 */
export function nepRequestToolResult(r: NepRequest): string {
  return (
    `NEPへの作成依頼の案を画面に出した（まだ送っていない）。作るもの：${r.title}（${r.kind}）。納品希望日：${r.due}。\n` +
    '回答には、案の要点を短く書き、「下の［この内容でNEPへ作成依頼を出す］を押すと NEP に送られます」と書く。「送りました」とは書かない。' +
    (r.due.startsWith('未定') ? '納品希望日が未定なので、いつまでに要るかを職員に確かめる。' : '')
  );
}
