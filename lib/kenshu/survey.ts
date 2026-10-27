// 全体研修会アンケート（/kenshu）の設定と、画面・API の両方で使う処理。
// サーバ専用の import を持たない（npm test でそのまま読めるようにするため）。
//
// ★次の研修会で使い回すときは SURVEY の id・日付・期間と QUESTIONS の文を直す。
//   id を変えると別の回答として保存される（前回の回答は「研修会」列が古い id のままシートに残る）。

export const SURVEY = {
  id: '2026-10-31',
  event: '10/31（土）智翔館グループ 全体研修会',
  eventShort: '10/31（土）の研修会',
  period: '2026年11月〜2027年10月',
  periodShort: '2026.11 → 2027.10',
};

export type QuestionKey = 'work' | 'life';

export type Question = {
  key: QuestionKey;
  tag: string;
  title: string;
  sub: string;
  placeholders: string[];
  hints: string[];
};

export const QUESTIONS: Question[] = [
  {
    key: 'work',
    tag: '仕事',
    title: 'この1年で、仕事で達成したいこと、やってみたいことを、なんでも書いてください。いくつでもOKです。',
    sub: '大きな目標から小さな「やってみたい」まで、思いついた順で大丈夫です。',
    placeholders: ['例：日野校の新年度スタートを80名にする', '例：後輩を1人、一人で任せられるまで育てる', '例：生成AIを使って毎週の作業を半分にする'],
    hints: [
      '生徒・保護者にどんな声をかけてもらいたい？', '数字で更新したい記録は？', '仲間や後輩と一緒にやりたいことは？',
      '新しく始めてみたい企画は？', '身につけたいスキル・資格は？', '変えたい仕事のやり方は？', 'ほかの部門・校舎と組んでやりたいことは？',
    ],
  },
  {
    key: 'life',
    tag: '人生・プライベート',
    title: 'この1年で、人生・プライベートで達成したいこと、やってみたいことを、なんでも書いてみてください。いくつでもOKです。',
    sub: '達成したいこと・やってみたいことを、たくさん出してみてください。',
    placeholders: ['例：家族で北海道に旅行する', '例：フルマラソンを完走する', '例：毎朝30分、本を読む'],
    hints: [
      '行ってみたい場所は？', '家族や大切な人としたいことは？', '体や健康で目指したいことは？', '始めてみたい趣味は？',
      '学びたいこと・取りたい資格は？', '暮らしやお金で整えたいことは？', '一度はやってみたい体験は？',
    ],
  },
];

// 1つの質問に書ける数と、1行の長さの上限（スプレッドシートの1セルに収めるため）。
export const MAX_ITEMS = 100;
export const MAX_ITEM_LENGTH = 300;

/** 送られてきた行を整える：文字列だけ・改行は空白に・前後の空白を除く・空行を捨てる・上限で切る。 */
export function cleanItems(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x : x == null ? '' : String(x)))
    .map((x) => x.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_ITEM_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

// 行頭の「・」「- 」「1.」「(1)」「①」などの印。数字は3桁までで、すぐ後に数字が続くもの（3.5kg など）は外さない。
const BULLET = /^\s*(?:[・•●○◯◆■□✓✔☐☑]\s*|[-*＊]\s+|\d{1,3}[.)．、）](?!\d)\s*|[(（]\d{1,3}[)）]\s*|[①-⑳]\s*)/;

/** 貼り付けた文を1行1つに分ける。箇条書きの印は外す。 */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(BULLET, '').trim())
    .filter(Boolean);
}

/** 書いた数に合わせた一言。 */
export function cheer(n: number): string {
  if (n <= 0) return 'まずは1つ。小さなことでも大丈夫です。';
  if (n < 5) return 'いいですね。思いつくまま続けてみましょう。';
  if (n < 10) return `${n}個！ その調子です。`;
  if (n < 20) return `${n}個！ 10個をこえました。まだまだ出せそうです。`;
  return `${n}個！ 20個をこえました。すばらしい。`;
}
