// 事前共有事項の抽出（会議AIが作った事前報告の「協議」「決裁」「報告」）。
// 「報告」画面からドキュメントへ転記するときに、ここで解析してシートへ1件1行で記録し、
// ダッシュボードで全部門分をカード表示する。
// ★書式は lib/systemPrompt.ts の【最終出力】フォーマットと対になっている。
//   片方を変えたら両方直すこと。

export type ShareKind = '協議' | '決裁' | '報告';

export type ShareItem = {
  kind: ShareKind;
  title: string; // 件名
  background: string; // 経緯
  point: string; // 論点
  opinion: string; // 報告者の意見
};

// 見出しの探し方。「■【協議】…」「■【決裁】…」「■ 報告（…）」を拾う。
// 「■ 前回計画・進捗」「■ 次回会議までの予定」などに当たらないよう、報告は行頭固定で見る。
const SECTIONS: { kind: ShareKind; re: RegExp }[] = [
  { kind: '協議', re: /^■\s*【協議】/ },
  { kind: '決裁', re: /^■\s*【決裁】/ },
  { kind: '報告', re: /^■\s*報告(?![者])/ },
];

const SECTION_END = /^(■|＝＝＝|===)/;
const NUMBERED = /^\d+[.．)、]\s*(.*)$/;
const TITLE = /^件名\s*[:：]\s*(.*)$/;
// kind 以外（文字列の項目）だけを書き換える。
type TextField = Exclude<keyof ShareItem, 'kind'>;
const FIELDS: [TextField, RegExp][] = [
  ['background', /^[・\-*]?\s*経緯\s*[:：]\s*(.*)$/],
  ['point', /^[・\-*]?\s*論点\s*[:：]\s*(.*)$/],
  ['opinion', /^[・\-*]?\s*報告者の意見\s*[:：]\s*(.*)$/],
];

// 未記入のまま残ったテンプレート文（例「（事実と結果を1〜3行で）」）は空として扱う。
function clean(v: string): string {
  const t = v.trim();
  if (!t) return '';
  if (/^[（(].*[）)]$/.test(t)) return '';
  if (/^(該当なし|特になし|なし)$/.test(t)) return '';
  return t;
}

// 報告文から指定の見出し〜次の見出し直前までを取り出す。
function sectionBody(content: string, re: RegExp): string {
  const lines = content.split('\n');
  const start = lines.findIndex((l) => re.test(l.trim()));
  if (start < 0) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION_END.test(lines[i].trim())) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

function empty(kind: ShareKind): ShareItem {
  return { kind, title: '', background: '', point: '', opinion: '' };
}

// 「1. 件名：〜／・経緯：〜／・論点：〜／・報告者の意見：〜」の並びを1件ずつに分ける。
// 「報告」は件名だけの箇条書きなので、番号行がそのまま件名になる。
export function parseShareSection(section: string, kind: ShareKind): ShareItem[] {
  const out: ShareItem[] = [];
  let cur: ShareItem | null = null;
  const flush = () => {
    if (cur && cur.title) out.push(cur);
    cur = null;
  };

  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // コメント欄は決裁者が書く場所。AIも我々も中身を持たないので記録しない。
    if (/^▼/.test(line)) continue;
    if (/^(該当なし|特になし|なし)$/.test(line)) continue;

    const num = line.match(NUMBERED);
    if (num) {
      flush();
      const rest = num[1].trim();
      const t = rest.match(TITLE);
      cur = empty(kind);
      cur.title = clean(t ? t[1] : rest);
      continue;
    }
    if (!cur) cur = empty(kind);

    const bullet = line.replace(/^[・\-*•]\s*/, '');
    const t = bullet.match(TITLE);
    if (t) {
      cur.title = clean(t[1]);
      continue;
    }
    for (const [key, re] of FIELDS) {
      const m = bullet.match(re);
      if (m) {
        cur[key] = clean(m[1]);
        break;
      }
    }
  }
  flush();
  return out;
}

/** 事前報告の本文から、協議・決裁・報告をまとめて取り出す。 */
export function extractShareItems(content: string): ShareItem[] {
  const out: ShareItem[] = [];
  for (const s of SECTIONS) {
    const body = sectionBody(content, s.re);
    if (body) out.push(...parseShareSection(body, s.kind));
  }
  return out;
}
