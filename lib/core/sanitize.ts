// AIの「役割漏れ（role bleed）」対策。
// モデルが自分のターンを終えず "user 〜" / "assistant 〜" と偽の発話を続けて生成することがある。
// これを検知して切り落とし、履歴に混入・再送されて自己対話ループに増幅するのを防ぐ。

// 行頭（改行の直後）に user / assistant / human、およびモデルが崩して出す
// 変種（us / usr / usb / use）が現れたら、そこ以降を役割漏れとみなす。
// 直後が英小文字・空白でない（＝日本語や記号・行末）ことを条件にし、"useful" 等の英単語は誤爆しない。
const ROLE_BLEED = /\n\s*(?:us(?:er|r|b|e)?|assistants?|assistan|human)(?=[^a-z ]|$)/i;

export function stripRoleBleed(text: string): string {
  const m = text.match(ROLE_BLEED);
  return m && m.index != null ? text.slice(0, m.index).trimEnd() : text;
}

// 履歴を送信/保存する前に整える：
// - assistant メッセージの役割漏れを除去
// - 空（空白のみ）メッセージを除外
export function sanitizeHistory<T extends { role: string; content: string }>(msgs: T[]): T[] {
  return msgs
    .map((m) => (m.role === 'assistant' ? { ...m, content: stripRoleBleed(m.content) } : m))
    .filter((m) => typeof m.content === 'string' && m.content.trim().length > 0);
}
