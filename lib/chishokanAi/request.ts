// 智翔館AI：要望。画面の「要望を送る」ボタンから送られた内容を、問い合わせシートに入れる文にする。ほかに依存しない。
//
// 送り先は不具合の報告と同じ「問い合わせ」（Apps Script の saveInquiry。ヘルプデスクの「ご意見・不具合」に一覧が出て、管理者が回答できる）。
// 種別は REQUEST_CATEGORY。改善のために、こういう使い方をしたい・この作業に対応してほしい・この資料をナレッジに入れてほしい・
// このフォルダやファイルをリンクで読めるようにしてほしい、などを集める。

export const REQUEST_CATEGORY = '智翔館AIへの要望';

export const REQUEST_KINDS = [
  'こういう使い方をしたい（新しい作業・資料づくり）',
  'いまの作業・答え方をこう変えてほしい',
  'ナレッジに入れてほしい資料・情報',
  'ドライブのリンクで読めるようにしてほしいフォルダ・ファイル',
  '画面・ボタンの使い勝手',
  'その他',
] as const;

export type RequestInput = {
  kind: string;
  detail: string;
  scene?: string;
  links?: string[];
  context?: { conversationId?: string; turn?: number; task?: string };
};

export const MAX_REQUEST_DETAIL = 3000;

const clip = (s: unknown, n: number) => {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length > n ? `${t.slice(0, n)}…（以下略）` : t;
};

/** 文の中のURLを取り出す（ドライブのリンクなど。最大10件）。 */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'（）「」『』【】、。]+/g)) if (!out.includes(m[0])) out.push(m[0]);
  return out.slice(0, 10);
}

/** 入力を確かめる。足りなければ、職員に見せる理由を返す。 */
export function checkRequest(raw: unknown): { ok: true; input: RequestInput } | { ok: false; message: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = typeof o.kind === 'string' && (REQUEST_KINDS as readonly string[]).includes(o.kind) ? o.kind : '';
  const detail = clip(o.detail, MAX_REQUEST_DETAIL);
  if (!kind) return { ok: false, message: '要望の種類を選んでください。' };
  if (detail.length < 5) return { ok: false, message: '要望の内容を書いてください（何ができるとよいか）。' };
  const c = (o.context && typeof o.context === 'object' ? o.context : {}) as Record<string, unknown>;
  return {
    ok: true,
    input: {
      kind,
      detail,
      scene: clip(o.scene, 1500),
      links: extractUrls(typeof o.links === 'string' ? o.links : ''),
      context: {
        conversationId: clip(c.conversationId, 40),
        turn: typeof c.turn === 'number' && Number.isFinite(c.turn) ? Math.max(0, Math.floor(c.turn)) : undefined,
        task: clip(c.task, 40),
      },
    },
  };
}

/** 問い合わせシートの「内容」に入れる文。 */
export function formatRequest(r: RequestInput): string {
  const c = r.context ?? {};
  const lines: string[] = [`【智翔館AIへの要望】${r.kind}`, '', '■ 要望の内容', r.detail];
  if (r.scene) lines.push('', '■ 使う場面・例', r.scene);
  if (r.links?.length) lines.push('', '■ リンク', ...r.links.map((u) => `- ${u}`));
  const info: string[] = [];
  if (c.conversationId) info.push(`会話の番号：${c.conversationId}${c.turn ? `（${c.turn}回目のやり取りのあと）` : ''}`);
  if (c.task) info.push(`選んでいた作業：${c.task}`);
  if (info.length) lines.push('', '■ 画面が添えた情報', ...info.map((x) => `- ${x}`));
  return lines.join('\n');
}
