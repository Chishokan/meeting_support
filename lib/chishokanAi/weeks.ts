// 智翔館AI：「今週」「来週」の日付の範囲（日本時間・月曜はじまり）。ほかに依存しない（テストしやすいように）。
//
// 2026-11-16（月）の会話ログ：「来週の門配は何を入れる？」に、AI が「来週（11/17〜）」と答え、
// 11/22 の模試を「来週が申込の追い込み」とした（職員に「来週は模試・テストは終わっています」と直された）。
// 本日の日付だけでは週の取り違えが起きるので、今週・来週・再来週の範囲もプロンプトに書く。

const WD = ['日', '月', '火', '水', '木', '金', '土'];

/** 日本時間の年月日（サーバは UTC で動く）。 */
function jst(now: Date): { y: number; m: number; d: number } {
  const t = new Date(now.getTime() + 9 * 3600_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function label(t: number): string {
  const d = new Date(t);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WD[d.getUTCDay()]}）`;
}

/** 「今週：11月16日（月）〜11月22日（日）／来週：…／再来週：…」の1行。 */
export function weekRanges(now: Date = new Date()): string {
  const { y, m, d } = jst(now);
  const today = Date.UTC(y, m - 1, d);
  const dow = new Date(today).getUTCDay();
  const monday = today - ((dow + 6) % 7) * 86_400_000;
  const range = (k: number) => `${label(monday + k * 7 * 86_400_000)}〜${label(monday + (k * 7 + 6) * 86_400_000)}`;
  return `今週：${range(0)}／来週：${range(1)}／再来週：${range(2)}`;
}
