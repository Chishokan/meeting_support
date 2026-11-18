// 画像を作る道具（imageTool.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkImageInput, imageDailyLimit, imagePrompt, pickImageModels, readImageResponse, GENERATE_IMAGE_TOOL } from './imageTool.ts';

test('checkImageInput：既定（用途ごとの縦横の比・ファイル名）を埋める', () => {
  const r = checkImageInput({ prompt: ' 冬期講習 中3 のチラシ。雪と桜の配色 ', purpose: 'チラシ' });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.aspect, '3:4');
  assert.equal(r.value.prompt, '冬期講習 中3 のチラシ。雪と桜の配色');
  assert.match(r.value.name, /^チラシ_冬期講習中3のチラシ/);
  const s = checkImageInput({ prompt: '黒板と鉛筆', purpose: 'スライド', name: 'a/b:c*d', aspect: '1:1', source: ' 前の画像.png ' });
  assert.ok(s.ok);
  if (!s.ok) return;
  assert.equal(s.value.aspect, '1:1');
  assert.equal(s.value.name, 'a b c d');
  assert.equal(s.value.source, '前の画像.png');
  const t = checkImageInput({ prompt: 'x', aspect: '5:7', purpose: '不明' });
  assert.ok(t.ok && t.value.purpose === '挿絵' && t.value.aspect === '1:1');
});

test('checkImageInput：足りない・長すぎるときは理由を返す', () => {
  assert.equal(checkImageInput({}).ok, false);
  const long = checkImageInput({ prompt: 'あ'.repeat(2001) });
  assert.ok(!long.ok && /2000字/.test(long.message));
});

test('imagePrompt：描かせないものを足す。直すときは元を残すよう頼む', () => {
  const v = { prompt: '冬期講習のチラシ', aspect: '3:4' as const, purpose: 'チラシ' as const, name: 'x', source: '' };
  assert.match(imagePrompt(v, false), /実在の人物の顔・他社のロゴ・QRコードは描かない/);
  assert.match(imagePrompt(v, false), /募集の広告/);
  assert.match(imagePrompt(v, true), /^次の画像を、指示どおりに直してください/);
});

test('readImageResponse：画像を取り出す・止まった理由を返す', () => {
  const ok = readImageResponse({ candidates: [{ content: { parts: [{ text: 'できました' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] });
  assert.deepEqual(ok, { ok: true, mime: 'image/png', data: 'AAAA', text: 'できました' });
  const snake = readImageResponse({ candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/jpeg', data: 'BBBB' } }] } }] });
  assert.ok(snake.ok && snake.mime === 'image/jpeg');
  assert.deepEqual(readImageResponse({ promptFeedback: { blockReason: 'SAFETY' } }), { ok: false, reason: 'blocked', detail: 'SAFETY' });
  const safety = readImageResponse({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] });
  assert.ok(!safety.ok && safety.reason === 'blocked');
  const empty = readImageResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '画像は作れません' }] } }] });
  assert.ok(!empty.ok && empty.reason === 'empty' && /画像は作れません/.test(empty.detail));
  assert.equal(readImageResponse(null).ok, false);
});

test('pickImageModels：正式版・新しい版・flash を先に。imagen と文字のモデルは使わない', () => {
  const list = [
    { name: 'models/gemini-3.6-flash', methods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-image', methods: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-image-preview', methods: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-image', methods: ['generateContent', 'countTokens'] },
    { name: 'models/gemini-3-pro-image', methods: ['generateContent'] },
    { name: 'models/imagen-4.0-generate-001', methods: ['predict'] },
    { name: 'models/gemini-embedding-image-001', methods: ['embedContent'] },
  ];
  assert.deepEqual(pickImageModels(list), ['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview']);
  assert.deepEqual(pickImageModels([]), []);
});

test('imageDailyLimit・道具の説明', () => {
  assert.equal(imageDailyLimit(undefined), 20);
  assert.equal(imageDailyLimit('5'), 5);
  assert.equal(imageDailyLimit('abc'), 20);
  assert.equal(imageDailyLimit(' '), 20);
  assert.equal(imageDailyLimit('0'), 0);
  assert.match(GENERATE_IMAGE_TOOL.description, /実在の人物/);
  assert.match(GENERATE_IMAGE_TOOL.description, /日付・料金・電話番号/);
});

// --- OpenAI の画像（gpt-image） ---
import { imageProviders, openAiSize, pickOpenAiImageModels, readOpenAiImage } from './imageTool.ts';

test('openAiSize：縦横の比を、gpt-image の3つの大きさに寄せる', () => {
  assert.equal(openAiSize('1:1'), '1024x1024');
  assert.equal(openAiSize('3:4'), '1024x1536');
  assert.equal(openAiSize('9:16'), '1024x1536');
  assert.equal(openAiSize('16:9'), '1536x1024');
  assert.equal(openAiSize('4:3'), '1536x1024');
});

test('pickOpenAiImageModels：gpt-image の新しい版を先に。日付つき・mini・ほかの名前はあと', () => {
  const ids = ['gpt-4.1', 'gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-2', 'gpt-image-2-2026-04-21', 'dall-e-3'];
  assert.deepEqual(pickOpenAiImageModels(ids), ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1']);
  assert.deepEqual(pickOpenAiImageModels(['gpt-4.1']), ['gpt-image-1']);
});

test('readOpenAiImage：画像・描けない内容・エラーを見分ける', () => {
  assert.deepEqual(readOpenAiImage({ data: [{ b64_json: 'AAAA' }] }, 200), { ok: true, mime: 'image/png', data: 'AAAA' });
  assert.equal((readOpenAiImage({ data: [{ b64_json: 'AAAA' }], output_format: 'jpeg' }, 200) as { mime: string }).mime, 'image/jpeg');
  const blocked = readOpenAiImage({ error: { code: 'moderation_blocked', message: 'Your request was rejected by the safety system.' } }, 400);
  assert.ok(!blocked.ok && blocked.reason === 'blocked');
  const quota = readOpenAiImage({ error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }, 429);
  assert.ok(!quota.ok && quota.reason === 'error' && /quota/.test(quota.detail));
  assert.ok(!readOpenAiImage({ data: [] }, 200).ok);
});

test('imageProviders：既定は OpenAI → Google。キーの無いものは外す', () => {
  assert.deepEqual(imageProviders({ openai: true, google: true }, undefined), ['openai', 'google']);
  assert.deepEqual(imageProviders({ openai: true, google: true }, 'google'), ['google', 'openai']);
  assert.deepEqual(imageProviders({ openai: false, google: true }, ''), ['google']);
  assert.deepEqual(imageProviders({ openai: false, google: false }, ''), []);
});
