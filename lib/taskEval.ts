// 重要タスク評価のダウンロード（/task-eval）。小中等部の職員が、毎週の評価の A4版（PDF）を保存する。
// ファイルはドライブ「15_AI利用データ」→「中等部重要タスクAI評価」にあり、毎週日曜に作って置く（作り方は Claude 用の作成手順）。
// 一覧は Apps Script の listDriveFolder、PDF は readDriveFile で読む（lib/taskEvalStore.ts）。
// 評価シート（スプレッドシート）は職員には渡さない（PDF だけ）。
//
// ★テストからも読めるよう、ここには import を置かない（型と計算だけ）。

// この画面を使う部門。左メニューにもこの部門の人にだけ出す。
export const TASK_EVAL_DEPT = '小中等部';

// 評価シートと A4版を置くフォルダ（ドライブ「15_AI利用データ」→「中等部重要タスクAI評価」）。
export const TASK_EVAL_FOLDER_ID = '1qBTDd6f05-y52X4OIcus6plHrkR7aQON';

// A4版の名前の決まり：YYYYMMDD_中等部重要タスクAI評価_A4版_MMDD-MMDD.pdf
// YYYYMMDD は作った日、MMDD-MMDD は評価した週（月〜土）。
const NAME_RE = /^(\d{4})(\d{2})(\d{2})_中等部重要タスクAI評価_A4版_(\d{2})(\d{2})-(\d{2})(\d{2})\.pdf$/;

export type DriveItem = { id: string; name: string; kind?: string; updated?: string; folder?: boolean };
export type EvalFile = { id: string; name: string };
export type EvalWeek = {
  week: string;    // "1109-1114"
  label: string;   // "11/9〜11/14"
  created: string; // "2026-11-16"（作った日）
  pdf: EvalFile;   // A4版（PDF）
};

/** フォルダの一覧から、週ごとの A4版（PDF）を取り出す（新しい週から）。名前の決まりに合わないファイルは出さない。 */
export function parseEvalFiles(items: DriveItem[]): EvalWeek[] {
  const byWeek = new Map<string, EvalWeek>();
  for (const it of items) {
    if (!it || it.folder || typeof it.id !== 'string' || typeof it.name !== 'string') continue;
    if (it.kind && it.kind !== 'PDF') continue;
    const name = it.name.trim();
    const m = NAME_RE.exec(name);
    if (!m) continue;
    const [, y, mo, d, m1, d1, m2, d2] = m;
    const week = `${m1}${d1}-${m2}${d2}`;
    const created = `${y}-${mo}-${d}`;
    const prev = byWeek.get(week);
    // 同じ週の A4版が2つあるときは、作った日（名前の頭の日付）が新しいほうを使う
    if (prev && prev.created > created) continue;
    byWeek.set(week, {
      week, created, label: `${Number(m1)}/${Number(d1)}〜${Number(m2)}/${Number(d2)}`, pdf: { id: it.id, name },
    });
  }
  return [...byWeek.values()].sort((a, b) => (a.created === b.created ? b.week.localeCompare(a.week) : b.created.localeCompare(a.created)));
}

/** ダウンロードしてよいファイルか（一覧にある A4版だけ）。 */
export function findEvalFile(weeks: EvalWeek[], id: string): EvalFile | null {
  if (!/^[\w-]{10,}$/.test(id)) return null;
  return weeks.find((w) => w.pdf.id === id)?.pdf ?? null;
}

/** Content-Disposition（日本語のファイル名も崩れないように filename* を付ける）。 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
