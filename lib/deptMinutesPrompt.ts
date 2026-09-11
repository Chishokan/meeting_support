// 部門会議 議事録の生成プロンプト（会議DX フェーズ2）
// 会議の録音を文字起こししたテキストを受け取り、lib/deptMinutesTemplate.ts のテンプレートに沿った
// 議事録ドラフトと、テンプレートに沿わなかった点（会議の質チェック）を出力させる。
// ★挙動を直す場合はこのファイルと lib/deptMinutesTemplate.ts を編集 → git push（Vercel が自動再デプロイ）。

import {
  DECISION_FIELDS,
  DEPT_NOTES,
  QUALITY_CHECKS,
  buildTemplateSkeleton,
} from '@/lib/deptMinutesTemplate';

// 出力ブロックの区切り。lib/deptMinutesParse.ts の抽出と対になっているので、
// 変更するときは両方を直すこと。
export const MINUTES_OPEN = '＝＝＝ 議事録（ここから）＝＝＝';
export const MINUTES_CLOSE = '＝＝＝ 議事録（ここまで）＝＝＝';
export const QUALITY_OPEN = '＝＝＝ 会議の質チェック（ここから）＝＝＝';
export const QUALITY_CLOSE = '＝＝＝ 会議の質チェック（ここまで）＝＝＝';

export type MeetingMeta = {
  title: string; // 会議名
  date: string; // 開催日時
  place: string; // 場所
  attendees: string; // 出席者
  agenda: string; // 事前に予定していた議題（任意・改行区切り）
};

const INSTRUCTIONS = `
あなたは「株式会社智翔館 {{事業部}} 部門会議 議事録アシスタント」です。担当は「{{事業部}} / {{担当}}」。
利用者が部門会議を録音し、その文字起こしテキストを渡してきます。
あなたの仕事は、文字起こしから【議事録テンプレート】に沿った議事録ドラフトを作り、あわせて
「テンプレートに沿わなかった点（会議の質チェック）」を指摘することです。

【最重要の姿勢】
- 文字起こしに無い事実を創作しない。聞き取れていない・言及が無い箇所は【要確認】と書く。
- 文字起こしは誤変換を含む。文脈から明らかな誤変換（固有名詞・数字）は直してよいが、
  自信が無い箇所は原文のまま残し、末尾に「（聞き取り不明瞭）」と付ける。
- 「決定事項」と「継続審議・保留」を厳密に区別する。
  司会や参加者が「じゃあそれで」「決まりですね」等と合意した内容だけを決定事項にする。
  誰かが提案しただけ・言いっぱなしのものは決定事項に入れず、継続審議へ回す。
- 担当者・期限が会議で決まっていなければ空欄のままにする。絶対に推測で埋めない。
- 生徒・保護者を特定できる個人情報（氏名・成績詳細・家庭事情・健康状態等）は議事録に残さない。
  生徒・保護者の氏名はイニシャルに変換する（例：田中太郎→T.T.）。職員は実名でよい。
  機微な内容が話されていた場合は、会議の質チェックの末尾に「※個人情報のため要約にとどめた箇所があります」と一行添える。

【出力の形】必ず次の2ブロックを、この順にこのまま出力する。前置き・あいさつ・解説は書かない。

{{MINUTES_OPEN}}
{{TEMPLATE}}
{{MINUTES_CLOSE}}

{{QUALITY_OPEN}}
■ 予定議題の消化
（予定議題が渡されている場合のみ。話し合えた議題／話し合えなかった議題を挙げる。予定議題の入力が無ければ「予定議題の入力なし」と書く）

■ テンプレートに沿わなかった点
（下記の観点で、気づいた点だけを箇条書きにする。問題が無い観点は書かなくてよい）
{{CHECKS}}

■ 次の会議への提案
（1〜3件。具体的で、すぐ実行できるものだけ。無ければ「特になし」）
{{QUALITY_CLOSE}}

【議事録の書き方の細則】
- 「■ 決定事項」は1件ずつ番号を振り、各件に「件名」と次の項目をこの順で必ず並べる：{{DECISION_LABELS}}。
  空欄でよい項目も、行そのものは消さずに「・担当：」のように項目名だけ残す（後で集計するため）。
- 該当が1件も無いセクションは、見出しを残したうえで本文に「該当なし」と書く。見出しごと消さない。
- 文体はです・ます調でなくてよい（記録なので体言止め・簡潔な文で可）。
- 数字（日付・人数・金額）は発言のとおり正確に転記する。
{{DEPT_NOTE}}
【修正依頼を受けたとき】
利用者から修正の指示が来たら、指示を反映したうえで、上の2ブロック全体を最初から出し直す。
差分だけを返さない。
`;

export function buildDeptMinutesPrompt(dept: string, name: string): string {
  const deptNote = DEPT_NOTES[dept] ? `- ${DEPT_NOTES[dept]}\n` : '';
  return INSTRUCTIONS
    .replace('{{TEMPLATE}}', buildTemplateSkeleton())
    .replace('{{CHECKS}}', QUALITY_CHECKS.map((c) => `- ${c}`).join('\n'))
    .replace('{{DECISION_LABELS}}', DECISION_FIELDS.map((f) => f.label).join('・'))
    .replace('{{DEPT_NOTE}}', deptNote)
    .replace('{{MINUTES_OPEN}}', MINUTES_OPEN)
    .replace('{{MINUTES_CLOSE}}', MINUTES_CLOSE)
    .replace('{{QUALITY_OPEN}}', QUALITY_OPEN)
    .replace('{{QUALITY_CLOSE}}', QUALITY_CLOSE)
    .replace(/\{\{事業部\}\}/g, dept || '（事業部）')
    .replace(/\{\{担当\}\}/g, name || '（担当）');
}

function metaBlock(meta: MeetingMeta): string {
  const agenda = meta.agenda.trim()
    ? meta.agenda.trim().split('\n').map((l) => `  ・${l.trim()}`).filter((l) => l.trim() !== '・').join('\n')
    : '  （入力なし）';
  return [
    '【会議情報（利用者の入力・正）】',
    `- 会議名：${meta.title.trim() || '（未入力）'}`,
    `- 開催日時：${meta.date.trim() || '（未入力）'}`,
    `- 場所：${meta.place.trim() || '（未入力）'}`,
    `- 出席者：${meta.attendees.trim() || '（未入力）'}`,
    '- 事前に予定していた議題：',
    agenda,
  ].join('\n');
}

// 初回：文字起こしから議事録ドラフトを作らせる。
export function buildDraftRequest(meta: MeetingMeta, transcript: string): string {
  return [
    metaBlock(meta),
    '',
    '【会議の文字起こし（録音から自動生成。誤変換あり）】',
    transcript.trim(),
    '',
    '上の文字起こしから、指示どおり2ブロックを出力してください。',
  ].join('\n');
}

// 2回目以降：利用者が編集した議事録と修正指示を渡して作り直させる。
export function buildReviseRequest(
  meta: MeetingMeta,
  transcript: string,
  draft: string,
  instruction: string,
): string {
  return [
    metaBlock(meta),
    '',
    '【会議の文字起こし（録音から自動生成。誤変換あり）】',
    transcript.trim(),
    '',
    '【現在の議事録（利用者が編集済みの場合あり）】',
    draft.trim(),
    '',
    '【利用者からの修正指示】',
    instruction.trim(),
    '',
    '修正指示を反映して、2ブロック全体を最初から出し直してください。',
  ].join('\n');
}
