// 面談記録の生成プロンプト（面談記録アプリ /interview-notes）
// 面談の録音を文字起こししたテキストを受け取り、lib/interviewNotes/template.ts のテンプレートに沿った
// 面談記録と、記録者に確かめてほしい点（確認事項）を出力させる。
// ★挙動を直す場合はこのファイルと lib/interviewNotes/template.ts を編集する。

import { withCompanyKnowledge } from '@/lib/core/companyKnowledge';
import { FOLLOWUP_CHECKS, buildInterviewSkeleton } from '@/lib/interviewNotes/template';

// 出力ブロックの区切り。lib/interviewNotes/parse.ts の抽出と対になっているので、
// 変更するときは両方を直すこと。
export const NOTE_OPEN = '＝＝＝ 面談記録（ここから）＝＝＝';
export const NOTE_CLOSE = '＝＝＝ 面談記録（ここまで）＝＝＝';
export const CHECK_OPEN = '＝＝＝ 確認事項（ここから）＝＝＝';
export const CHECK_CLOSE = '＝＝＝ 確認事項（ここまで）＝＝＝';

export type InterviewMeta = {
  student: string; // 生徒氏名
  grade: string; // 学年
  kind: string; // 面談の種類（生徒面談・保護者面談 など）
  date: string; // 面談日時
  place: string; // 校舎・場所
  interviewer: string; // 面談者（記録者と別のこともある）
  attendees: string; // 同席者（保護者名・他の講師など）
  purpose: string; // 面談の目的・事前メモ（任意）
};

export const EMPTY_INTERVIEW_META: InterviewMeta = {
  student: '', grade: '', kind: '', date: '', place: '', interviewer: '', attendees: '', purpose: '',
};

export function readInterviewMeta(v: unknown): InterviewMeta {
  const o = (v ?? {}) as Record<string, unknown>;
  const s = (k: keyof InterviewMeta) => String(o[k] ?? '');
  return {
    student: s('student'), grade: s('grade'), kind: s('kind'), date: s('date'),
    place: s('place'), interviewer: s('interviewer'), attendees: s('attendees'), purpose: s('purpose'),
  };
}

const INSTRUCTIONS = `
あなたは「株式会社智翔館 {{事業部}} 面談記録アシスタント」です。記録者は「{{事業部}} / {{担当}}」。
講師・教室長が生徒または保護者との面談を録音し、その文字起こしテキストを渡してきます。
あなたの仕事は、文字起こしから【面談記録テンプレート】に沿った面談記録を作り、あわせて
記録者に保存前に確かめてほしい点（確認事項）を挙げることです。
この記録は、次の面談・担当の引き継ぎ・保護者対応の振り返りに使われます。

【最重要の姿勢】
- 文字起こしに無い事実を創作しない。聞き取れていない・言及が無い箇所は【要確認】と書く。
- 文字起こしは誤変換を含む。文脈から明らかな誤変換（学校名・数字）は直してよいが、
  自信が無い箇所は原文のまま残し、末尾に「（聞き取り不明瞭）」と付ける。
- 【面談の目的・事前メモ】は面談の前に書いたものであって、面談で話した結果ではない。
  ここに書かれた予定・案を、面談で話したこと・合意したことのように書いてはならない。
- 【面談中のメモ】が渡されたときは、文字起こしより優先して扱う。
  固有名詞・数字・日付が食い違う場合はメモの表記を採る。
- 「合意したこと」と「提案しただけのこと」を厳密に区別する。
  生徒・保護者が「そうします」「お願いします」と受け入れたものだけを合意とする。
- 担当・期限が面談で決まっていなければ空欄のままにする。絶対に推測で埋めない。
- 生徒・保護者の発言は、意味を変えずに要点へまとめる。評価・決めつけ（「やる気がない」等）を書き足さない。
- 面談の対象の生徒は、入力された氏名で書いてよい（記録の目的上必要なため）。
  それ以外に話に出た生徒（友人・兄弟の同級生など）の氏名はイニシャルに変える（例：田中太郎→T.T.）。
- 健康・家庭の事情など機微な内容は、指導上必要な範囲で簡潔に書き、詳しい事情までは書き写さない。
  そうした箇所があれば確認事項の末尾に「※機微な内容のため要約にとどめた箇所があります」と一行添える。

【出力の形】必ず次の2ブロックを、この順にこのまま出力する。前置き・あいさつ・解説は書かない。

{{NOTE_OPEN}}
{{TEMPLATE}}
{{NOTE_CLOSE}}

{{CHECK_OPEN}}
（下記の観点で、気づいた点だけを箇条書きにする。該当が無い観点は書かなくてよい。1つも無ければ「特になし」）
{{CHECKS}}
{{CHECK_CLOSE}}

【面談記録の書き方の細則】
- 該当が1件も無いセクションは、見出しを残したうえで本文に「該当なし」と書く。見出しごと消さない。
- 文体はです・ます調でなくてよい（記録なので体言止め・簡潔な文で可）。
- 数字（点数・順位・偏差値・日付・金額）は発言のとおり正確に転記する。
- 面談の種類が「保護者面談」「三者面談」のときは、保護者の要望・不安を特に漏らさない。
- 面談の種類が「入塾面談」のときは、入塾の意思・体験の有無・受講を検討している講座を「合意したこと」か「（検討中）」に必ず書く。
- 面談の種類が「退塾・休塾の相談」のときは、理由として話されたことと、引き留め・代案として塾が示したことを分けて書く。

【修正依頼を受けたとき】
利用者から修正の指示が来たら、指示を反映したうえで、上の2ブロック全体を最初から出し直す。
差分だけを返さない。
`;

export function buildInterviewPrompt(dept: string, name: string): string {
  const body = INSTRUCTIONS
    .replace('{{TEMPLATE}}', buildInterviewSkeleton())
    .replace('{{CHECKS}}', FOLLOWUP_CHECKS.map((c) => `- ${c}`).join('\n'))
    .replace('{{NOTE_OPEN}}', NOTE_OPEN)
    .replace('{{NOTE_CLOSE}}', NOTE_CLOSE)
    .replace('{{CHECK_OPEN}}', CHECK_OPEN)
    .replace('{{CHECK_CLOSE}}', CHECK_CLOSE)
    .replace(/\{\{事業部\}\}/g, dept || '（事業部）')
    .replace(/\{\{担当\}\}/g, name || '（担当）');
  return withCompanyKnowledge(body);
}

function metaBlock(meta: InterviewMeta): string {
  const lines = [
    '【面談情報（利用者の入力・正）】',
    `- 生徒氏名：${meta.student.trim() || '（未入力）'}`,
    `- 学年：${meta.grade.trim() || '（未入力）'}`,
    `- 面談の種類：${meta.kind.trim() || '（未入力）'}`,
    `- 面談日時：${meta.date.trim() || '（未入力）'}`,
    `- 校舎・場所：${meta.place.trim() || '（未入力）'}`,
    `- 面談者：${meta.interviewer.trim() || '（未入力）'}`,
    `- 同席者：${meta.attendees.trim() || '（未入力）'}`,
  ];
  const purpose = meta.purpose.trim();
  if (!purpose) return [...lines, '- 面談の目的・事前メモ：（入力なし）'].join('\n');
  return [
    ...lines,
    '- 面談の目的・事前メモ（面談の前に書いたもの。下の「＝＝＝」に挟まれた部分）：',
    '＝＝＝ 目的・事前メモ（ここから）＝＝＝',
    purpose,
    '＝＝＝ 目的・事前メモ（ここまで）＝＝＝',
  ].join('\n');
}

function transcriptBlock(transcript: string): string[] {
  const t = transcript.trim();
  if (!t) return [];
  return ['', '【面談の文字起こし（録音から自動生成。誤変換あり）】', t];
}

function memoBlock(memo: string): string[] {
  const m = memo.trim();
  if (!m) return [];
  return ['', '【面談中のメモ（面談者が手で書いたもの。文字起こしより正確）】', m];
}

// 初回：文字起こし（＋メモ）から面談記録を作らせる。
export function buildInterviewDraftRequest(meta: InterviewMeta, transcript: string, memo = ''): string {
  return [
    metaBlock(meta),
    ...transcriptBlock(transcript),
    ...memoBlock(memo),
    '',
    '上の内容から、指示どおり2ブロックを出力してください。',
  ].join('\n');
}

// 2回目以降：利用者が編集した面談記録と修正指示を渡して作り直させる。
export function buildInterviewReviseRequest(
  meta: InterviewMeta,
  transcript: string,
  draft: string,
  instruction: string,
  memo = '',
): string {
  return [
    metaBlock(meta),
    ...transcriptBlock(transcript),
    ...memoBlock(memo),
    '',
    // 保存済みの面談記録を直すときは文字起こしが無い。そのときはこの本文だけが材料になる。
    '【現在の面談記録（利用者が編集済みの場合あり）】',
    draft.trim(),
    '',
    '【利用者からの修正指示】',
    instruction.trim(),
    '',
    '修正指示を反映して、2ブロック全体を最初から出し直してください。',
  ].join('\n');
}
