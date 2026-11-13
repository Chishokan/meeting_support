// 画面（ブラウザ）専用：画像を長辺1600pxに縮小して JPEG の base64 にする（会議AIと同じ）。
// 智翔館AI の添付と、不具合報告の画面の写真で使う。

// 画像は長辺1600pxに縮小してJPEG化（会議AIと同じ）。
export async function imageToBase64(file: File): Promise<{ data: string; mime: string }> {
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
  if (m > 1600) {
    const s = 1600 / m;
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { data: dataUrl.split(',')[1] ?? '', mime: file.type || 'image/png' };
  ctx.drawImage(img, 0, 0, w, h);
  return { data: canvas.toDataURL('image/jpeg', 0.8).split(',')[1] ?? '', mime: 'image/jpeg' };
}

