// knowledge/ 配下の Markdown を読む（要項QA用）。
//
// 設計の要点：
// - 要項ドキュメント（Google ドキュメント）は編集中の案が混ざるため、直接は読まない。
//   担当者が確認して status を「確定」にしたものだけを、この git 上のファイルから読む。
// - 受講料・申込期限は案ごとに違う。未確定のものを混ぜるとAIの回答が矛盾するため、
//   下書きは決してAIに渡さない。
// - ファイルはビルドに同梱される（next.config.mjs の outputFileTracingIncludes）。
//   認証も通信も要らないので速い。

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const YOKO_DIR = path.join('knowledge', '40_要項');

/** 確定済みとみなす status の値。これ以外はAIに渡さない。 */
const CONFIRMED = '確定';

export type KnowledgeDoc = {
  file: string;      // knowledge/ からの相対パス（出典表示に使う）
  title: string;
  status: string;    // 確定 / 下書き
  owner: string;
  updated: string;
  source: string;
  body: string;      // front matter を除いた本文
};

// --- front matter ---------------------------------------------------------

// 「key: value   # コメント」形式の素朴な front matter。
// YAML ライブラリを足すほどの複雑さは無いので自前で読む。
function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith('---')) return { meta: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: raw };

  const head = raw.slice(3, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  const meta: Record<string, string> = {};

  for (const line of head.split('\n')) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    // 値の後ろの「 # 説明」を落とす（先頭が # の値は色コード等ではないので考慮しない）
    meta[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return { meta, body };
}

// --- 読み込み -------------------------------------------------------------

async function listMarkdown(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // ディレクトリが無い場合は空扱い（アプリは壊さない）
  }
  const out: string[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    // _ で始まるファイルはテンプレート・メモ類。要項ではないので読まない。
    if (e.name.startsWith('_')) continue;
    if (e.isDirectory()) out.push(...(await listMarkdown(p)));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out.sort();
}

/** 要項をすべて読む（下書きも含む。件数表示に使う）。 */
export async function loadYokoDocs(): Promise<KnowledgeDoc[]> {
  const root = path.join(process.cwd(), YOKO_DIR);
  const files = await listMarkdown(root);

  const docs: KnowledgeDoc[] = [];
  for (const f of files) {
    let raw: string;
    try {
      raw = await fs.readFile(f, 'utf8');
    } catch {
      continue;
    }
    const { meta, body } = parseFrontMatter(raw);
    const rel = path.relative(process.cwd(), f).split(path.sep).join('/');
    docs.push({
      file: rel,
      title: meta.title || path.basename(f, '.md'),
      status: meta.status || '下書き',
      owner: meta.owner || '',
      updated: meta.updated || '',
      source: meta.source || '',
      body: body.trim(),
    });
  }
  return docs;
}

export function confirmedDocs(docs: KnowledgeDoc[]): KnowledgeDoc[] {
  return docs.filter((d) => d.status === CONFIRMED);
}

/** 確定済みの要項をプロンプトに載せる形へ。出典を引けるようファイル名を添える。 */
export function formatDocs(docs: KnowledgeDoc[]): string {
  if (!docs.length) return '（確定済みの要項がまだありません）';
  return docs
    .map((d) => {
      const head = [
        `===== ${d.title} =====`,
        `出典ファイル: ${d.file}`,
        d.updated ? `更新日: ${d.updated}` : '',
        d.owner ? `確定者: ${d.owner}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return `${head}\n\n${d.body}`;
    })
    .join('\n\n');
}

/** 一覧（AIが「何が確定していて何が無いか」を答えられるように渡す）。 */
export function formatIndex(docs: KnowledgeDoc[]): string {
  if (!docs.length) return '（要項ファイルがありません）';
  return docs
    .map((d) => `- ${d.title}（${d.status}${d.updated ? ` / ${d.updated}` : ''}）`)
    .join('\n');
}
