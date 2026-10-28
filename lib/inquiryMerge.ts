// 問合せ管理：同じ生徒が 2 行に分かれてしまったときに 1 行にまとめる（統合）。
//
// 「残す行（keep）」に「まとめる行（drop）」を吸収させる。
//   - 残す行の値を優先し、空欄だった項目だけ、まとめる行の値で埋める
//   - 日付は早いほう（最初の問い合わせ日）
//   - 備考はつなげる。両方に値があって違う項目は、捨てずに備考に「採用しなかった値」として残す
//   - 校舎・No. は残す行のまま。まとめる行は削除（論理削除）する
// 画面（RecordForm の「重複の統合」）と API（/api/inquiry-board/merge）が同じ関数を使う。

import { RECORD_FIELDS, parseIso, type InquiryInput, type InquiryRecord } from './inquiryRecords';

/** 統合で「まとめる行」から値を写す対象。校舎・No.・ID・作成/更新情報・備考・日付は別扱い。 */
const FILL_KEYS = [
  'studentName', 'kana', 'school', 'grade', 'phone', 'source', 'referrer', 'term',
  'contacted', 'trialDate', 'trial', 'meetingDate', 'agreed', 'closeDate', 'result', 'enrollDate',
  'guardianName', 'postal', 'address', 'email', 'dm', 'intakeId',
] as const;
type FillKey = (typeof FILL_KEYS)[number];

const LABEL: Record<string, string> = Object.fromEntries(RECORD_FIELDS.map((f) => [f.key, f.header]));

export type MergePreview = {
  filled: { key: FillKey; label: string; value: string }[];   // 空欄を drop の値で埋める項目
  conflicts: { key: FillKey; label: string; keep: string; drop: string }[]; // 両方にあって違う（drop 側は備考に残す）
  date: string;            // 統合後の日付
  dateFrom: 'keep' | 'drop' | 'none';
};

function s(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function earlier(a: string, b: string): { date: string; from: 'keep' | 'drop' | 'none' } {
  const pa = parseIso(a); const pb = parseIso(b);
  if (pa && pb) return a <= b ? { date: a, from: 'keep' } : { date: b, from: 'drop' };
  if (pa || a) return { date: a, from: 'keep' };
  if (pb || b) return { date: b, from: 'drop' };
  return { date: '', from: 'none' };
}

/** 統合したら何が変わるかを、実行前に画面で見せるための一覧。 */
export function mergePreview(keep: InquiryRecord, drop: InquiryRecord): MergePreview {
  const filled: MergePreview['filled'] = [];
  const conflicts: MergePreview['conflicts'] = [];
  for (const key of FILL_KEYS) {
    const a = s(keep[key]); const b = s(drop[key]);
    if (!b) continue;
    if (!a) filled.push({ key, label: LABEL[key] ?? key, value: b });
    else if (a !== b) conflicts.push({ key, label: LABEL[key] ?? key, keep: a, drop: b });
  }
  const e = earlier(s(keep.date), s(drop.date));
  return { filled, conflicts, date: e.date, dateFrom: e.from };
}

/** 統合後の「残す行」の内容。API はこれを PUT 相当で保存し、drop を削除する。 */
export function mergeRecords(keep: InquiryRecord, drop: InquiryRecord, today: string): InquiryInput {
  const pv = mergePreview(keep, drop);
  const out: Record<string, unknown> = { ...keep };
  delete out.id; delete out.createdAt; delete out.createdBy; delete out.updatedAt; delete out.updatedBy;
  for (const f of pv.filled) out[f.key] = f.value;
  out.date = pv.date;

  const who = drop.studentName || drop.guardianName || '（氏名なし）';
  const lines: string[] = [];
  lines.push(`―― 統合（${today}）: ${drop.campus} #${drop.no}「${who}」をこの行にまとめた ――`);
  if (pv.conflicts.length) {
    lines.push('採用しなかった値: ' + pv.conflicts.map((c) => `${c.label}=${c.drop}`).join('、'));
  }
  if (s(drop.date) && pv.dateFrom !== 'drop' && s(drop.date) !== s(keep.date)) {
    lines.push(`まとめた行の日付: ${drop.date}`);
  }
  if (s(drop.note)) lines.push(drop.note.trim());
  out.note = [s(keep.note), ...lines].filter(Boolean).join('\n');
  return out as InquiryInput;
}
