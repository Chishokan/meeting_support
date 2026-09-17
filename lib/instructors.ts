// Color HRM から取り込んだ講師一覧を読む（knowledge/20_組織・人事/講師一覧.md）。
//
// 設計の要点：
// - 講師マスタの正本は Color HRM（Xサーバーの MySQL）。会議DXアプリは DB を直接見ず、
//   scripts/import-instructors.mjs が書き出した git 上の Markdown を読む
//   （要項QAと同じ「確認済みのものを git に置いて読む」方式。認証も通信も要らない）。
// - Markdown には氏名・社員コード・部門・校舎・雇用形態・カラーしか無い。
//   連絡先・給与などは取り込み時点で落としているので、ここで気にする必要はない。
// - ファイルが無くてもアプリは壊さない（一覧なしとして動く）。
// - ファイルはビルドに同梱される（next.config.mjs の outputFileTracingIncludes）。
//   ★置き場所を変えたら next.config.mjs も直すこと（変え忘れると本番だけ 0 名になる）。
//
// 使われる場所：
//   lib/companyKnowledge.ts  … 全AI機能の前提知識に「講師一覧」として載せる
//   lib/deptMinutesPrompt.ts … 部門会議議事録（講師名の表記を揃える）
//   lib/transcribeVocab.ts   … 音声の文字起こしに講師名のヒントを渡す

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const INSTRUCTORS_FILE = path.join('knowledge', '20_組織・人事', '講師一覧.md');

export type Instructor = {
  name: string;
  employeeCode: string;
  departments: string; // 「RED・ネクスタ」のように「・」区切り
  campus: string;      // 校舎（配属教室）。「・」区切りで複数のことがある
  employmentType: string;
  color: string;       // WHITE / GREEN / BLUE / YELLOW / RED
};

export type InstructorList = {
  updated: string; // front matter の updated（取り込み日）
  list: Instructor[];
};

// 見出し名 → 項目。列の並びが変わっても拾えるように名前で引く。
const HEADERS: Record<string, keyof Instructor> = {
  氏名: 'name',
  社員コード: 'employeeCode',
  部門: 'departments',
  校舎: 'campus',
  雇用形態: 'employmentType',
  カラー: 'color',
};

function frontMatterValue(md: string, key: string): string {
  if (!md.startsWith('---')) return '';
  const end = md.indexOf('\n---', 3);
  if (end === -1) return '';
  const m = new RegExp(`^${key}\\s*:\\s*(.*)$`, 'm').exec(md.slice(3, end));
  return m ? m[1].replace(/\s+#.*$/, '').trim() : '';
}

/** 講師一覧 Markdown の表を読む。表が無ければ空。 */
export function parseInstructors(md: string): InstructorList {
  const updated = frontMatterValue(md, 'updated');
  const list: Instructor[] = [];
  let cols: (keyof Instructor | null)[] | null = null;

  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      cols = null; // 表が終わった
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!cols) {
      // 見出し行かどうか（氏名の列があること）
      if (!cells.includes('氏名')) continue;
      cols = cells.map((c) => HEADERS[c] ?? null);
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // 区切り行
    const p: Instructor = { name: '', employeeCode: '', departments: '', campus: '', employmentType: '', color: '' };
    cols.forEach((k, i) => {
      if (k) p[k] = cells[i] ?? '';
    });
    if (p.name) list.push(p);
  }
  return { updated, list };
}

// 講師一覧は会議中に変わらないので、プロセス内で使い回す（Vercel の関数は再デプロイで入れ替わる）。
let cached: InstructorList | null = null;

export function clearInstructorsCache() {
  cached = null;
}

/** 取り込み済みの講師一覧。ファイルが無ければ空リスト。 */
export function loadInstructors(): InstructorList {
  if (cached) return cached;
  let md = '';
  try {
    md = readFileSync(path.join(process.cwd(), INSTRUCTORS_FILE), 'utf8');
  } catch {
    // 未取り込み・同梱漏れ。アプリは壊さない
  }
  cached = parseInstructors(md);
  return cached;
}

/** 文字起こしのヒント用。重複を除いた氏名。 */
export function instructorNames(): string[] {
  return Array.from(new Set(loadInstructors().list.map((p) => p.name)));
}

// 校舎ごとにまとめた1行ずつの表記。「氏名（部門/カラー）」。
// 複数校舎の講師は各校舎に出す（校舎の話題で「うちの講師」として引けるように）。
export function formatInstructorLines(list: Instructor[]): string[] {
  const byCampus = new Map<string, string[]>();
  for (const p of list) {
    const tag = [p.departments, p.color].filter(Boolean).join('/');
    const label = tag ? `${p.name}（${tag}）` : p.name;
    const campuses = p.campus ? p.campus.split('・').map((c) => c.trim()).filter(Boolean) : [];
    for (const c of campuses.length ? campuses : ['校舎未設定']) {
      const arr = byCampus.get(c) ?? [];
      arr.push(label);
      byCampus.set(c, arr);
    }
  }
  return Array.from(byCampus.entries()).map(([campus, names]) => `- ${campus}：${names.join('、')}`);
}

/**
 * プロンプトに差し込む「講師一覧」の節。未取り込みなら空文字（節ごと出さない）。
 * 全AI機能の前提知識（withCompanyKnowledge）に載るので、長くしない。
 */
export function instructorKnowledge(): string {
  const { updated, list } = loadInstructors();
  if (!list.length) return '';
  const when = updated ? `${updated} 時点` : '取り込み日不明';
  return [
    `（講師一覧：Color HRM より・${when}・在籍${list.length}名。非常勤講師・学生スタッフを含む）`,
    '講師の氏名は必ずこの表記で書く（職員と同じく実名でよい）。カラーは育成段階（WHITE→GREEN→BLUE→YELLOW→RED）。',
    'ここに無い人名は生徒・保護者の可能性があるので、実名で書いてよいか慎重に扱う。',
    ...formatInstructorLines(list),
  ].join('\n');
}
