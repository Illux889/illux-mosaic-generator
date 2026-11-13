/**
 * Illux Mosaik — the main motif ("hovedmotiv").
 * Port of the admin tool's target handling (rebuildTarget / getTargetTiles /
 * targetFit). Differences: the grid is no longer locked to 100 x 140, the
 * overview follows the chosen print format, transparent areas become white
 * (the admin tool painted them dark teal), and the analysis buffer is sent
 * to the worker as one transferable pixel array.
 */
import { decodeImage, sniffType, ImportError } from './sources.js';

/** Load the customer's main image into a working canvas (longest side <= workingMaxPx). */
export async function loadTarget(file, config) {
  if (file.size > config.maxFileBytes) throw new ImportError('too-large');
  const type = await sniffType(file);
  if (type === 'image/heic') throw new ImportError('heic');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new ImportError('unsupported');
  const image = await decodeImage(file);
  try {
    const width = image.naturalWidth, height = image.naturalHeight;
    if (width * height > config.maxMegapixels * 1e6) throw new ImportError('too-many-megapixels');
    if (Math.min(width, height) < config.minSidePx) throw new ImportError('target-too-small');
    const scale = Math.min(1, config.workingMaxPx / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); // transparency -> white
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, name: file.name || 'Hovedmotiv', width, height };
  } finally { image.src = ''; }
}

const canvasFilterSupported = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

/** Soft, blurred copy of the image stretched over the whole area (the "extended background"). */
function drawBlurredExtension(ctx, source, width, height) {
  const iw = source.width, ih = source.height, targetAspect = width / height, sourceAspect = iw / ih;
  let sx = 0, sy = 0, sw = iw, sh = ih;
  if (sourceAspect > targetAspect) { sw = ih * targetAspect; sx = (iw - sw) / 2; }
  else { sh = iw / targetAspect; sy = (ih - sh) / 2; }
  // Same visual radius as the original (100 px on a 1600 px wide overview).
  const radius = Math.max(8, Math.round(100 * Math.max(width, height) / 2240));
  // Wide bleed + average colour underneath, so the blur never fades to white at the edges
  // when the motif's aspect ratio differs a lot from the print format.
  const bleed = Math.round(radius * 3);
  const average = document.createElement('canvas'); average.width = average.height = 16;
  const actx = average.getContext('2d', { willReadFrequently: true });
  actx.imageSmoothingEnabled = true; actx.imageSmoothingQuality = 'high';
  actx.drawImage(source, 0, 0, 16, 16);
  const px = actx.getImageData(0, 0, 16, 16).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
  r = Math.round(r / 256); g = Math.round(g / 256); b = Math.round(b / 256);
  ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')'; ctx.fillRect(0, 0, width, height);
  if (canvasFilterSupported) {
    ctx.filter = 'blur(' + radius + 'px)';
    ctx.drawImage(source, sx, sy, sw, sh, -bleed, -bleed, width + bleed * 2, height + bleed * 2);
    ctx.filter = 'none';
    return;
  }
  // Fallback for browsers without canvas filters (older Safari): down- and upscale.
  const small = document.createElement('canvas');
  small.width = Math.max(2, Math.round(width / radius * 2)); small.height = Math.max(2, Math.round(height / radius * 2));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(source, sx, sy, sw, sh, 0, 0, small.width, small.height);
  ctx.drawImage(small, 0, 0, width, height);
  small.width = small.height = 0;
}

/**
 * Prepare the target at grid resolution: (grid.width * tilePx) x (grid.height * tilePx).
 * fit 'contain': the whole image, margins filled with a blurred extension of itself.
 * fit 'cover':   fills the format, cropping the overflow (centred).
 */
export function buildTargetCanvas(target, grid, tilePx, fit) {
  const width = grid.width * tilePx, height = grid.height * tilePx;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  const source = target.canvas, iw = source.width, ih = source.height;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (fit === 'cover') {
    const targetAspect = width / height, sourceAspect = iw / ih;
    let sx = 0, sy = 0, sw = iw, sh = ih;
    if (sourceAspect > targetAspect) { sw = ih * targetAspect; sx = (iw - sw) / 2; }
    else { sh = iw / targetAspect; sy = (ih - sh) / 2; }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
  } else {
    drawBlurredExtension(ctx, source, width, height);
    const scale = Math.min(width / iw, height / ih), w = iw * scale, h = ih * scale;
    ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
  }
  return canvas;
}

/** Pixel buffer for the mosaic worker (transferable). */
export function targetPixels(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return { width: canvas.width, height: canvas.height, pixels: new Uint8ClampedArray(data.buffer) };
}
