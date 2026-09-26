// 智翔館の基礎情報・理念・社長方針・用語定義。全AI機能の共通前提。
//
// ★本文は knowledge/10_理念・方針/COMPANY.md にある。会社の事実や方針を直すときはそちらを直す。
//   ここを通すすべてのアプリのAIの前提が一括で変わる（回答のブレ・方針ズレの一元修正ポイント）。
//   Markdown はビルド時にコードへ文字列として埋め込む（next.config.mjs の webpack 設定）。
//   実行時にファイルを読まないので、どの API から呼んでも本番で読めなくなることがない。
//
// 日付と期は実行時に算出する（Asia/Tokyo 基準）。
// 定数で持つとビルド時の日付で固定され、翌日以降ずれるため。

import companyMd from '@/knowledge/10_理念・方針/COMPANY.md';

// front matter（先頭の --- で囲まれた管理用の項目）はAIに渡さない。
function stripFrontMatter(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---\n', 3);
  return end === -1 ? text : text.slice(end + 5);
}

const COMPANY_BODY = stripFrontMatter(companyMd);

/** COMPANY.md の本文（会社概要〜用語の定義）。末尾の空白・改行は落とす（呼び出し側で改行を1つ足す）。 */
function companyBody(): string {
  return COMPANY_BODY.replace(/\s+$/, '');
}

// 期は5月始まり・4月締め。第36期＝2026年5月〜2027年4月を基準に前後を計算する。
const FISCAL_ANCHOR_PERIOD = 36;
const FISCAL_ANCHOR_START_YEAR = 2026;

type JstDate = { y: number; m: number; d: number; w: string };

// サーバのタイムゾーン（Vercel は UTC）に関わらず日本時間の日付を得る。
export function jstDate(now: Date): JstDate {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    w: get('weekday'),
  };
}

/** 現在の期と、その期の開始年（5月始まり）。 */
export function fiscalPeriod(now: Date = new Date()): { period: number; startYear: number } {
  const { y, m } = jstDate(now);
  const startYear = m >= 5 ? y : y - 1;
  return { period: FISCAL_ANCHOR_PERIOD + (startYear - FISCAL_ANCHOR_START_YEAR), startYear };
}

/** 「2026年9月10日（木）」形式。議事録・報告の日付基準に使う。 */
export function todayText(now: Date = new Date()): string {
  const { y, m, d, w } = jstDate(now);
  return `${y}年${m}月${d}日（${w}）`;
}

export function companyKnowledge(now: Date = new Date()): string {
  const { period, startYear } = fiscalPeriod(now);

  return `
（本日の日付・年度）
本日は${todayText(now)}。年度は5月始まり・4月締めで、現在は第${period}期（${startYear}年5月〜${startYear + 1}年4月）。
議事録・報告の日付は必ずこの日付を基準に書き、過去の年（${startYear - 2}年・${startYear - 1}年）と取り違えないこと。

${companyBody()}
`;
}

/**
 * 各AI機能のシステムプロンプト先頭に共通前提として差し込む。
 * 会議AI・夏の結果報告・中間報告・議事録すべてがこれを通す。
 */
export function withCompanyKnowledge(instructions: string, now: Date = new Date()): string {
  return `【智翔館の前提知識（全AI機能で共通）】
${companyKnowledge(now).trim()}

ここまでが前提知識。以下があなたの役割と進め方。

${instructions}`;
}
