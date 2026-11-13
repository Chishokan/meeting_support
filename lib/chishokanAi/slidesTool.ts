// 智翔館AI：Google スライドを作る道具（AIに渡すツール定義・入力の確認・ひな形の見せ方）。ほかに依存しない。
//
// ひな形は Drive の「15_AIスライドテンプレート」にある Google スライド（apps_script/Code.gs の AI_SLIDE_TEMPLATE_FOLDER_ID）。
// 見本の文字が入ったスライドをそのまま型にする：
//   1. get_slide_templates：ひな形の一覧 → 1つのひな形の、スライドごとの文字の枠（key・見本の文字・目安の文字数）と表
//   2. create_google_slides：使うスライド（from）を並べ、枠ごとに文字を書き換える。表は行を増やせる。発表者ノートも入れる
// Apps Script がひな形をコピーして作り、ロゴ（フォルダの「ロゴ…」の画像）を置き、00_進行中/AI作成 に保存して URL を返す。
// 実行は slides.ts。

export const SLIDES_TEMPLATES_TOOL = {
  name: 'get_slide_templates',
  description:
    'Google スライドを作る前に呼ぶ。template を省くと、ひな形の一覧（名前・枚数・各スライドの見出し）が返る。' +
    'template にひな形の名前を渡すと、スライドごとの文字の枠（key・見本の文字・目安の文字数）と表の形が返る。',
  input_schema: {
    type: 'object' as const,
    properties: { template: { type: 'string', description: 'ひな形の名前（一覧の名前。省くと一覧）' } },
  },
};

export const CREATE_SLIDES_TOOL = {
  name: 'create_google_slides',
  description:
    '職員がスライドを作ってと頼み、スライドの流れが決まったときだけ使う。get_slide_templates で見たひな形の key を使って、Google スライドを作り URL を返す。' +
    'slides は作るスライドの順。from はひな形の何枚目（0から）を使うか（同じスライドを何度使ってもよい）。' +
    'texts はその枠の key → 書く文字。見本の文字はすべて書き換える（そのまま残す見出しは同じ文字を入れる）。文字数は目安（max）以内。' +
    'tables は表の key → 行の配列（1行目が見出し）。行は増減できる。列の数はひな形のまま。ページ番号の数字は並べた順に振り直す。' +
    'notes は発表者ノート。数字・日付は資料にあるものだけ。1回の回答で1つまで。',
  input_schema: {
    type: 'object' as const,
    properties: {
      template: { type: 'string', description: 'ひな形の名前' },
      title: { type: 'string', description: 'ファイルの題名（80文字まで）' },
      slides: {
        type: 'array',
        description: '作るスライド（30枚まで）',
        items: {
          type: 'object',
          properties: {
            from: { type: 'integer', description: 'ひな形の何枚目を使うか（0から）' },
            texts: { type: 'object', description: '枠の key → 文字', additionalProperties: { type: 'string' } },
            tables: {
              type: 'object',
              description: '表の key → 行の配列',
              additionalProperties: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            },
            notes: { type: 'string', description: '発表者ノート' },
          },
          required: ['from'],
        },
      },
    },
    required: ['template', 'title', 'slides'],
  },
};

export const MAX_SLIDES = 30;
const MAX_TEXT = 1000;
const MAX_ROWS = 30;
const MAX_COLS = 10;
const MAX_NOTES = 3000;

export type SlideSpec = { from: number; texts: Record<string, string>; tables: Record<string, string[][]>; notes: string };
export type SlidesInput = { template: string; title: string; slides: SlideSpec[] };

const KEY = /^\d{1,3}(\.\d{1,3}){0,4}$/;

/** AI が渡した入力を確かめて整える。問題があれば、AI に返す理由の文を返す。 */
export function checkSlidesInput(input: Record<string, unknown>): { ok: true; value: SlidesInput } | { ok: false; message: string } {
  const template = typeof input?.template === 'string' ? input.template.trim() : '';
  const title = typeof input?.title === 'string' ? input.title.trim().slice(0, 80) : '';
  const raw = Array.isArray(input?.slides) ? input.slides : [];
  if (!template) return { ok: false, message: 'ひな形の名前（template）がありません。get_slide_templates で一覧を見てください。' };
  if (!title) return { ok: false, message: '題名（title）がありません。' };
  if (raw.length === 0) return { ok: false, message: 'スライド（slides）がありません。' };
  if (raw.length > MAX_SLIDES) return { ok: false, message: `スライドは${MAX_SLIDES}枚までです。まとめてください。` };
  const slides: SlideSpec[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = (raw[i] && typeof raw[i] === 'object' ? raw[i] : {}) as Record<string, unknown>;
    const from = Number(s.from);
    if (!Number.isInteger(from) || from < 0 || from > 99) return { ok: false, message: `${i + 1}枚目の from（ひな形の何枚目か）が正しくありません。` };
    const texts: Record<string, string> = {};
    for (const [k, v] of Object.entries((s.texts && typeof s.texts === 'object' ? s.texts : {}) as Record<string, unknown>)) {
      if (!KEY.test(k)) return { ok: false, message: `${i + 1}枚目の枠の key「${k}」が正しくありません。get_slide_templates の key を使ってください。` };
      texts[k] = String(v ?? '').slice(0, MAX_TEXT);
    }
    const tables: Record<string, string[][]> = {};
    for (const [k, v] of Object.entries((s.tables && typeof s.tables === 'object' ? s.tables : {}) as Record<string, unknown>)) {
      if (!KEY.test(k)) return { ok: false, message: `${i + 1}枚目の表の key「${k}」が正しくありません。` };
      if (!Array.isArray(v)) return { ok: false, message: `${i + 1}枚目の表「${k}」は行の配列にしてください。` };
      tables[k] = v.slice(0, MAX_ROWS).map((row) => (Array.isArray(row) ? row.slice(0, MAX_COLS).map((c) => String(c ?? '').slice(0, 300)) : []));
    }
    slides.push({ from, texts, tables, notes: typeof s.notes === 'string' ? s.notes.slice(0, MAX_NOTES) : '' });
  }
  return { ok: true, value: { template, title, slides } };
}

// --- Apps Script から返るひな形の形と、AI に見せる文 -----------------------------

export type TemplateSummary = { id: string; name: string; slides: number; labels: string[]; error?: string };
export type TemplateItem =
  | { key: string; type: 'text'; text: string; max: number }
  | { key: string; type: 'table'; rows: number; cols: number; cells: string[][] };
export type TemplateDetail = { id: string; name: string; slides: { index: number; label: string; items: TemplateItem[]; notes?: string }[] };

export function formatTemplateList(list: TemplateSummary[]): string {
  if (!list.length) return 'スライドのひな形がありません（15_AIスライドテンプレート に Google スライド形式のファイルを置く）。職員にそのことを伝える。';
  const lines = list.map((t) =>
    t.error
      ? `- ${t.name}（開けませんでした）`
      : `- ${t.name}（${t.slides}枚）：${t.labels.map((l, i) => `${i}:${l || '（文字なし）'}`).join('／')}`,
  );
  return `【スライドのひな形の一覧】\n${lines.join('\n')}\n\n用途に合うひな形を1つ選び、get_slide_templates に名前を渡して、枠の一覧を見る。`;
}

const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s*\n\s*/g, '⏎').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export function formatTemplateDetail(t: TemplateDetail): string {
  const out: string[] = [
    `【スライドのひな形：${t.name}（${t.slides.length}枚）】`,
    'key ごとに書き換える文字を決める。⏎ は改行（同じ枠の中で行を分けるときは \\n を入れる）。［〜字］は目安の上限。',
    '数字だけの枠（1, 2 …）はページ番号。並べた順に振り直す。',
  ];
  for (const s of t.slides) {
    out.push('', `■ from=${s.index}「${s.label || '（見出しなし）'}」${s.notes ? `（ノート：${oneLine(s.notes, 40)}）` : ''}`);
    for (const it of s.items) {
      if (it.type === 'text') out.push(`- ${it.key}［${it.max}字］${oneLine(it.text, 80)}`);
      else {
        const head = it.cells.slice(0, 3).map((r) => `| ${r.map((c) => oneLine(c, 24)).join(' | ')} |`);
        out.push(`- ${it.key}［表 ${it.rows}行×${it.cols}列］`, ...head.map((h) => `    ${h}`), ...(it.rows > 3 ? [`    …（ほか${it.rows - 3}行）`] : []));
      }
    }
  }
  return out.join('\n');
}
