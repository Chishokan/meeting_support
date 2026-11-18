// 智翔館AI：画像を作る道具（generate_image）の定義と、入力の確かめ・Gemini の返事の読み取り。ほかに依存しない（テストしやすいように）。
//
// 2026-11-18：チラシの画像とスライドの挿絵を、智翔館AI の中で作れるようにした（Google の Gemini の画像モデル）。
// これまでチラシは、AI が書いたプロンプトを職員が ChatGPT に貼って作っていた。
// - 作った画像は Apps Script がドライブの「AI作成」に保存し、リンクを返す（apps_script/Code.gs の aiImageSave_）
// - 画面は回答の下に画像を出し、次の質問にも「前の添付」として付け直す（「文字を大きく」などで直せる）
// - スライドには、保存した画像の番号（id）を layout の image に入れて差し込む
// 呼び出しは imageGen.ts。決まり（描かせないもの・日本語の文字）は knowledge/05_作業/10_チラシを作る.md・30_スライドの構成を作る.md。

export const IMAGE_ASPECTS = ['1:1', '3:4', '4:3', '2:3', '3:2', '9:16', '16:9'] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];
export const IMAGE_PURPOSES = ['チラシ', 'ポスター', 'サイネージ', 'スライド', '挿絵'] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

/** 1人が1日に作れる枚数（環境変数 CHISHOKAN_AI_IMAGE_DAILY で変える）。 */
export const IMAGE_DAILY_DEFAULT = 20;

export const GENERATE_IMAGE_TOOL = {
  name: 'generate_image',
  description:
    '画像を作り、ドライブ（AI作成）に保存してリンクを返す（Google の画像生成AI）。職員が画像・チラシの画像・スライドの挿絵を頼んだときだけ使う。' +
    'prompt は絵の説明（何を・どんな雰囲気で・配色・構図。日本語でよい）。aspect は縦横の比（チラシ A4縦は 3:4、サイネージ・スライドは 16:9、SNS は 1:1）。' +
    'source に、前の回の画像・添付した画像のファイル名を渡すと、その画像を直す（「文字を大きく」「背景を青に」など）。' +
    '描かせないもの：実在の人物（講師・生徒・社長など）の顔、他社のロゴ・東進の素材、ロゴ・QRコード（あとから正式データを重ねる）。' +
    '日本語の文字は崩れることがある。日付・料金・電話番号は、作ったあと必ず原稿と照らし合わせるよう職員に伝える。スライドには、結果の id を create_google_slides の image に入れる。1回の回答で3枚まで。',
  input_schema: {
    type: 'object' as const,
    properties: {
      prompt: { type: 'string', description: '絵の説明（2000字まで）' },
      aspect: { type: 'string', enum: IMAGE_ASPECTS, description: '縦横の比（既定：チラシ 3:4、スライド・サイネージ 16:9、ほか 1:1）' },
      purpose: { type: 'string', enum: IMAGE_PURPOSES, description: '用途' },
      name: { type: 'string', description: 'ファイル名（例：冬期講習_中3_チラシ案）。40字まで' },
      source: { type: 'string', description: '直す元の画像のファイル名（前の回の画像・添付した画像）。新しく作るときは省く' },
    },
    required: ['prompt'],
  },
};

/** 1回の回答で作れる枚数（時間と費用のため）。 */
export const IMAGE_MAX_PER_TURN = 3;

export type ImageInput = { prompt: string; aspect: ImageAspect; purpose: ImagePurpose; name: string; source: string };

const DEFAULT_ASPECT: Record<ImagePurpose, ImageAspect> = { チラシ: '3:4', ポスター: '3:4', サイネージ: '16:9', スライド: '16:9', 挿絵: '1:1' };

/** AI が渡した入力を確かめて整える。問題があれば、AI に返す理由の文を返す。 */
export function checkImageInput(input: Record<string, unknown>): { ok: true; value: ImageInput } | { ok: false; message: string } {
  const prompt = typeof input?.prompt === 'string' ? input.prompt.replace(/\r\n?/g, '\n').trim() : '';
  if (!prompt) return { ok: false, message: 'prompt（絵の説明）がありません。' };
  if (prompt.length > 2000) return { ok: false, message: 'prompt は2000字までです。短くしてください。' };
  const purpose = (IMAGE_PURPOSES as readonly string[]).includes(String(input?.purpose)) ? (input.purpose as ImagePurpose) : '挿絵';
  const aspect = (IMAGE_ASPECTS as readonly string[]).includes(String(input?.aspect)) ? (input.aspect as ImageAspect) : DEFAULT_ASPECT[purpose];
  const name =
    (typeof input?.name === 'string' ? input.name : '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) ||
    `${purpose}_${prompt.replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 16)}`;
  const source = typeof input?.source === 'string' ? input.source.trim().slice(0, 200) : '';
  return { ok: true, value: { prompt, aspect, purpose, name, source } };
}

/** Gemini に送る指示（職員の説明に、守ることを足す）。 */
export function imagePrompt(v: ImageInput, editing: boolean): string {
  const rules = [
    '実在の人物の顔・他社のロゴ・QRコードは描かない。',
    v.purpose === 'チラシ' || v.purpose === 'ポスター' || v.purpose === 'サイネージ'
      ? '学習塾の募集の広告として、読みやすく、明るく信頼感のあるデザインにする。'
      : '学習塾の資料に入れる、シンプルで見やすい絵にする。',
  ];
  return `${editing ? '次の画像を、指示どおりに直してください。直す指示以外のところは、できるだけ元のまま残してください。\n' : ''}${v.prompt}\n\n（守ること）${rules.join('')}`;
}

/** Gemini の generateContent の返事から、画像を取り出す。無ければ止まった理由を返す。 */
export function readImageResponse(j: unknown): { ok: true; mime: string; data: string; text: string } | { ok: false; reason: 'blocked' | 'empty'; detail: string } {
  const root = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  const fb = (root.promptFeedback ?? {}) as Record<string, unknown>;
  if (typeof fb.blockReason === 'string' && fb.blockReason) return { ok: false, reason: 'blocked', detail: String(fb.blockReason) };
  const cands = Array.isArray(root.candidates) ? (root.candidates as Record<string, unknown>[]) : [];
  const texts: string[] = [];
  for (const c of cands) {
    const parts = Array.isArray((c?.content as Record<string, unknown> | undefined)?.parts) ? ((c.content as Record<string, unknown>).parts as Record<string, unknown>[]) : [];
    for (const p of parts) {
      const d = (p?.inlineData ?? p?.inline_data) as Record<string, unknown> | undefined;
      if (d && typeof d.data === 'string' && d.data) {
        const mime = String(d.mimeType ?? d.mime_type ?? 'image/png');
        if (mime.startsWith('image/')) return { ok: true, mime, data: d.data, text: texts.join('').trim() };
      }
      if (typeof p?.text === 'string') texts.push(p.text);
    }
  }
  const finish = cands.map((c) => String(c?.finishReason ?? '')).find(Boolean) ?? '';
  if (/SAFETY|PROHIBITED|BLOCK|RECITATION|IMAGE_OTHER/i.test(finish)) return { ok: false, reason: 'blocked', detail: finish };
  return { ok: false, reason: 'empty', detail: (texts.join('').trim() || finish || '画像が返ってきませんでした').slice(0, 200) };
}

/**
 * 画像を作るモデルの候補（ListModels の名前から）。gemini の「…image…」で generateContent が使えるもの。
 * 正式版（preview でない）・新しい版を先にする。imagen（別の呼び方）は使わない。
 */
export function pickImageModels(models: { name: string; methods: string[] }[]): string[] {
  const ok = models
    .map((m) => ({ name: m.name.replace(/^models\//, ''), methods: m.methods }))
    .filter((m) => /^gemini-.*image/i.test(m.name) && m.methods.includes('generateContent') && !/tts|embedding/i.test(m.name));
  const ver = (n: string) => Number((/gemini-(\d+(?:\.\d+)?)/.exec(n) ?? [])[1] ?? 0);
  return ok
    .sort((a, b) => Number(/preview|exp/.test(a.name)) - Number(/preview|exp/.test(b.name)) || ver(b.name) - ver(a.name) || Number(/pro/.test(a.name)) - Number(/pro/.test(b.name)))
    .map((m) => m.name);
}

/** 使う人の1日の上限。 */
export function imageDailyLimit(env: string | undefined = process.env.CHISHOKAN_AI_IMAGE_DAILY): number {
  if (env === undefined || !String(env).trim()) return IMAGE_DAILY_DEFAULT;
  const n = Number(env);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : IMAGE_DAILY_DEFAULT;
}
