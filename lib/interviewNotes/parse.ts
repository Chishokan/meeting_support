// 面談記録テキストから「面談記録本体」「確認事項」を取り出す（保存時に分けてシートの別の列に入れる）。
// ★区切りは lib/interviewNotes/prompt.ts の出力フォーマットと対になっている。片方を変えたら両方直すこと。

import { CHECK_CLOSE, CHECK_OPEN, NOTE_CLOSE, NOTE_OPEN } from '@/lib/interviewNotes/prompt';

// 開始／終了マーカーの間を取り出す。マーカーが無ければ空文字。
function between(text: string, open: string, close: string): string {
  const s = text.indexOf(open);
  if (s < 0) return '';
  const from = s + open.length;
  const e = text.indexOf(close, from);
  return text.slice(from, e < 0 ? undefined : e).trim();
}

// 面談記録の本体。マーカーが無い場合（利用者がマーカーごと消して編集した等）は
// 確認事項以降を落とした全文を本体とみなす。
export function extractNote(text: string): string {
  const body = between(text, NOTE_OPEN, NOTE_CLOSE);
  if (body) return body;
  const c = text.indexOf(CHECK_OPEN);
  return (c < 0 ? text : text.slice(0, c)).trim();
}

export function extractChecks(text: string): string {
  return between(text, CHECK_OPEN, CHECK_CLOSE);
}

// 保存済みの本文と確認事項を、編集欄でそのまま読める1つの文章に戻す
//（区切りが無いと、保存し直したときに確認事項が本文に混ざる）。
export function joinNote(note: string, checks: string): string {
  const body = note.trim();
  const c = checks.trim();
  return [NOTE_OPEN, body, NOTE_CLOSE, ...(c ? ['', CHECK_OPEN, c, CHECK_CLOSE] : [])].join('\n');
}

// 本文から「■ 見出し」〜 次の「■」直前までを取り出す（一覧カードで要点だけ見せる用）。
export function extractNoteSection(note: string, heading: string): string {
  const lines = note.split('\n');
  const re = new RegExp(`^■\\s*${heading}`);
  const start = lines.findIndex((l) => re.test(l.trim()));
  if (start < 0) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^■/.test(lines[i].trim())) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}
