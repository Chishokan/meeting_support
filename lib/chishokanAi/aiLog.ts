// 智翔館AI の会話ログを、スプレッドシート「智翔館AI 会話ログ」のアカウント別のシートに残す。サーバ専用。
//
// 書き込むのは Apps Script の aiLog（apps_script/Code.gs）。氏名ごとのシートに1行（列を分けて）、「一覧」に短く1行。
// 再デプロイ前の Apps Script は aiLog を知らず、既定の「会話ログ」に input・output を書く。
// そのときも読めるよう、従来の形（input・output）も一緒に送る。
// 智翔館AI 以外のアプリのログは、これまでどおり lib/core/log.ts（会議サポートアプリログの「会話ログ」）。

import { callGas } from './gas';

export type AiLogKind = '質問' | '評価' | 'コンテキスト' | '議題' | '制作依頼';

export type AiLogEntry = {
  user: string;
  campus: string;
  /** 共通ログインで確かめたメールアドレス（無ければ空） */
  email?: string;
  kind: AiLogKind;
  conversationId?: string;
  turn?: number;
  /** 作業（手順書）の番号 */
  task?: string;
  /** 質問（評価・コンテキストの操作のときは、その中身） */
  question: string;
  answer?: string;
  /** AI が使った道具・読んだ資料 */
  sources?: string;
  /** 作ったファイル（題名と URL、作れなかった理由） */
  files?: string;
  /** コンテキスト欄の項目・直し案 */
  context?: string;
  /** 印（エラー・停止・時間切れ・作り話のリンク・資料に無い など） */
  flags?: string;
  /** 時間・往復・トークン */
  stats?: string;
};

/** 会話ログを残す。失敗しても本処理は止めない。legacy は再デプロイ前の Apps Script 向けの従来の形。 */
export async function logAi(e: AiLogEntry, legacy: { input: string; output: string }, opts: { timeoutMs?: number } = {}): Promise<void> {
  const ts = new Date().toISOString();
  try {
    console.log('[CHAT_LOG]', JSON.stringify({ ts, user: e.user, campus: e.campus, input: legacy.input, output: legacy.output.slice(0, 2000) }));
  } catch {
    // ログ出力の失敗は本処理を止めない
  }
  try {
    await callGas(
      { action: 'aiLog', ts, ...e, email: e.email ?? '', input: legacy.input, output: legacy.output },
      opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    );
  } catch {
    // 送信の失敗は本処理を止めない
  }
}
