// 智翔館AI が knowledge/ を調べるための道具（AIに渡すツール）。
//
// AIは最初に索引（00_index/INDEX.md）を見て、必要なファイルだけを read_file で読む。
// 索引で当たりがつかないときだけ grep_knowledge で全文を探す。
//
// 読ませないもの（索引 scripts/build-index.mjs と同じ線引き）：
// - knowledge/ の外、.md 以外
// - 名前が _ で始まるファイル・フォルダ（テンプレート、旧要項、統合前の原本）
// - status があって「確定」でないもの（要項の下書き。案の料金や日付をAIに拾わせない）
//
// ファイルはビルドに同梱する（next.config.mjs の outputFileTracingIncludes）。

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const KNOWLEDGE_ROOT = 'knowledge';

const MAX_READ_CHARS = 40_000; // 1回の read_file で返す上限（長い資料で文脈を食いつぶさない）
const MAX_GREP_HITS = 30;
const MAX_LINE_CHARS = 200;

/** AIに渡すツール定義（Anthropic の tools にそのまま渡す形）。 */
export const KNOWLEDGE_TOOLS = [
  {
    name: 'read_file',
    description:
      '社内ナレッジ（knowledge/）のファイルを1つ読む。path は索引（INDEX.md）の「パス」列の書き方（例：10_理念・方針/経営指針書_2026.md）。',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'knowledge/ からの相対パス' } },
      required: ['path'],
    },
  },
  {
    name: 'grep_knowledge',
    description:
      '社内ナレッジの全文から、語句を含む行を探す。索引で見当がつかないときだけ使う。語句は短く1語にする（例：紹介、冬期、報連想）。',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: '探す語句（大文字小文字は区別しない）' } },
      required: ['query'],
    },
  },
  {
    name: 'list_dir',
    description: '社内ナレッジのフォルダの中身（フォルダと .md ファイルの名前）を一覧する。path を省くと最上位。',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'knowledge/ からの相対パス（省略可）' } },
    },
  },
];

// --- パスの安全確認 -------------------------------------------------------

/** knowledge/ からの相対パスを正規化する。外に出る・隠しファイル・_ で始まる部分があれば null。 */
export function safeRelPath(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let p = input.trim().replace(/\\/g, '/');
  if (p.startsWith('knowledge/')) p = p.slice('knowledge/'.length);
  p = p.replace(/^\.?\/+/, '').replace(/\/+$/, '');
  if (p === '' || p === '.') return '';
  const parts = p.split('/');
  if (parts.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('_') || s.startsWith('.'))) return null;
  return parts.join('/');
}

// --- front matter ---------------------------------------------------------

export function frontMatter(raw: string): Record<string, string> {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const meta: Record<string, string> = {};
  for (const line of text.slice(3, end).split('\n')) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (m) meta[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return meta;
}

/** 確定していない要項（status があって「確定」でない）なら true。 */
export function isDraft(raw: string): boolean {
  const s = frontMatter(raw).status;
  return !!s && s !== '確定';
}

// --- ツールの中身 ---------------------------------------------------------

async function readAllowed(root: string, rel: string): Promise<{ ok: true; raw: string } | { ok: false; why: string }> {
  if (!rel.endsWith('.md')) return { ok: false, why: '.md のファイルだけ読めます。' };
  let raw: string;
  try {
    raw = await fs.readFile(path.join(root, rel), 'utf8');
  } catch {
    return { ok: false, why: `${rel} は見つかりません。索引（00_index/INDEX.md）のパスを確かめてください。` };
  }
  if (isDraft(raw)) return { ok: false, why: `${rel} は確定していない要項のため読めません。内容は担当者に確認してください。` };
  return { ok: true, raw };
}

/** 1ファイルを読む。読めたときは ok と、正規化したパスを返す（読んだ資料の表示・会話の持ち越しに使う）。 */
export async function readFileDetailed(root: string, input: unknown): Promise<{ ok: boolean; path: string; text: string }> {
  const rel = safeRelPath(input);
  if (rel === null || rel === '') return { ok: false, path: '', text: 'そのパスは読めません（knowledge/ の中の、_ で始まらないファイルだけ読めます）。' };
  const r = await readAllowed(root, rel);
  if (!r.ok) return { ok: false, path: rel, text: r.why };
  if (r.raw.length <= MAX_READ_CHARS) return { ok: true, path: rel, text: r.raw };
  return {
    ok: true,
    path: rel,
    text: `${r.raw.slice(0, MAX_READ_CHARS)}\n\n（長いため ${MAX_READ_CHARS} 文字で切った。続きが必要なら grep_knowledge で語句を探す）`,
  };
}

export async function readFile(root: string, input: unknown): Promise<string> {
  return (await readFileDetailed(root, input)).text;
}

/** 読んでよい .md をすべて列挙する（knowledge/ からの相対パス、並び順は固定）。 */
export async function listAllowedFiles(root: string, rel = ''): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listAllowedFiles(root, p)));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

export async function grepKnowledge(root: string, input: unknown): Promise<string> {
  const q = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (!q) return '探す語句を指定してください。';
  const hits: string[] = [];
  let more = false;
  for (const rel of await listAllowedFiles(root)) {
    const raw = await fs.readFile(path.join(root, rel), 'utf8').catch(() => '');
    if (!raw || isDraft(raw)) continue;
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(q)) continue;
      if (hits.length >= MAX_GREP_HITS) { more = true; break; }
      const text = lines[i].trim();
      hits.push(`${rel}:${i + 1}: ${text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text}`);
    }
    if (more) break;
  }
  if (hits.length === 0) return `「${input}」を含む行は見つかりませんでした。`;
  return hits.join('\n') + (more ? `\n（${MAX_GREP_HITS}件で打ち切り。語句を絞ってください）` : '');
}

export async function listDir(root: string, input: unknown): Promise<string> {
  const rel = input === undefined || input === null ? '' : safeRelPath(input);
  if (rel === null) return 'そのフォルダは開けません。';
  let entries;
  try {
    entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return `${rel || '(最上位)'} は見つかりません。`;
  }
  const names = entries
    .filter((e) => !e.name.startsWith('_') && !e.name.startsWith('.') && (e.isDirectory() || e.name.endsWith('.md')))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  return names.length ? names.join('\n') : '（空のフォルダ）';
}

/** AIが呼んだツールを実行し、結果の文字列と、read_file で読めたときはそのパスを返す。知らないツール名でも例外にしない。 */
export async function runKnowledgeToolDetailed(
  root: string,
  name: string,
  input: Record<string, unknown>,
): Promise<{ text: string; readPath?: string }> {
  try {
    if (name === 'read_file') {
      const r = await readFileDetailed(root, input?.path);
      return r.ok ? { text: r.text, readPath: r.path } : { text: r.text };
    }
    if (name === 'grep_knowledge') return { text: await grepKnowledge(root, input?.query) };
    if (name === 'list_dir') return { text: await listDir(root, input?.path) };
    return { text: `${name} というツールはありません。` };
  } catch {
    return { text: 'ツールの実行に失敗しました。' };
  }
}

/** AIが呼んだツールを実行し、結果の文字列を返す。 */
export async function runKnowledgeTool(root: string, name: string, input: Record<string, unknown>): Promise<string> {
  return (await runKnowledgeToolDetailed(root, name, input)).text;
}
