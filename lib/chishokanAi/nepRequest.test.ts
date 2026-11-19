// NEPへの作成依頼の案（nepRequest.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNepRequest, formatNepRequest, NEP_REQUEST_CATEGORY, nepRequestToolResult, PROPOSE_NEP_REQUEST_TOOL } from './nepRequest.ts';

const BG = {
  title: '夢・志セミナー スライドの背景画像5枚',
  kind: 'スライドの挿絵・背景',
  purpose: '11/22 夢・志セミナーの表紙と語りかけの枚の背景',
  size: '16:9 を5枚',
  content: '学校の校舎・誰もいない教室・島の浮かぶ湾など。\n薄く敷くので、空や余白の多い構図。',
  avoid: '人物、文字、ロゴ',
  due: '2026年11月21日（土）',
  prompt: 'Photorealistic, no people, no text.',
  notes: 'https://docs.google.com/presentation/d/xxx/edit',
};

test('作るものと中身が無ければ断る', () => {
  const a = checkNepRequest({ content: '校舎の写真' });
  assert.equal(a.ok, false);
  const b = checkNepRequest({ title: '背景', content: '  ' });
  assert.equal(b.ok, false);
  if (!b.ok) assert.match(b.message, /content/);
});

test('種類が一覧に無ければ「その他」、納品希望日が無ければ「未定（相談）」', () => {
  const r = checkNepRequest({ title: '表紙の挿絵', kind: '動画', content: '朝の校舎の挿絵' });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.kind, 'その他');
  assert.equal(r.value.due, '未定（相談）');
  assert.match(nepRequestToolResult(r.value), /いつまでに要るか/);
});

test('問い合わせシートに入れる文：種別・作るもの・納品希望日・中身・指示文の案・会話の番号', () => {
  const r = checkNepRequest(BG);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.kind, 'スライドの挿絵・背景');
  const t = formatNepRequest(r.value, { conversationId: 'c-123' });
  assert.match(t, /^【NEPへの制作依頼】スライドの挿絵・背景｜夢・志セミナー スライドの背景画像5枚/);
  assert.match(t, /■ 納品希望日：2026年11月21日（土）/);
  assert.match(t, /■ 中身\n学校の校舎・誰もいない教室/);
  assert.match(t, /■ 入れないもの：人物、文字、ロゴ/);
  assert.match(t, /■ 画像の指示文の案\nPhotorealistic/);
  assert.match(t, /c-123/);
  assert.equal(NEP_REQUEST_CATEGORY, 'NEPへの制作依頼');
});

test('AI に返す文は「送った」と言わせず、ボタンを押すよう伝えさせる', () => {
  const r = checkNepRequest(BG);
  assert.ok(r.ok);
  if (!r.ok) return;
  const t = nepRequestToolResult(r.value);
  assert.match(t, /まだ送っていない/);
  assert.match(t, /この内容でNEPへ作成依頼を出す/);
  assert.doesNotMatch(t, /いつまでに要るか/);
  assert.match(PROPOSE_NEP_REQUEST_TOOL.description, /この内容でNEPへ作成依頼を出す/);
});
