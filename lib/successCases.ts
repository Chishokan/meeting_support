// 成功事例の抽出（夏期結果報告の「■ 成功事例（全体共有）」ブロック）。
// 「報告」から貼り付けられた報告文をここで解析し、全社集約用のシートへ1件ずつ記録する。
// ★書式は lib/summerPrompt.ts の出力フォーマットと対になっている。片方を変えたら両方直すこと。

export type SuccessCase = {
  title: string; // 件名
  action: string; // 取り組み
  result: string; // 結果
  point: string; // 他でも使えるポイント
};

const SECTION_START = /^■\s*成功事例/;
const SECTION_END = /^(■|＝＝＝|===)/;
const NUMBERED = /^\d+[.．)、]\s*(.*)$/;
const TITLE = /^件名\s*[:：]\s*(.*)$/;
const FIELDS: [keyof SuccessCase, RegExp][] = [
  ['action', /^[・\-*]?\s*取り組み\s*[:：]\s*(.*)$/],
  ['result', /^[・\-*]?\s*結果\s*[:：]\s*(.*)$/],
  ['point', /^[・\-*]?\s*(?:他でも使えるポイント|ポイント)\s*[:：]\s*(.*)$/],
];

// 未記入のまま残ったテンプレート文（例「（コツ・工夫。無ければ空欄）」）は空として扱う。
function clean(v: string): string {
  const t = v.trim();
  return /^[（(].*[）)]$/.test(t) ? '' : t;
}

// 報告文から「■ 成功事例…」〜 次の見出し（■ / ＝＝＝）直前までを取り出す。
export function extractSuccessSection(content: string): string {
  const lines = content.split('\n');
  const start = lines.findIndex((l) => SECTION_START.test(l.trim()));
  if (start < 0) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION_END.test(lines[i].trim())) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

// 成功事例ブロックを1件ずつに分解する。「該当なし」や空欄だけの項目は返さない。
export function parseSuccessCases(section: string): SuccessCase[] {
  const cases: SuccessCase[] = [];
  let cur: SuccessCase | null = null;
  const flush = () => {
    if (cur && (cur.title || cur.action || cur.result)) cases.push(cur);
    cur = null;
  };

  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (!line || /^該当なし/.test(line) || /^(特になし|なし)$/.test(line)) continue;

    const num = line.match(NUMBERED);
    if (num) {
      flush();
      const rest = num[1].trim();
      const t = rest.match(TITLE);
      cur = { title: clean(t ? t[1] : rest), action: '', result: '', point: '' };
      continue;
    }
    if (!cur) cur = { title: '', action: '', result: '', point: '' };

    const t = line.replace(/^[・\-*]\s*/, '').match(TITLE);
    if (t) {
      cur.title = clean(t[1]);
      continue;
    }
    for (const [key, re] of FIELDS) {
      const m = line.match(re);
      if (m) {
        cur[key] = clean(m[1]);
        break;
      }
    }
  }
  flush();
  return cases.filter((c) => c.title || c.action || c.result);
}

// 報告文から成功事例を取り出す（抽出＋分解のショートカット）。
export function extractSuccessCases(content: string): SuccessCase[] {
  const section = extractSuccessSection(content);
  return section ? parseSuccessCases(section) : [];
}
