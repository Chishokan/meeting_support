// Zoom の文字起こし（VTT 形式）を、議事録づくりに渡す文章にする（Zoom連携）。
//
// VTT はこういう形をしている：
//   WEBVTT
//
//   1
//   00:00:07.120 --> 00:00:09.800
//   安藤 純平: 成績表のデータをもらえないですか
//
// 番号と時刻を落とし、同じ人が続けて話した行はまとめる。
//
// ★画面・API・テストのどこからでも読めるよう、ここには import を置かない（型と計算だけ）。

const TIME_LINE = /^\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}\s+-->\s+\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}/;

/** VTT → 「話者：発言」の行を並べた文章。話者が無い行は発言だけにする。 */
export function vttToText(vtt: string): string {
  const out: string[] = [];
  let lastSpeaker = '';
  let inCue = false;
  for (const raw of String(vtt ?? '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      inCue = false;
      continue;
    }
    if (TIME_LINE.test(line)) {
      inCue = true;
      continue;
    }
    // 時刻の行より前にあるもの（WEBVTT の見出し・番号・NOTE）は本文ではない。
    if (!inCue) continue;
    // 「<v 安藤>こんにちは</v>」の形にも対応する。
    const tagged = line.match(/^<v\s+([^>]+)>(.*?)(<\/v>)?$/);
    const plain = tagged ? null : line.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
    const speaker = (tagged?.[1] ?? plain?.[1] ?? '').trim();
    const text = (tagged?.[2] ?? plain?.[2] ?? line).replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    if (speaker && speaker !== lastSpeaker) {
      out.push(`${speaker}：${text}`);
      lastSpeaker = speaker;
    } else {
      out.push(text);
    }
  }
  return out.join('\n');
}

/**
 * 日本語として文字起こしされているか（ひらがな・カタカナ・漢字が十分にあるか）。
 * Zoom の録画の文字起こしは、日本語の会議でも英語として処理されることがあり、
 * そのときは意味の通らない英単語の並びになる。そういう結果を議事録の材料にしないために見る。
 */
export function looksJapanese(text: string): boolean {
  const body = String(text ?? '').replace(/\s+/g, '');
  if (body.length < 10) return false;
  const jp = (body.match(/[぀-ヿ一-鿿]/g) ?? []).length;
  return jp / body.length >= 0.3;
}
