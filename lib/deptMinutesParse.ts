// 議事録テキストから「議事録本体」「会議の質チェック」「決定事項（1件ずつ）」を取り出す。
// 保存時にここで分解し、決定事項をスプレッドシートへ1件1行で記録する
//（部門間の決め事の見える化のもと）。
// ★書式は lib/deptMinutesPrompt.ts / lib/deptMinutesTemplate.ts の出力フォーマットと対になっている。
//   片方を変えたら両方直すこと。

import { DECISION_HEADING, DECISION_FIELDS } from '@/lib/deptMinutesTemplate';
import {
  MINUTES_OPEN,
  MINUTES_CLOSE,
  QUALITY_OPEN,
  QUALITY_CLOSE,
} from '@/lib/deptMinutesMarkers';

export type Decision = {
  title: string;
  detail: string;
  reason: string;
  owner: string;
  due: string;
  related: string;
};

const HEADING = /^■/;
const NUMBERED = /^\d+[.．)、]\s*(.*)$/;
const TITLE = /^(?:件名)\s*[:：]\s*(.*)$/;

// 「（〜）」だけの未記入テンプレート文や「該当なし」は空として扱う。
function clean(v: string): string {
  const t = v.trim();
  if (!t) return '';
  if (/^[（(].*[）)]$/.test(t)) return '';
  if (/^(該当なし|特になし|なし|未定|空欄)$/.test(t)) return '';
  return t;
}

// 開始／終了マーカーの間を取り出す。マーカーが無ければ空文字。
function between(text: string, open: string, close: string): string {
  const s = text.indexOf(open);
  if (s < 0) return '';
  const from = s + open.length;
  const e = text.indexOf(close, from);
  return text.slice(from, e < 0 ? undefined : e).trim();
}

// 議事録本体。マーカーが無い場合（利用者がマーカーごと消して編集した等）は
// 会議の質チェック以降を落とした全文を本体とみなす。
export function extractMinutes(text: string): string {
  const body = between(text, MINUTES_OPEN, MINUTES_CLOSE);
  if (body) return body;
  const q = text.indexOf(QUALITY_OPEN);
  return (q < 0 ? text : text.slice(0, q)).trim();
}

export function extractQuality(text: string): string {
  return between(text, QUALITY_OPEN, QUALITY_CLOSE);
}

// 議事録本体から「■ 見出し」〜 次の「■」直前までを取り出す。
// 一覧カードで議題だけを見せる用途にも使う（extractSection(minutes, '議題')）。
export function extractSection(minutes: string, heading: string): string {
  const lines = minutes.split('\n');
  const re = new RegExp(`^■\\s*${heading}`);
  const start = lines.findIndex((l) => re.test(l.trim()));
  if (start < 0) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADING.test(lines[i].trim())) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

// 議事録本体から「■ 決定事項」のブロックを取り出す。
export function extractDecisionSection(minutes: string): string {
  return extractSection(minutes, DECISION_HEADING);
}

// カードに1〜2行で出すための要約。箇条書きの記号・番号を落として先頭 max 行を返す。
// 未記入のテンプレート文や「該当なし」はカードに出しても意味がないので落とす。
export function summarizeSection(section: string, max = 3): string[] {
  return section
    .split('\n')
    .map((l) => l.trim().replace(/^[-*・•]\s*/, '').replace(/^\d+[.．)、]\s*/, ''))
    .filter((l) => l && !/^[（(].*[）)]$/.test(l) && !/^(該当なし|特になし|なし|未定)$/.test(l))
    .slice(0, max);
}

function emptyDecision(): Decision {
  return { title: '', detail: '', reason: '', owner: '', due: '', related: '' };
}

// 「1. 件名：〜／・内容：〜／・担当：〜」の並びを1件ずつに分解する。
export function parseDecisions(section: string): Decision[] {
  const out: Decision[] = [];
  let cur: Decision | null = null;
  const flush = () => {
    if (cur && (cur.title || cur.detail)) out.push(cur);
    cur = null;
  };

  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (!line || /^(該当なし|特になし|なし)$/.test(line)) continue;

    const num = line.match(NUMBERED);
    if (num) {
      flush();
      const rest = num[1].trim();
      const t = rest.match(TITLE);
      cur = emptyDecision();
      cur.title = clean(t ? t[1] : rest);
      continue;
    }
    if (!cur) cur = emptyDecision();

    const bullet = line.replace(/^[・\-*•]\s*/, '');
    const t = bullet.match(TITLE);
    if (t) {
      cur.title = clean(t[1]);
      continue;
    }
    for (const f of DECISION_FIELDS) {
      const m = bullet.match(new RegExp(`^${f.label}\\s*[:：]\\s*(.*)$`));
      if (m) {
        cur[f.key] = clean(m[1]);
        break;
      }
    }
  }
  flush();
  return out;
}

// 議事録全文（マーカー付き）から決定事項を取り出すショートカット。
export function extractDecisions(text: string): Decision[] {
  const section = extractDecisionSection(extractMinutes(text));
  return section ? parseDecisions(section) : [];
}
