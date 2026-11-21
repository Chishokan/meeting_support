// ヘルプデスク「マニュアル」タブの検索（components/ManualBrowser.tsx）。
// 全角・半角、ひらがな・カタカナ、大文字・小文字の違いは区別しない。
// 空白で区切った言葉は、すべて含むものだけを残す（例：「部門会議 動画」）。

export type SearchableManual = {
  title: string;
  desc: string;
  kind: 'pdf' | 'video';
};

// 比べる前にそろえる。NFKC で全角英数・半角カナをそろえ、カタカナはひらがなにする。
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function splitQuery(query: string): string[] {
  return normalizeForSearch(query)
    .split(/\s+/)
    .filter(Boolean);
}

// 検索の対象：題名・説明・分類名・種類（「PDF」「動画」でも探せる）
export function matchesManual(m: SearchableManual, categoryLabel: string, words: string[]): boolean {
  if (words.length === 0) return true;
  const hay = normalizeForSearch(
    [m.title, m.desc, categoryLabel, m.kind === 'pdf' ? 'PDF 資料 印刷' : '動画 ビデオ 再生'].join(' '),
  );
  return words.every((w) => hay.includes(w));
}
