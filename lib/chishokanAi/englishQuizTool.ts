// 智翔館AI：英語の単語テスト（フォレスタ英語の Key Words・巻末の Key Words TEST、または基本単語の一覧・不規則動詞から出す）を Word にして、ドライブに保存する道具。サーバ専用。
// 問題は元データ（lib/english/data）から選ぶだけで、AI は問題も答えも書かない。
// 選び方は lib/english/wordQuiz.ts（前半が教材、後半が基本単語・不規則動詞）、Word は lib/english/wordQuizDoc.ts。
// 手順書は knowledge/05_作業/75_英語の単語テストを作る.md。

import type Anthropic from '@anthropic-ai/sdk';
import { BOOKS } from '../english/books';
import { BASIC_WORDS, IRREGULAR_VERBS } from '../english/data/basic';
import { buildBasicQuiz, buildWordQuiz, MAX_COUNT, PER_SHEET, type BasicData, type BasicQuizOptions, type WordQuiz, type WordQuizOptions } from '../english/wordQuiz';
import { buildWordQuizDocx } from '../english/wordQuizDoc';
import { callGas } from './gas';
import { readSaveResult, type MathRunResult } from './mathMaterial';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const BASIC: BasicData = { words: BASIC_WORDS, verbs: IRREGULAR_VERBS };

export const ENGLISH_WORD_QUIZ_TOOL: Anthropic.Tool = {
  name: 'create_english_word_quiz',
  description:
    '英語の単語テストを Word にして、ドライブに保存する。「テスト」と「答え入り」の2つのファイルができる。問題と答えは元データから選ぶので、問題・答えを渡さない（範囲と出し方だけを渡す）。' +
    '出す元（source）：words＝フォレスタ英語の Key Words の単語／kwt＝巻末の Key Words TEST（文の穴埋め）（この2つは grade・unit が要る）／' +
    'basic＝基本単語の一覧（中2までの約1,800語。categories〔曜日・月・数字・序数・不規則動詞・人・家族・食べ物 など〕・levels・pos で絞る）／' +
    'verbs＝不規則動詞の変化（原形・過去形・過去分詞を書く表。levels で絞る）。' +
    `1枚に入るのは、単語 ${PER_SHEET.words}問・Key Words TEST ${PER_SHEET.kwt}問・不規則動詞 ${PER_SHEET.verbs}問まで（多いと枚が増える）。` +
    '作業「英語の単語テストを作る」で、範囲と出し方が決まったら使う。範囲や分類の名前が違うと、作らずに選べるものの一覧を返す。',
  input_schema: {
    type: 'object',
    properties: {
      grade: { type: 'string', enum: ['中1', '中2', '中3'], description: '学年（教材の冊子）。words・kwt のときだけ' },
      unit: { type: 'string', description: "Unit の番号（例：4）。Unit 以外は名前（プレステップ、Let's Start2、Let's Read1 など）。words・kwt のときだけ" },
      sections: { type: 'array', items: { type: 'string' }, description: "範囲にする区分の名前（例：[\"Part1\", \"Part2\"]、Let's Talk1）。省くと Unit のすべて" },
      source: { type: 'string', enum: ['words', 'kwt', 'basic', 'verbs'], description: 'words：教材の Key Words の単語（既定）／kwt：巻末の Key Words TEST（文の穴埋め）／basic：基本単語の一覧／verbs：不規則動詞の変化' },
      categories: { type: 'array', items: { type: 'string' }, description: 'basic のとき：分類（例：["曜日", "月"]、数字、序数、不規則動詞、人・家族、食べ物、重要熟語）。省くとすべて' },
      levels: { type: 'array', items: { type: 'string', enum: ['小学校', '中1', '中2'] }, description: 'basic・verbs のとき：学年の目安。省くとすべて' },
      pos: { type: 'array', items: { type: 'string' }, description: 'basic のとき：品詞（名詞・動詞・形容詞・副詞・熟語・前置詞 など）。省くとすべて' },
      verb_ask: { type: 'string', enum: ['past-pp', 'past', 'all'], description: 'verbs のとき：past-pp＝原形を見て過去形・過去分詞を書く（既定）／past＝過去形だけ／all＝意味を見て原形・過去形・過去分詞を書く' },
      star_only: { type: 'boolean', description: '☆（よく出る）の語だけにする（words のときだけ）' },
      direction: { type: 'string', enum: ['ja-en', 'en-ja', 'mix'], description: 'ja-en：日本語を見て英語を書く（既定）／en-ja：英語の意味を書く／mix：半分ずつ（words・basic のとき）' },
      count: { type: 'number', description: `問題の数（省くと範囲のすべて。words・basic は${MAX_COUNT.words}問、kwt は${MAX_COUNT.kwt}問、verbs は${MAX_COUNT.verbs}問まで）` },
      order: { type: 'string', enum: ['book', 'random'], description: 'book：教材（一覧）の順（既定）／random：ばらばら' },
      versions: { type: 'number', description: '版の数（1〜3。2なら A版・B版。同じ問題で並びを変える）。省くと1' },
      title: { type: 'string', description: 'ファイル名（省くと「英語 中1 Unit4（Part1） 単語テスト」の形）。40字まで' },
    },
    required: [],
  } as unknown as Anthropic.Tool.InputSchema,
};

/** 道具の入力を、選ぶ関数の形にする。 */
export function toOptions(input: Record<string, unknown>): WordQuizOptions {
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
  return {
    grade: str(input.grade),
    unit: str(input.unit),
    sections: Array.isArray(input.sections) ? input.sections.map(str).filter(Boolean).slice(0, 12) : [],
    source: input.source === 'kwt' ? 'kwt' : 'words',
    starOnly: input.star_only === true,
    direction: input.direction === 'en-ja' || input.direction === 'mix' ? input.direction : 'ja-en',
    count: typeof input.count === 'number' ? input.count : undefined,
    order: input.order === 'random' ? 'random' : 'book',
    versions: typeof input.versions === 'number' ? input.versions : 1,
    title: str(input.title),
  };
}

/** 基本単語・不規則動詞のときの、選ぶ関数の形。 */
export function toBasicOptions(input: Record<string, unknown>): BasicQuizOptions {
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 12) : typeof v === 'string' && v.trim() ? [v.trim()] : []);
  return {
    kind: input.source === 'verbs' ? 'verbs' : 'words',
    categories: list(input.categories),
    levels: list(input.levels),
    pos: list(input.pos),
    direction: input.direction === 'en-ja' || input.direction === 'mix' ? input.direction : 'ja-en',
    verbAsk: input.verb_ask === 'past' || input.verb_ask === 'all' ? input.verb_ask : 'past-pp',
    count: typeof input.count === 'number' ? input.count : undefined,
    order: input.order === 'random' ? 'random' : 'book',
    versions: typeof input.versions === 'number' ? input.versions : 1,
    title: str(input.title),
  };
}

/** 回答に書くための、問題と答えの一覧（版の1つ目。長いときは省く）。 */
function answerList(q: { value: WordQuiz }): string {
  const v = q.value.versions[0];
  const rows = v.questions.slice(0, 60).map((x, i) =>
    x.kind === 'word'
      ? `(${i + 1}) ${x.prompt} → ${x.answer}`
      : x.kind === 'verb'
        ? `(${i + 1}) ${x.ja}：${x.base} - ${x.past} - ${x.pp}`
        : `(${i + 1}) ${x.ja} → ${x.en.replace(/\[\[(.+?)\]\]/g, '［$1］')}`,
  );
  return rows.join('\n') + (v.questions.length > 60 ? `\n…ほか${v.questions.length - 60}問` : '');
}

/** create_english_word_quiz：Word（テスト・答え入り）を作って保存し、AI に返す文と、ログ用の結果を返す。 */
export async function runCreateEnglishWordQuiz(
  input: Record<string, unknown>,
  who: { campus: string; user: string },
  signal?: AbortSignal,
): Promise<MathRunResult> {
  const basic = input.source === 'basic' || input.source === 'verbs';
  const c = basic ? buildBasicQuiz(BASIC, toBasicOptions(input)) : buildWordQuiz(BOOKS, toOptions(input));
  if (!c.ok) return { toolResult: c.message, created: [{ ok: false, title: `英語の単語テスト：${basic ? String(input.source) : String(input?.unit ?? '')}`, note: c.message.slice(0, 120) }], inputError: true };
  const q = c.value;
  let test: Buffer;
  let answers: Buffer;
  try {
    test = await buildWordQuizDocx(q);
    answers = await buildWordQuizDocx(q, { withAnswers: true });
  } catch (e) {
    const why = `Word を組み立てられませんでした（${String((e as Error)?.message ?? e).slice(0, 120)}）`;
    return { toolResult: `${why}。職員にそのことを伝え、下の問題と答えを回答に書く。\n${answerList(c)}`, created: [{ ok: false, title: `英語の単語テスト：${q.title}`, note: why }] };
  }
  const j = await callGas(
    {
      action: 'saveAiFiles',
      campus: who.campus,
      user: who.user,
      files: [
        { name: `${q.title}.docx`, mime: DOCX_MIME, base64: test.toString('base64') },
        { name: `${q.title}_答え入り.docx`, mime: DOCX_MIME, base64: answers.toString('base64') },
      ],
    },
    signal,
  );
  const o = readSaveResult(j, [
    { label: 'テスト', name: `${q.title}.docx` },
    { label: '答え入り', name: `${q.title}_答え入り.docx` },
  ]);
  const count = q.versions[0].questions.length;
  const per = PER_SHEET[q.source];
  const sheets = Math.ceil(count / per);
  const summary = `${q.range}・${q.source === 'kwt' ? 'Key Words TEST' : q.source === 'verbs' ? '不規則動詞' : '単語'}・${count}問（範囲の${q.available}問から）・${sheets}枚${q.versions.length > 1 ? `×${q.versions.length}版` : ''}`;
  if (!o.ok) {
    return {
      toolResult: `Word のファイルを保存できませんでした（${o.why}）。この回答では呼び直さない。職員にそのことを伝え、下の問題と答えを回答に書く。\n${answerList(c)}`,
      created: [{ ok: false, title: `英語の単語テスト：${q.title}`, note: `${o.why}${o.detail ? `／詳細: ${o.detail}` : ''}` }],
    };
  }
  return {
    toolResult:
      `英語の単語テストの Word を${o.saved.length}つ作りました（${summary}）。\n${o.saved.map((f) => `${f.label}：${f.url}`).join('\n')}\n` +
      (o.failed.length ? `「${o.failed.map((f) => f.label).join('」「')}」は保存できませんでした。もう一度頼めば作り直せることを伝える。\n` : '') +
      '回答には、このURLと、作った範囲・問題の数・枚数を短く書く。問題の全文は書かない。' +
      (sheets > 1 ? `1枚に${per}問までなので${sheets}枚になったこと（1枚にしたいなら数を${per}問以下にすればよいこと）も書く。` : ''),
    created: [
      ...o.saved.map((f) => ({ ok: true, title: `英語の単語テスト：${q.title}${f.label === '答え入り' ? '（答え入り）' : ''}`, url: f.url, note: f.label === 'テスト' ? `作成（${summary}）` : '作成' })),
      ...o.failed.map((f) => ({ ok: false, title: `英語の単語テスト：${q.title}（${f.label}）`, note: `保存できず${f.detail ? `／詳細: ${f.detail}` : ''}` })),
    ],
  };
}

