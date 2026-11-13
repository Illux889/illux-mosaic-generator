/*
 * Illux Mosaik — print worker (classic worker script).
 * Port of photoPrintWorker: builds the full-resolution print JPEG from the
 * customer's source photos and the per-cell tone profiles, then stamps the
 * DPI into the JFIF header.
 *
 * Two output paths:
 * - "canvas": paint everything into one OffscreenCanvas, encode natively.
 *   Fast, but needs width * height * 4 bytes in one block and is capped by
 *   the browser's canvas limits.
 * - "stream": paint one row of mosaic tiles at a time and feed it to the
 *   streaming JPEG encoder. Memory stays small, so it also works on iPhone.
 * The main thread picks the path; if the canvas cannot be allocated the
 * worker falls back to streaming by itself.
 *
 * In:  { type: 'render', gridWidth, gridHeight, printWidth, printHeight, dpi, quality,
 *        mode: 'canvas' | 'stream', assignments, profiles, sources: [{ blob, width, height, matte }] }
 * Out: { type: 'progress', value, done, total } | { type: 'complete', blob, width, height, mode }
 *      | { type: 'error', code }
 */
'use strict';
importScripts('./worker-shared.js', './jpeg-encoder.js');
const { correctPixels, createSourceCache } = self.IlxShared;

const cache = createSourceCache(96 * 1024 * 1024);
const yieldNow = () => new Promise(resolve => setTimeout(resolve, 0));

function cellRect(cell, W, H, width, height) {
  const col = cell % W, row = Math.floor(cell / W);
  const x0 = Math.round(col * width / W), x1 = Math.round((col + 1) * width / W);
  const y0 = Math.round(row * height / H), y1 = Math.round((row + 1) * height / H);
  return { x0, x1, y0, y1 };
}

/** Paint one tile (contained photo + its tone profile) into ctx at the given offset. */
function makePainter() {
  let tileCanvas = null, tileContext = null, tileSize = 0;
  return async function paint(ctx, data, cell, rect, offsetY) {
    const index = data.assignments[cell];
    if (index < 0) return;
    const size = Math.max(rect.x1 - rect.x0, rect.y1 - rect.y0);
    const raw = await cache.get(data.sources, index, size);
    const corrected = correctPixels(raw, cell, data.profiles, false);
    if (!tileCanvas || tileSize !== size) {
      tileSize = size; tileCanvas = new OffscreenCanvas(size, size); tileContext = tileCanvas.getContext('2d', { alpha: false });
    }
    tileContext.putImageData(new ImageData(corrected, size, size), 0, 0);
    ctx.drawImage(tileCanvas, 0, 0, size, size, rect.x0, rect.y0 - offsetY, rect.x1 - rect.x0, rect.y1 - rect.y0);
  };
}

async function renderCanvas(data, report) {
  const W = data.gridWidth, H = data.gridHeight, width = data.printWidth, height = data.printHeight;
  let canvas, ctx;
  try {
    canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext('2d', { alpha: false });
  } catch (_) { ctx = null; }
  if (!ctx) return null; // caller falls back to streaming
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const paint = makePainter(), total = W * H;
  for (let cell = 0; cell < total; cell++) {
    await paint(ctx, data, cell, cellRect(cell, W, H, width, height), 0);
    if ((cell + 1) % 80 === 0 || cell + 1 === total) report(cell + 1, total, 90);
    if (cell % 160 === 0) await yieldNow();
  }
  self.postMessage({ type: 'progress', value: 93, phase: 'encode' });
  let blob;
  try { blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: data.quality }); } catch (_) { blob = null; }
  canvas.width = canvas.height = 1; // release the big backing store before any fallback
  if (!blob || !blob.size) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  self.IlxJpeg.patchJpegDpi(bytes, data.dpi);
  return new Blob([bytes], { type: 'image/jpeg' });
}

async function renderStream(data, report) {
  const W = data.gridWidth, H = data.gridHeight, width = data.printWidth, height = data.printHeight;
  const encoder = self.IlxJpeg.createEncoder({ width, height, quality: Math.round(data.quality * 100), dpi: data.dpi });
  const paint = makePainter(), total = W * H;
  let rowCanvas = null, rowContext = null, rowCanvasHeight = 0, done = 0;
  for (let row = 0; row < H; row++) {
    const y0 = Math.round(row * height / H), y1 = Math.round((row + 1) * height / H), rowHeight = y1 - y0;
    if (!rowCanvas || rowCanvasHeight !== rowHeight) {
      rowCanvas = new OffscreenCanvas(width, rowHeight); rowCanvasHeight = rowHeight;
      rowContext = rowCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
      rowContext.imageSmoothingEnabled = true; rowContext.imageSmoothingQuality = 'high';
    }
    rowContext.fillStyle = '#fff'; rowContext.fillRect(0, 0, width, rowHeight);
    for (let col = 0; col < W; col++) {
      const cell = row * W + col;
      await paint(rowContext, data, cell, cellRect(cell, W, H, width, height), y0);
      done++;
      if (done % 80 === 0 || done === total) report(done, total, 97);
    }
    encoder.writeRows(rowContext.getImageData(0, 0, width, rowHeight).data, rowHeight);
    await yieldNow();
  }
  return new Blob(encoder.finish(), { type: 'image/jpeg' });
}

self.onmessage = async event => {
  const data = event.data;
  if (!data || data.type !== 'render') return;
  try {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') throw Error('print-unsupported');
    const W = data.gridWidth, H = data.gridHeight;
    if (!data.assignments || data.assignments.length !== W * H) throw Error('print-grid-mismatch');
    const report = (done, total, span) => self.postMessage({ type: 'progress', value: Math.round(done / Math.max(1, total) * span), done, total });
    let blob = null, mode = data.mode === 'stream' ? 'stream' : 'canvas';
    if (mode === 'canvas') blob = await renderCanvas(data, report);
    if (!blob) { mode = 'stream'; cache.clear(); blob = await renderStream(data, report); }
    self.postMessage({ type: 'complete', blob, width: data.printWidth, height: data.printHeight, mode });
  } catch (error) {
    const known = ['print-unsupported', 'print-grid-mismatch', 'source-missing', 'jpeg-size'];
    self.postMessage({ type: 'error', code: known.includes(error.message) ? error.message : 'print-failed', detail: String(error && error.message || error) });
  }
};
