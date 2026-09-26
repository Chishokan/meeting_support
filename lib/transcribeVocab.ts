// 文字起こしに渡す「固有名詞・社内用語のヒント」を組み立てる（会議DX フェーズ2）
// -------------------------------------------------------------------------
// 音声認識は、辞書に無い社内の言い回しをそのままでは書き取れない
//（例：「サイトク」→「最特」「才徳」などに化ける）。
// そこで、社内で既に育てているナレッジから用語を集めてヒントとして渡す。
//
// 【用語の追加はコードではなくナレッジ側で】
//   1. knowledge/00_index/GLOSSARY.md の表に1行足す ← 普段はこちら
//   2. knowledge/10_理念・方針/COMPANY.md の「（用語の定義）」に足す（AIの理解そのものを変えたいとき）
//   どちらに足しても、次のデプロイから文字起こしに効く。
//
// ※ GLOSSARY.md はコードから辿れないため、next.config.mjs の
//   outputFileTracingIncludes に /api/dept-minutes/transcribe を入れてある。
//   ここを外すと本番だけ用語が効かなくなるので注意。

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { STAFF } from '@/lib/core/staff';
import { companyKnowledge } from '@/lib/core/companyKnowledge';

export const GLOSSARY_FILE = path.join('knowledge', '00_index', 'GLOSSARY.md');

// ヒントは90秒ごとに毎回送るので、長くしすぎない（1会議で40回前後送る）。
const MAX_TERMS = 90;
const MAX_GLOSS = 14; // 用語に添える説明の最大文字数
// 1文字の語（「竹」「松」等）は普通の日本語と区別できずヒントにならないので捨てる。
const MIN_TERM = 2;

// 説明として無意味なもの。用語だけ残して説明は落とす。
const EMPTY_GLOSS = /^[（(]?※?\s*要記入\s*[）)]?$/;

export type Term = { term: string; gloss: string };

// 用語に添える短い説明を作る。読み分けの助けになればよいので、長い説明は切り詰める。
function trimGloss(s: string): string {
  const g = s
    .replace(/〔[^〕]*〕/g, '') // 〔要確認〕などの注記を落とす
    .replace(/[（(][^）)]*[）)]/g, '') // 補足の括弧は中身ごと落として短くする
    .replace(/[（(）)]/g, '') // 上で落としきれない片方だけの括弧を消す
    .trim();
  if (!g || EMPTY_GLOSS.test(g)) return '';
  return g.length > MAX_GLOSS ? `${g.slice(0, MAX_GLOSS)}…` : g;
}

// 「テ対外部」「竹・松／梅・小梅」のように区切りを含む見出しを個々の用語に分ける。
function splitTerms(head: string): string[] {
  return head
    .split(/[／/・,、]/)
    .map((t) => t.replace(/^[-*・\s]+/, '').replace(/[：:].*$/, '').trim())
    .filter((t) => t.length >= MIN_TERM);
}

// knowledge/00_index/GLOSSARY.md の「| 用語 | 意味 |」表から拾う。
export function parseGlossary(md: string): Term[] {
  const out: Term[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cols = line.split('|').map((c) => c.trim());
    // 先頭と末尾は空文字になる（| a | b | → ['', 'a', 'b', '']）
    const head = cols[1] ?? '';
    const gloss = cols[2] ?? '';
    if (!head || head === '用語' || /^[-:\s]+$/.test(head)) continue;
    for (const term of splitTerms(head)) out.push({ term, gloss: trimGloss(gloss) });
  }
  return out;
}

// COMPANY.md（lib/core/companyKnowledge.ts 経由）の「（用語の定義）」以降から「用語＝説明」を拾う。
// 1行に複数の定義が並ぶ書き方（「県一斉＝長崎県一斉模試／実判＝実力判定テスト」）があるので、
// ／ と 。 で区切ってから1つずつ読む。「＝」を含まない断片は説明の続きなので捨てる。
export function parseCompanyTerms(text: string): Term[] {
  const start = text.indexOf('（用語の定義）');
  if (start < 0) return [];
  const out: Term[] = [];
  for (const raw of text.slice(start).split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('-')) continue;
    for (const part of line.replace(/^-\s*/, '').split(/[／。]/)) {
      const eq = part.indexOf('＝');
      if (eq < 0) continue;
      const gloss = trimGloss(part.slice(eq + 1));
      for (const term of splitTerms(part.slice(0, eq))) out.push({ term, gloss });
    }
  }
  return out;
}

function staffNames(): string[] {
  return Array.from(new Set(STAFF.flatMap((g) => g.names)));
}

function campusNames(): string[] {
  return STAFF.map((g) => g.campus);
}

// 同じ用語が複数のナレッジに出てきたら、説明のある方を残して1つにまとめる。
function dedupe(terms: Term[]): Term[] {
  const map = new Map<string, Term>();
  for (const t of terms) {
    const prev = map.get(t.term);
    if (!prev || (!prev.gloss && t.gloss)) map.set(t.term, t);
  }
  return Array.from(map.values());
}

async function readGlossary(): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), GLOSSARY_FILE), 'utf8');
  } catch {
    // ファイルが無くてもアプリは壊さない（職員名と companyKnowledge だけでヒントを作る）。
    return '';
  }
}

// 用語は会議ごとに変わらないので、プロセス内で使い回す（90秒ごとの読み直しを避ける）。
let cached: string | null = null;

export function clearVocabCache() {
  cached = null;
}

/** 文字起こしプロンプトに差し込む固有名詞ヒント。 */
export async function buildVocabHint(): Promise<string> {
  if (cached !== null) return cached;

  const terms = dedupe([
    ...parseGlossary(await readGlossary()),
    ...parseCompanyTerms(companyKnowledge()),
  ]).slice(0, MAX_TERMS);

  const lines = [
    '【固有名詞・社内用語のヒント】次の語が出てきたら、必ずこの表記で書くこと。',
    `・部門名：${campusNames().join('、')}`,
    `・職員名：${staffNames().join('、')}`,
  ];
  if (terms.length) {
    const list = terms.map((t) => (t.gloss ? `${t.term}（${t.gloss}）` : t.term)).join('、');
    lines.push(`・社内用語：${list}`);
  }
  lines.push('※ 上の語と音が似ている箇所は、一般的な語ではなくこの表記を優先すること。');

  cached = lines.join('\n');
  return cached;
}
