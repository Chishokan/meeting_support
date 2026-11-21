// 動画「成績管理 成績入力」の画面写真を、マニュアルの写真を撮るスクリプトの出力（赤枠なし）から作る。
//   node docs/manual/seiseki/entry-shots.js 撮った写真のフォルダ http://localhost:3125   （撮り方は docs/manual/README.md）
//   node docs/manual/video/seiseki-entry/shots-from-manual.mjs 撮った写真のフォルダ
// shots/<名前>.png（2倍の解像度）と shots/<名前>.json（w・h と枠の位置。CSS の px で、写真の左上から）ができる。
// 枠の番号は storyboard.mjs の先頭の説明のとおり（e01_screen の 9・10 は動画だけの枠）。
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const RAW = process.argv[2];
if (!RAW) { console.error('撮った写真のフォルダを渡してください'); process.exit(1); }
const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(DIR, 'shots');
mkdirSync(OUT, { recursive: true });
const MAP = {
  seiseki_in_01_screen: 'e01_screen',
  seiseki_in_02_type: 'e02_type',
  seiseki_in_03_subject: 'e03_subject',
  seiseki_in_05_import: 'e05_import',
  seiseki_in_06_done: 'e06_done',
  seiseki_in_07_absent: 'e07_absent',
};
const boxes = JSON.parse(readFileSync(path.join(RAW, 'boxes.json'), 'utf8'));
for (const [from, to] of Object.entries(MAP)) {
  const v = boxes[from];
  if (!v) throw new Error(`写真がありません：${from}`);
  const { clip } = v;
  const list = [...v.marks, ...(v.video || [])].map((m) => ({
    n: m.n, x: Math.round(m.x - clip.x), y: Math.round(m.y - clip.y), w: Math.round(m.w), h: Math.round(m.h),
  }));
  copyFileSync(path.join(RAW, `${from}.png`), path.join(OUT, `${to}.png`));
  writeFileSync(path.join(OUT, `${to}.json`), JSON.stringify({ w: Math.round(clip.width), h: Math.round(clip.height), boxes: list }, null, 1));
  console.log(to, list.length);
}
