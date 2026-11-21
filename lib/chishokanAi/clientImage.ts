// 画面（ブラウザ）専用：画像を長辺1600pxに縮小して JPEG の base64 にする（会議AIと同じ）。
// 智翔館AI の添付と、不具合報告の画面の写真で使う。

// 画像は長辺1600pxに縮小してJPEG化（会議AIと同じ）。テスト問題の保存は、小さな字が読めるよう長辺 2400px・質 0.85 で使う。
export async function imageToBase64(file: File, max = 1600, quality = 0.8): Promise<{ data: string; mime: string }> {
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
  if (m > max) {
    const s = max / m;
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { data: dataUrl.split(',')[1] ?? '', mime: file.type || 'image/png' };
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return { data: canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '', mime: 'image/jpeg' };
}


// 智翔館AI が作った画像（data URL）を、長辺 max px の JPEG の base64 にする（次の質問に付け直すときに軽くするため）。
export async function shrinkDataUrl(dataUrl: string, max = 1280): Promise<{ data: string; mime: string }> {
  const img: HTMLImageElement = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = dataUrl;
  });
  const s = Math.min(1, max / Math.max(img.width, img.height, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * s);
  canvas.height = Math.round(img.height * s);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { data: dataUrl.split(',')[1] ?? '', mime: dataUrl.slice(5, dataUrl.indexOf(';')) || 'image/png' };
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '', mime: 'image/jpeg' };
}
