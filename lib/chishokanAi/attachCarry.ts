// 智翔館AI：添付した PDF・画像を、次の質問にも付け直す（持ち越す）決まり。ほかに依存しない（画面とテストで使う）。
//
// 2026-11-16 の会話ログ：模試の PDF を添付した次の質問で、AI が「問題文が渡されていない」と答え、
// 最後は問題を覚えている範囲で打ち直していた（解答と解説の食い違いの原因）。
// 文字にした添付（Word・Excel など）は前から持ち越している（コンテキストの texts）。PDF・画像は画面で覚えておき、
// 次の質問から送り直す。送る大きさには上限があるので、件数と大きさを決めておき、古いものから外す。
// 保存した会話には入れない（大きすぎるため）。

export type HeavyAttach = { name: string; mime: string; kind: 'pdf' | 'image'; data: string };

/** 持ち越す PDF・画像の数の上限。 */
export const CARRY_MAX_FILES = 3;
/** 持ち越す PDF・画像の大きさの上限（base64 の文字数の合計）。 */
export const CARRY_MAX_CHARS = 2_500_000;

export function isHeavy(a: { kind: string }): boolean {
  return a.kind === 'pdf' || a.kind === 'image';
}

/**
 * 回答のあとに持ち越すもの：今回送った PDF・画像 → 前から持ち越していたもの の順に（新しいものが先）、
 * 同じ名前は新しい方だけ、件数と大きさの上限まで。外したものの名前も返す。
 */
export function nextCarry(prev: HeavyAttach[], sent: HeavyAttach[]): { keep: HeavyAttach[]; dropped: string[] } {
  const keep: HeavyAttach[] = [];
  const dropped: string[] = [];
  let size = 0;
  const seen = new Set<string>();
  for (const a of [...sent, ...prev]) {
    if (!isHeavy(a) || !a.data || seen.has(a.name)) continue;
    seen.add(a.name);
    if (keep.length >= CARRY_MAX_FILES || size + a.data.length > CARRY_MAX_CHARS) {
      dropped.push(a.name);
      continue;
    }
    keep.push(a);
    size += a.data.length;
  }
  return { keep, dropped };
}

/**
 * 質問を送るときに付け直すもの：新しい添付と合わせて maxTotal（送る大きさの上限）を超えないよう、古いものから外す。
 * 新しい添付と同じ名前のものは付け直さない（新しい方を送る）。
 */
export function carryForSend(
  carried: HeavyAttach[],
  fresh: { name: string; data: string }[],
  maxTotal: number,
): { send: HeavyAttach[]; dropped: string[] } {
  const names = new Set(fresh.map((a) => a.name));
  let size = fresh.reduce((n, a) => n + a.data.length, 0);
  const send: HeavyAttach[] = [];
  const dropped: string[] = [];
  for (const a of carried) {
    if (names.has(a.name)) continue;
    if (size + a.data.length > maxTotal) {
      dropped.push(a.name);
      continue;
    }
    send.push(a);
    size += a.data.length;
  }
  return { send, dropped };
}

/** 付け直した PDF・画像を AI に知らせる文（サーバで添付の前に置く）。 */
export function carriedNote(names: string[]): string {
  return (
    `【前の質問で添付された資料（画面が付け直したもの）：${names.join('、')}】\n` +
    'この会話の前の回で職員が添付した資料。今回の質問の材料として使ってよい。「添付が無い」「問題文が渡されていない」と言わない。'
  );
}

/**
 * 質問を書かずに添付だけを送ったときの質問。
 * 2026-11-16 の会話ログ：会話の途中で「改めて貼る」つもりで PDF だけを送ったら、方針チェックとして送られ、
 * そのあとも作業が方針チェックのまま続いた。作業を選んでいればその作業、会話の途中なら続き、はじめてなら要点と次の一手にする。
 */
export function attachOnlyQuestion(o: { task?: string; ongoing: boolean }): string {
  if (o.task) return `添付した資料で「${o.task}」を進めてください。`;
  if (o.ongoing) return '資料を添付しました。この資料も使って、前の続きを進めてください。';
  return '添付した資料の要点をまとめて、この資料で何をするとよいか選べるようにしてください。';
}
