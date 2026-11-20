// 重要タスク評価のダウンロード（/task-eval）。小中等部の職員が、毎週の評価シート（Excel）とA4版（PDF）を保存する。
// ファイルはドライブ「15_AI利用データ」→「中等部重要タスクAI評価」にあり、毎週日曜に作って置く（作り方は Claude 用の作成手順）。
// 一覧は Apps Script の listDriveFolder、PDF は readDriveFile、評価シートは Excel に書き出して渡す（lib/taskEvalStore.ts）。
//
// ★テストからも読めるよう、ここには import を置かない（型と計算だけ）。

// この画面を使う部門。左メニューにもこの部門の人にだけ出す。
export const TASK_EVAL_DEPT = '小中等部';

// 評価シートと A4版を置くフォルダ（ドライブ「15_AI利用データ」→「中等部重要タスクAI評価」）。
export const TASK_EVAL_FOLDER_ID = '1qBTDd6f05-y52X4OIcus6plHrkR7aQON';

// ファイル名の決まり：YYYYMMDD_中等部重要タスクAI評価_評価シート_MMDD-MMDD（スプレッドシート）
//                     YYYYMMDD_中等部重要タスクAI評価_A4版_MMDD-MMDD.pdf
// YYYYMMDD は作った日、MMDD-MMDD は評価した週（月〜土）。
const NAME_RE = /^(\d{4})(\d{2})(\d{2})_中等部重要タスクAI評価_(評価シート|A4版)_(\d{2})(\d{2})-(\d{2})(\d{2})(\.pdf)?$/;

export type DriveItem = { id: string; name: string; kind?: string; updated?: string; folder?: boolean };
export type EvalFile = { id: string; name: string };
export type EvalWeek = {
  week: string;      // "1109-1114"
  label: string;     // "11/9〜11/14"
  created: string;   // "2026-11-16"（作った日）
  sheet?: EvalFile;  // 評価シート（Googleスプレッドシート）
  pdf?: EvalFile;    // A4版（PDF）
};

/** フォルダの一覧から、週ごとに評価シートと A4版をまとめる（新しい週から）。名前の決まりに合わないファイルは出さない。 */
export function parseEvalFiles(items: DriveItem[]): EvalWeek[] {
  const byWeek = new Map<string, EvalWeek>();
  for (const it of items) {
    if (!it || it.folder || typeof it.id !== 'string' || typeof it.name !== 'string') continue;
    const m = NAME_RE.exec(it.name.trim());
    if (!m) continue;
    const [, y, mo, d, kind, m1, d1, m2, d2, ext] = m;
    const isPdf = kind === 'A4版';
    if (isPdf !== Boolean(ext)) continue; // 評価シートは拡張子なし、A4版は .pdf
    if (isPdf && it.kind && it.kind !== 'PDF') continue;
    if (!isPdf && it.kind && it.kind !== 'Googleスプレッドシート') continue;
    const week = `${m1}${d1}-${m2}${d2}`;
    const created = `${y}-${mo}-${d}`;
    const cur = byWeek.get(week) ?? {
      week, created, label: `${Number(m1)}/${Number(d1)}〜${Number(m2)}/${Number(d2)}`,
    };
    // 同じ週・同じ種類のファイルが2つあるときは、作った日（名前の頭の日付）が新しいほうを使う
    const slot = isPdf ? 'pdf' : 'sheet';
    const prev = cur[slot];
    if (!prev || `${y}${mo}${d}` >= prev.name.slice(0, 8)) cur[slot] = { id: it.id, name: it.name.trim() };
    if (created > cur.created) cur.created = created;
    byWeek.set(week, cur);
  }
  return [...byWeek.values()].sort((a, b) => (a.created === b.created ? b.week.localeCompare(a.week) : b.created.localeCompare(a.created)));
}

export type DownloadFormat = 'xlsx' | 'pdf';

/** ダウンロードしてよいファイルか（一覧にあるものだけ）。評価シートは xlsx、A4版は pdf だけ。 */
export function findEvalFile(weeks: EvalWeek[], id: string, format: string): { file: EvalFile; format: DownloadFormat; filename: string } | null {
  if (!/^[\w-]{10,}$/.test(id)) return null;
  for (const w of weeks) {
    if (format === 'xlsx' && w.sheet?.id === id) return { file: w.sheet, format, filename: `${w.sheet.name}.xlsx` };
    if (format === 'pdf' && w.pdf?.id === id) return { file: w.pdf, format, filename: w.pdf.name };
  }
  return null;
}

/** Content-Disposition（日本語のファイル名も崩れないように filename* を付ける）。 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** 評価シートを Google スプレッドシートで開くリンク。 */
export function sheetOpenUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}
