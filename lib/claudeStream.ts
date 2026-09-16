// Claude へのストリーミング呼び出しを一箇所にまとめる。
//
// 会議AI・中間報告・議事録・部門会議議事録・問い合わせQA・要項QA は、
// 「system プロンプト＋履歴を送り、テキストを逐次返し、終わったら会話ログに残す」
// という同じ形をしている。以前は各 Route Handler に同じループが書かれていたため、
// STOP 条件や max_tokens の変更・ログ形式の変更を6箇所で行う必要があった。
//
// 各ルートに残るのは「system プロンプトの組み立て」と「ログに残す入力の表記」だけ。

import Anthropic from '@anthropic-ai/sdk';
import { MODEL, THINKING } from './systemPrompt';
import { logInteraction } from './log';
import { stripRoleBleed } from './sanitize';

export type Msg = { role: 'user' | 'assistant'; content: string };

// モデルが偽の user/assistant ターン（崩れた us/use/usb を含む）を書き始めたら即停止させる。
export const STOP_SEQUENCES = ['\n\nus', '\n\nUs', '\n\nassistant', '\n\nAssistant', '\n\nhuman', '\n\nHuman'];

const client = new Anthropic();

/** system プロンプトにキャッシュポイントを置く（セッション内で固定なので毎ターン再送しない）。 */
export function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

/**
 * 履歴を Claude へ渡す形にし、直近メッセージにキャッシュポイントを置く。
 * extraBlocks は直近ターンの本文より前に差し込む（添付ファイルなど。履歴には残さない）。
 */
export function cachedMessages(messages: Msg[], extraBlocks: Anthropic.ContentBlockParam[] = []): Anthropic.MessageParam[] {
  return messages.map((m, i) =>
    i === messages.length - 1
      ? {
          role: m.role,
          content: [
            ...extraBlocks,
            { type: 'text', text: m.content, cache_control: { type: 'ephemeral' } },
          ] as Anthropic.ContentBlockParam[],
        }
      : { role: m.role, content: m.content },
  );
}

/** 直近の user 発言（会話ログの「入力」欄に残す）。 */
export function lastUserText(messages: Msg[]): string {
  return [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
}

export type StreamArgs = {
  /** ログの見出し（[CACHE label]）。機能名を入れる。 */
  label: string;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  /** 会話ログに残す内容。output はストリーム完了後にここで埋める。 */
  log: { user: string; campus: string; input: string };
  /** キャッシュログに添える補足（rows=… など）。 */
  cacheNote?: string;
};

/**
 * Claude をストリーミングで呼び、テキストをそのまま流し返す Response を作る。
 * 完了後（失敗時も）に会話ログへ記録する。途中で失敗したら画面向けのエラー文を末尾に流す。
 */
export function streamClaude(args: StreamArgs): Response {
  const encoder = new TextEncoder();
  let full = '';
  let cacheLog = '';

  const rs = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: args.maxTokens,
          thinking: THINKING,
          system: cachedSystem(args.system),
          messages: args.messages,
          stop_sequences: STOP_SEQUENCES,
        });
        for await (const ev of stream) {
          if (ev.type === 'message_start') {
            const u = ev.message.usage;
            cacheLog = `in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`;
          } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            full += ev.delta.text;
            controller.enqueue(encoder.encode(ev.delta.text));
          }
        }
      } catch {
        controller.enqueue(encoder.encode('\n[エラーが発生しました。もう一度お試しください。]'));
      } finally {
        if (cacheLog) {
          try {
            console.log(`[CACHE ${args.label}]`, cacheLog, args.cacheNote ?? '');
          } catch {}
        }
        try {
          await logInteraction({ ...args.log, output: stripRoleBleed(full) });
        } catch {}
        controller.close();
      }
    },
  });

  return new Response(rs, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
