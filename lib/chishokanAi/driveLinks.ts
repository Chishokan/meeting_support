// 智翔館AI：Google ドライブのリンクの判定と、読めなかった理由の言い換え（ほかに依存しない部分）。

/** 1回の質問で貼られたリンクを先に読む上限（読みすぎて、答え始めるまでの待ち時間が長くならないように）。 */
export const MAX_LINKS = 3;

const PATTERNS = [
  /https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([\w-]{10,})/g,
  /https?:\/\/drive\.google\.com\/(?:u\/\d+\/)?file\/d\/([\w-]{10,})/g,
  /https?:\/\/drive\.google\.com\/open\?(?:[^\s]*&)?id=([\w-]{10,})/g,
];

const FOLDER_PATTERN = /https?:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]{10,})/g;

/** 文章から Google ドライブのフォルダIDを取り出す（出てきた順・重複なし・上限つき）。 */
export function extractDriveFolderIds(text: string, max = MAX_LINKS): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(FOLDER_PATTERN)) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids.slice(0, max);
}

/**
 * AI が読めるフォルダ（Apps Script の AI_READ_FOLDER_IDS と同じ）。
 * AI はフォルダ名だけでも開けるように、名前から ID を引けるようにしておく。
 * ★Apps Script 側の AI_READ_FOLDER_IDS を変えたら、ここも合わせる。
 */
export const DRIVE_ROOTS: Record<string, string> = {
  '05_広告制作': '1rDTV-Lg3YJmZHMSTfHs-ErDnpR3lhR_x',
  '10_研修会議': '1b7qfB8Ey-fkFxm7XMFtbkoARyuiKmzoz',
  '04_講習': '1x3qb8GA-rBxV3DoTmH00s4efJHn3GBKD',
};

/** ツールに渡された「URL か ID か、読めるフォルダの名前」から ID を取り出す。取り出せなければ null。 */
export function driveIdFrom(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  for (const [name, id] of Object.entries(DRIVE_ROOTS)) {
    if (s === name || s === name.replace(/^\d+_/, '')) return id;
  }
  const fromUrl = extractDriveIds(s, 1)[0] ?? extractDriveFolderIds(s, 1)[0];
  if (fromUrl) return fromUrl;
  return /^[\w-]{10,}$/.test(s) ? s : null;
}

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
  not_folder: 'フォルダではありません',
  read_failed: '読み取りに失敗しました',
  not_deployed: 'Apps Script が古いままです（再デプロイが必要）',
  upstream_error: 'Apps Script との通信に失敗しました',
  network_error: 'Apps Script との通信に失敗しました',
  timeout: 'Apps Script から時間内に返事がありませんでした',
  aborted: '止めました',
};

/** 読めなかった理由を、AIと職員に伝わる言葉にする。 */
export function reasonText(reason: string | undefined): string {
  return REASONS[reason ?? ''] ?? '読み取りに失敗しました';
}
