// 智翔館AI：数学の図（SVG）を PNG にする。サーバ専用（Google ドキュメントに入れるため）。
//
// 描くのは resvg（WebAssembly 版）。書体は DejaVu Sans（npm の dejavu-fonts-ttf）を読み込み、サーバの書体には頼らない。
// どちらのファイルも next.config.mjs の outputFileTracingIncludes で本番に同梱する。

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { renderFigureSvg, type FigureSpec } from './figure';

const WASM = path.join(process.cwd(), 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm');
const FONT = path.join(process.cwd(), 'node_modules', 'dejavu-fonts-ttf', 'ttf', 'DejaVuSans.ttf');

let ready: Promise<Uint8Array> | null = null;

/** wasm と書体を1回だけ読み込む（2回目からは使い回す）。 */
function prepare(): Promise<Uint8Array> {
  if (!ready) {
    ready = (async () => {
      const [wasm, font] = await Promise.all([fs.readFile(WASM), fs.readFile(FONT)]);
      try {
        await initWasm(wasm);
      } catch (e) {
        // 同じ実行環境で2回目の初期化は失敗するが、使える状態なので無視する
        if (!/already/i.test(String(e))) throw e;
      }
      return new Uint8Array(font);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export type FigurePng = { base64: string; width: number; height: number; caption: string; widthCm: number };

/** 図の記述を PNG（2倍の解像度）にする。ドキュメントに入れるときの幅（cm）も返す。 */
export async function renderFigurePng(spec: FigureSpec): Promise<FigurePng> {
  const font = await prepare();
  const { svg, width, height } = renderFigureSvg(spec);
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width * 2 },
    font: { fontBuffers: [font], loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' },
    background: '#ffffff',
  });
  const png = r.render().asPng();
  return { base64: Buffer.from(png).toString('base64'), width, height, caption: spec.caption ?? '', widthCm: spec.size ?? 8 };
}
