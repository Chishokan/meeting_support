// 録画ファイルの中から、文字起こしに使うものを選ぶ（Zoom連携）。
// ★画面・API・テストのどこからでも読めるよう、ここには import を置かない（型と計算だけ）。

export type FileLike = { type: string; size: number; downloadUrl: string; status: string };

// 文字起こしをどこに任せるか。
//   openai … OpenAI（1ファイル 25MB まで）
//   gemini … Google の Gemini（長い録音も送れる）
//   zoom   … Zoom が作った文字起こし（予備。日本語の精度が低く、話者も分かれないことが多い）
export type TranscribeSource = 'openai' | 'gemini' | 'zoom';
export const DEFAULT_ORDER: TranscribeSource[] = ['openai', 'gemini', 'zoom'];

function ready<T extends FileLike>(files: T[], type: string): T[] {
  return files.filter((f) => f.type === type && f.downloadUrl && (!f.status || f.status === 'completed') && f.size > 0);
}

/**
 * 文字起こしに送る音声。音声だけのファイル（M4A）を使う。
 * 動画（MP4）は同じ長さでも10倍以上大きいので、M4A が無いときだけ、いちばん小さいものを使う。
 */
export function pickAudio<T extends FileLike>(files: T[]): { file: T; ext: 'm4a' | 'mp4' } | null {
  const m4a = ready(files, 'M4A').sort((a, b) => b.size - a.size)[0];
  if (m4a) return { file: m4a, ext: 'm4a' };
  const mp4 = ready(files, 'MP4').sort((a, b) => a.size - b.size)[0];
  return mp4 ? { file: mp4, ext: 'mp4' } : null;
}

/** Zoom が作った文字起こし（VTT）。 */
export function pickZoomTranscript<T extends FileLike>(files: T[]): T | null {
  return ready(files, 'TRANSCRIPT')[0] ?? null;
}

/** 録画がまだ処理中か（Zoom は会議が終わってから数分〜十数分かけて録画を作る）。 */
export function stillProcessing(files: FileLike[]): boolean {
  return files.some((f) => (f.type === 'M4A' || f.type === 'MP4') && f.status && f.status !== 'completed');
}

/**
 * 文字起こしを試す順番。環境変数 ZOOM_TRANSCRIBE_ORDER（例 'gemini,openai,zoom'）で変えられる。
 * 書かれていないものは後ろに足すので、どれかを書き忘れても予備が消えることはない。
 * only を渡すと、それだけを試す（やり直しで「Gemini で」のように選んだとき）。
 */
export function transcribeOrder(env: string | undefined, only?: string): TranscribeSource[] {
  const known = (v: string): v is TranscribeSource => v === 'openai' || v === 'gemini' || v === 'zoom';
  if (only && known(only)) return [only];
  const out: TranscribeSource[] = [];
  for (const piece of String(env ?? '').toLowerCase().split(/[,\s]+/)) {
    if (known(piece) && !out.includes(piece)) out.push(piece);
  }
  for (const d of DEFAULT_ORDER) if (!out.includes(d)) out.push(d);
  return out;
}
