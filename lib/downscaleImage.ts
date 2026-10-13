// 画像をブラウザ側で縮小して data URL（JPEG）に変換し、送信を軽量化する（ブラウザ専用）。
// お問い合わせの添付・つきいち改善の写真で使う。
export async function downscaleToDataUrl(file: File, maxDim = 1600, quality = 0.8): Promise<string> {
  const dataUrl: string = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  const img: HTMLImageElement = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = dataUrl;
  });
  let w = img.width;
  let h = img.height;
  const m = Math.max(w, h);
  if (m > maxDim) {
    const s = maxDim / m;
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}
