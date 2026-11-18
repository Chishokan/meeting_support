// 智翔館AI：Google スライドを作る道具（AIに渡すツール定義・入力の確認・ひな形の見せ方）。ほかに依存しない。
//
// ひな形は Drive の「15_AIスライドテンプレート」にある Google スライド（apps_script/Code.gs の AI_SLIDE_TEMPLATE_FOLDER_ID）。
// スライドは2通りで作れる（1つのファイルの中で混ぜてよい）：
//   - from：ひな形のスライドをそのまま型にし、枠ごとに見本の文字を書き換える（表紙・内容がぴったり合う枚）
//   - layout：ひな形の見た目（背景・見出しの飾り・書体・色・ロゴ）を引き継いで、決まった組み方（表紙・章の扉・メッセージ・
//     箇条書き・カード・表）で自由に組む（ひな形に合う枚が無いとき）。2026-11-17 の会話ログで、合う枚が無く作れなかったため
//   1. get_slide_templates：ひな形の一覧 → 1つのひな形の、スライドごとの文字の枠（key・見本の文字・目安の文字数）と表、見た目
//   2. create_google_slides：使うスライド（from か layout）を並べる。発表者ノートも入れる
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
    '職員がスライドを作ってと頼み、スライドの流れが決まったときだけ使う。get_slide_templates で見たひな形を使って、Google スライドを作り URL を返す。' +
    'slides は作るスライドの順。1枚ごとに、次のどちらかで書く（混ぜてよい）。' +
    '【from】ひな形の何枚目（0から）をそのまま使い、texts（枠の key → 書く文字）と tables（表の key → 行の配列）で書き換える。' +
    '見本の文字はすべて書き換える。文字数は目安（max）以内。ページ番号の数字は並べた順に振り直す。内容がぴったり合う枚（表紙など）に使う。' +
    '【layout】ひな形の見た目（背景・見出しの飾り・書体・色・ロゴ）で、自由に組む。合う枚が無いときはこちらで作る（「合うひな形が無い」と止めない）。' +
    'layout：title（表紙。title・lead＝副題・points＝日付や名前）／section（章の扉。title・lead）／message（大きな一言。title・lead。承認・問いかけ・まとめ）／' +
    'bullets（見出しと箇条書き。title・lead・points 1〜8）／columns（見出しとカード2〜4枚。title・lead・columns［{title, text}］）／table（見出しと表。title・lead・table＝行の配列、1行目が見出し）／' +
    'image（見出しと画像。title・lead・image・points＝左に並べる要点。省くと画像を大きく）。image は generate_image で作った画像の id（title・section にも付けられ、右半分に入る）。' +
    'base はどのスライドの見た目（背景・見出しの飾り）を使うか（ひな形の何枚目。省くと表紙は0枚目、ほかは見出しのある最初の枚）。文字の大きさはアプリが枠に合わせる。' +
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
            from: { type: 'integer', description: '【from】ひな形の何枚目を使うか（0から）' },
            texts: { type: 'object', description: '【from】枠の key → 文字', additionalProperties: { type: 'string' } },
            tables: {
              type: 'object',
              description: '【from】表の key → 行の配列',
              additionalProperties: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            },
            layout: { type: 'string', enum: ['title', 'section', 'message', 'bullets', 'columns', 'table', 'image'], description: '【layout】組み方' },
            image: { type: 'string', description: '【layout】generate_image で作った画像の id（image・title・section）' },
            base: { type: 'integer', description: '【layout】見た目を使うひな形の何枚目（省いてよい）' },
            title: { type: 'string', description: '【layout】見出し（message は大きな一言）' },
            lead: { type: 'string', description: '【layout】見出しの下の1〜2文（副題・リード文）' },
            points: { type: 'array', items: { type: 'string' }, description: '【layout】箇条書き（bullets）、表紙の日付・名前（title）' },
            columns: {
              type: 'array',
              description: '【layout】カード（columns）2〜4枚',
              items: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } } },
            },
            table: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '【layout】表（table）。1行目が見出し' },
            notes: { type: 'string', description: '発表者ノート' },
          },
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

export const SLIDE_LAYOUTS = ['title', 'section', 'message', 'bullets', 'columns', 'table', 'image'] as const;
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number];

/** ひな形のスライドをそのまま使う枚。 */
export type TemplateSlideSpec = { from: number; texts: Record<string, string>; tables: Record<string, string[][]>; notes: string };
/** ひな形の見た目で自由に組む枚。 */
export type LayoutSlideSpec = {
  layout: SlideLayout;
  base?: number;
  title: string;
  lead: string;
  points: string[];
  columns: { title: string; text: string }[];
  table: string[][];
  /** generate_image で作った画像の id（image・title・section） */
  image?: string;
  notes: string;
};
export type SlideSpec = TemplateSlideSpec | LayoutSlideSpec;
export type SlidesInput = { template: string; title: string; slides: SlideSpec[] };

const LAYOUT_LIMITS = { title: 80, lead: 160, point: 140, points: 8, columns: 4, colTitle: 40, colText: 240, rows: 12, cols: 6, cell: 80 };

/** layout の枚を確かめて整える。問題があれば理由の文を返す。 */
function checkLayoutSlide(s: Record<string, unknown>, n: number): LayoutSlideSpec | string {
  const layout = s.layout as SlideLayout;
  if (!SLIDE_LAYOUTS.includes(layout)) return `${n}枚目の layout は ${SLIDE_LAYOUTS.join('・')} のどれかです。`;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');
  const title = str(s.title, LAYOUT_LIMITS.title);
  if (!title) return `${n}枚目（${layout}）に title（見出し）がありません。`;
  const base = s.base === undefined || s.base === null ? undefined : Number(s.base);
  if (base !== undefined && (!Number.isInteger(base) || base < 0 || base > 99)) return `${n}枚目の base（見た目を使うひな形の何枚目か）が正しくありません。`;
  const points = (Array.isArray(s.points) ? s.points : []).map((p) => str(p, LAYOUT_LIMITS.point)).filter(Boolean);
  const columns = (Array.isArray(s.columns) ? s.columns : [])
    .map((c) => {
      const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
      return { title: str(o.title, LAYOUT_LIMITS.colTitle), text: str(o.text, LAYOUT_LIMITS.colText) };
    })
    .filter((c) => c.title || c.text);
  const table = (Array.isArray(s.table) ? s.table : [])
    .slice(0, LAYOUT_LIMITS.rows + 1)
    .map((row) => (Array.isArray(row) ? row.slice(0, LAYOUT_LIMITS.cols).map((c) => str(String(c ?? ''), LAYOUT_LIMITS.cell)) : []))
    .filter((row) => row.length);
  if (layout === 'bullets' && !points.length) return `${n}枚目（bullets）に points（箇条書き）がありません。`;
  if (layout === 'bullets' && points.length > LAYOUT_LIMITS.points) return `${n}枚目（bullets）の箇条書きは${LAYOUT_LIMITS.points}つまでです。分けるか、まとめてください。`;
  if (layout === 'columns' && (columns.length < 2 || columns.length > LAYOUT_LIMITS.columns)) return `${n}枚目（columns）のカードは2〜${LAYOUT_LIMITS.columns}枚にしてください。`;
  const image = typeof s.image === 'string' ? s.image.trim() : '';
  if (image && !/^[\w-]{20,80}$/.test(image)) return `${n}枚目の image は、generate_image の結果に出た id をそのまま入れてください。`;
  if (layout === 'image' && !image) return `${n}枚目（image）に image（generate_image で作った画像の id）がありません。先に generate_image で作ってください。`;
  if (image && !['image', 'title', 'section'].includes(layout)) return `${n}枚目（${layout}）には画像を入れられません（image・title・section だけ）。`;
  if (layout === 'table') {
    if (table.length < 2) return `${n}枚目（table）の表は、見出しの行と1行以上にしてください。`;
    if (table.length > LAYOUT_LIMITS.rows) return `${n}枚目（table）の表は${LAYOUT_LIMITS.rows}行までです（見出しの行を含む）。分けてください。`;
    const w = Math.max(...table.map((r) => r.length));
    if (w < 2) return `${n}枚目（table）の表は2列以上にしてください（1列なら bullets）。`;
  }
  return {
    layout,
    ...(base !== undefined ? { base } : {}),
    title,
    lead: str(s.lead, LAYOUT_LIMITS.lead),
    points: points.slice(0, LAYOUT_LIMITS.points),
    columns,
    table,
    ...(image ? { image } : {}),
    notes: typeof s.notes === 'string' ? s.notes.slice(0, MAX_NOTES) : '',
  };
}

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
    if (s.layout !== undefined && s.layout !== null && s.layout !== '') {
      const l = checkLayoutSlide(s, i + 1);
      if (typeof l === 'string') return { ok: false, message: l };
      slides.push(l);
      continue;
    }
    const from = Number(s.from);
    if (!Number.isInteger(from) || from < 0 || from > 99) return { ok: false, message: `${i + 1}枚目の from（ひな形の何枚目か）が正しくありません（自由に組むなら layout を書く）。` };
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
export type TemplateStyle = { headFont?: string; headColor?: string; bodyFont?: string; bodyColor?: string; accent?: string; contentBase?: number };
export type TemplateDetail = {
  id: string;
  name: string;
  style?: TemplateStyle;
  slides: { index: number; label: string; items: TemplateItem[]; notes?: string; heading?: boolean }[];
};

export function formatTemplateList(list: TemplateSummary[]): string {
  if (!list.length) return 'スライドのひな形がありません（15_AIスライドテンプレート に Google スライド形式のファイルを置く）。職員にそのことを伝える。';
  const lines = list.map((t) =>
    t.error
      ? `- ${t.name}（開けませんでした）`
      : `- ${t.name}（${t.slides}枚）：${t.labels.map((l, i) => `${i}:${l || '（文字なし）'}`).join('／')}`,
  );
  return (
    `【スライドのひな形の一覧】\n${lines.join('\n')}\n\n` +
    '見た目（色・書体・雰囲気）が用途に近いひな形を1つ選び、get_slide_templates に名前を渡して、枠の一覧と見た目を見る。' +
    '中身がぴったり合うひな形が無くてもよい：合わない枚は layout で、そのひな形の見た目のまま自由に組める。'
  );
}

const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s*\n\s*/g, '⏎').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export function formatTemplateDetail(t: TemplateDetail): string {
  const st = t.style ?? {};
  const look = [
    st.headFont || st.headColor ? `見出し ${[st.headFont, st.headColor].filter(Boolean).join('・')}` : '',
    st.bodyFont || st.bodyColor ? `本文 ${[st.bodyFont, st.bodyColor].filter(Boolean).join('・')}` : '',
    st.accent ? `アクセント ${st.accent}` : '',
  ].filter(Boolean);
  const out: string[] = [
    `【スライドのひな形：${t.name}（${t.slides.length}枚）】`,
    ...(look.length ? [`見た目：${look.join('／')}（layout の枚もこの書体・色で作る）`] : []),
    '【from で使うとき】key ごとに書き換える文字を決める。⏎ は改行（同じ枠の中で行を分けるときは \\n を入れる）。［〜字］は目安の上限。',
    '数字だけの枠（1, 2 …）はページ番号。並べた順に振り直す。見本の文字が内容と合わない枚は、from ではなく layout で作る。',
    `【layout で組むとき】title／section／message／bullets／columns／table／image（generate_image で作った画像を入れる）。base を省くと、表紙は0枚目、ほかは ${st.contentBase ?? 1} 枚目の見た目（背景・見出しの飾り）を使う。` +
      '「見出しの形」と書いた枚は base に向く（見出しの位置・飾りがそのまま残る）。',
  ];
  for (const s of t.slides) {
    out.push('', `■ from=${s.index}「${s.label || '（見出しなし）'}」${s.heading ? '［見出しの形］' : ''}${s.notes ? `（ノート：${oneLine(s.notes, 40)}）` : ''}`);
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
