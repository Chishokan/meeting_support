// 智翔館AI：Google ドライブのリンクの判定と、読めなかった理由の言い換え（ほかに依存しない部分）。

/** 1回の質問で読むリンクの上限（読みすぎて 60 秒の制限を超えないように）。 */
export const MAX_LINKS = 3;

const PATTERNS = [
  /https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([\w-]{10,})/g,
  /https?:\/\/drive\.google\.com\/(?:u\/\d+\/)?file\/d\/([\w-]{10,})/g,
  /https?:\/\/drive\.google\.com\/open\?(?:[^\s]*&)?id=([\w-]{10,})/g,
];

/** 文章から Google ドライブのファイルIDを取り出す（出てきた順・重複なし・上限つき）。 */
export function extractDriveIds(text: string, max = MAX_LINKS): string[] {
  const found: { id: string; at: number }[] = [];
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) found.push({ id: m[1], at: m.index ?? 0 });
  }
  const ids: string[] = [];
  for (const f of found.sort((a, b) => a.at - b.at)) {
    if (!ids.includes(f.id)) ids.push(f.id);
  }
  return ids.slice(0, max);
}

const REASONS: Record<string, string> = {
  not_configured: '読めるフォルダがまだ設定されていません（システム担当に連絡してください）',
  not_allowed: 'AIが読んでよいフォルダの外にあります',
  blocked_name: '名簿・成績・給与などの資料のため読みません',
  not_found: '見つからないか、共有されていません',
  unsupported: 'この種類のファイルには対応していません',
  too_large: 'ファイルが大きすぎます（4MBまで）',
  bad_id: 'リンクの形が正しくありません',
  read_failed: '読み取りに失敗しました',
  not_deployed: 'Apps Script が古いままです（再デプロイが必要）',
  upstream_error: 'Apps Script との通信に失敗しました',
  network_error: 'Apps Script との通信に失敗しました',
};

/** 読めなかった理由を、AIと職員に伝わる言葉にする。 */
export function reasonText(reason: string | undefined): string {
  return REASONS[reason ?? ''] ?? '読み取りに失敗しました';
}
