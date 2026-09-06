/** Генерация обложки пака на канвасе: коллаж из превью + надпись «8 SFW + 23 NSFW images». */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось загрузить превью"));
    img.src = src;
  });
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

export async function renderCover(opts: {
  urls: string[];
  caption: string;
  title?: string;
  width?: number;
  height?: number;
}): Promise<Blob> {
  const width = opts.width ?? 1600;
  const height = opts.height ?? 2048;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Канвас недоступен");

  ctx.fillStyle = "#0b0b10";
  ctx.fillRect(0, 0, width, height);

  const images = await Promise.all(opts.urls.slice(0, 4).map(loadImage));
  const gap = 12;
  if (images.length === 1) {
    drawCover(ctx, images[0], 0, 0, width, height);
  } else if (images.length === 2) {
    const h = (height - gap) / 2;
    images.forEach((im, i) => drawCover(ctx, im, 0, i * (h + gap), width, h));
  } else if (images.length >= 3) {
    const cols = 2;
    const rows = 2;
    const w = (width - gap) / cols;
    const h = (height - gap) / rows;
    images.slice(0, 4).forEach((im, i) => {
      const cx = (i % cols) * (w + gap);
      const cy = Math.floor(i / cols) * (h + gap);
      drawCover(ctx, im, cx, cy, w, h);
    });
  }

  // затемнение снизу под текст
  const grad = ctx.createLinearGradient(0, height * 0.55, 0, height);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.88)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, height * 0.55, width, height * 0.45);

  ctx.textAlign = "center";
  if (opts.title) {
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = `600 ${Math.round(width * 0.05)}px system-ui, sans-serif`;
    ctx.fillText(opts.title, width / 2, height - Math.round(width * 0.19));
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${Math.round(width * 0.085)}px system-ui, sans-serif`;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18;
  ctx.fillText(opts.caption, width / 2, height - Math.round(width * 0.07));

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Не удалось сохранить обложку"))), "image/png"),
  );
}
