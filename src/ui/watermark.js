/**
 * Illux Mosaik — protection for the on-screen mosaic.
 * - drawWatermark: the ILLUX logo (config.watermark.image), light, repeated and diagonal, over a
 *   canvas, so a screenshot of the preview is no use as a print. Until the logo has loaded (or if it
 *   cannot load) the text config.watermark.text is drawn instead, so the mosaic is never unmarked.
 * - lockImages: no "Save image as", no dragging and no long-press menu on the app's canvases.
 * This stops visitors without developer knowledge; it cannot stop someone using developer tools.
 * The print file itself is never shown on the page.
 */

let stamp = null;   // the logo with a soft dark edge, ready to draw (a canvas)
let loading = null;

/** Load the logo once; resolves true when it can be drawn. */
export function loadWatermark(options) {
  if (loading) return loading;
  if (!options || !options.image) return (loading = Promise.resolve(false));
  loading = new Promise(resolve => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      // Bake a soft dark shadow around the white logo so it shows on light and dark parts alike.
      const pad = Math.round(image.naturalHeight * 0.25);
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth + pad * 2; canvas.height = image.naturalHeight + pad * 2;
      const ctx = canvas.getContext('2d');
      ctx.shadowColor = 'rgba(0, 0, 0, .85)';
      ctx.shadowBlur = Math.max(2, image.naturalHeight * 0.08);
      ctx.drawImage(image, pad, pad);
      stamp = { canvas, pad, logoWidth: image.naturalWidth, logoHeight: image.naturalHeight };
      resolve(true);
    };
    image.onerror = () => resolve(false);
    image.src = options.image;
  });
  return loading;
}

/** Draw the watermark over the whole canvas (call after the picture is drawn). */
export function drawWatermark(ctx, width, height, options) {
  if (!options || width < 2 || height < 2) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = options.opacity ?? 0.3;
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 6);
  const reach = Math.hypot(width, height) / 2;
  if (stamp) drawLogos(ctx, width, height, reach);
  else if (options.text) drawText(ctx, width, height, reach, options.text);
  ctx.restore();
}

function drawLogos(ctx, width, height, reach) {
  const logoWidth = Math.max(60, Math.min(width, height) / 2.6);
  const scale = logoWidth / stamp.logoWidth, logoHeight = stamp.logoHeight * scale;
  const drawW = stamp.canvas.width * scale, drawH = stamp.canvas.height * scale;
  const stepX = logoWidth * 1.6, stepY = logoHeight * 3.6;
  reach += logoWidth;
  let row = 0;
  for (let y = -reach; y <= reach; y += stepY, row++) {
    const shift = row % 2 ? stepX / 2 : 0;
    for (let x = -reach - shift; x <= reach; x += stepX) ctx.drawImage(stamp.canvas, x - drawW / 2, y - drawH / 2, drawW, drawH);
  }
}

function drawText(ctx, width, height, reach, text) {
  const size = Math.max(11, Math.round(Math.min(width, height) / 9));
  ctx.font = '700 ' + size + 'px "Open Sans", Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, size / 14);
  ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
  const stepX = ctx.measureText(text).width + size * 2.2, stepY = size * 3.4;
  reach += size * 4;
  let row = 0;
  for (let y = -reach; y <= reach; y += stepY, row++) {
    const shift = row % 2 ? stepX / 2 : 0;
    for (let x = -reach - shift; x <= reach; x += stepX) { ctx.strokeText(text, x, y); ctx.fillText(text, x, y); }
  }
}

/** Block the context menu and dragging on every canvas inside root. */
export function lockImages(root) {
  const onCanvas = event => event.target instanceof HTMLCanvasElement;
  root.addEventListener('contextmenu', event => { if (onCanvas(event)) event.preventDefault(); });
  root.addEventListener('dragstart', event => { if (onCanvas(event)) event.preventDefault(); });
}
