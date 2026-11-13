/**
 * Illux Mosaik — importing the customer's photos (main thread).
 *
 * Ported from the admin tool's decodeImage, containRect, drawContained,
 * detectSourceBackground, containedSourceSamples and prepareAsset. A photo is
 * never cropped, stretched, mirrored or rotated: it is fitted proportionally
 * into its square tile and the rest is filled with the photo's own detected
 * background colour ("matte").
 *
 * New compared with the admin tool:
 * - EXIF orientation: photos are decoded through <img>, which applies EXIF
 *   orientation in all current browsers, and re-encoded upright, so the
 *   workers never see an EXIF tag.
 * - Only a downscaled copy is kept (CONFIG.sources.storeMaxPx), never the
 *   original file, so hundreds of photos fit in memory.
 * - File type sniffing (HEIC, GIF, ... get a clear message), size limits,
 *   too-small images and duplicates.
 */

export const TILE_SAMPLE_PX = 40;

export class ImportError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}

/** Detect the real image type from the first bytes (file.type can lie or be empty). */
export async function sniffType(blob) {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = (from, to) => String.fromCharCode(...head.slice(from, to));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return 'image/heic';
    if (/^(avif|avis)$/.test(brand)) return 'image/avif';
  }
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  return 'unknown';
}

/** Decode a blob through <img> (applies EXIF orientation). */
export function decodeImage(blob, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob), image = new Image();
    const timer = setTimeout(() => { cleanup(); image.src = ''; reject(new ImportError('decode-timeout')); }, timeout);
    function cleanup() { clearTimeout(timer); image.onload = image.onerror = null; URL.revokeObjectURL(url); }
    image.onload = () => {
      cleanup();
      if (!image.naturalWidth || !image.naturalHeight) reject(new ImportError('decode-failed'));
      else resolve(image);
    };
    image.onerror = () => { cleanup(); reject(new ImportError('decode-failed')); };
    image.decoding = 'async';
    image.src = url;
  });
}

/** Proportional fit of iw x ih inside width x height. */
export function containRect(iw, ih, width, height) {
  if (!(iw > 0 && ih > 0 && width > 0 && height > 0)) throw new ImportError('bad-dimensions');
  const scale = Math.min(width / iw, height / ih), w = iw * scale, h = ih * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

export function drawContained(ctx, image, x, y, width, height, matte = [255, 255, 255]) {
  const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
  const rect = containRect(iw, ih, width, height);
  ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgb(' + matte.join(',') + ')'; ctx.fillRect(x, y, width, height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, x + rect.x, y + rect.y, rect.width, rect.height);
  ctx.restore();
  return rect;
}

/**
 * Find the photo's own background colour from native-resolution edge strips.
 * Picks the dominant colour population (never the mean of unrelated colours).
 * Transparent edges (>20%) fall back to white.
 */
export function detectSourceBackground(image) {
  const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
  const sample = document.createElement('canvas');
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  const points = []; let totalWeight = 0, transparentWeight = 0;
  const wide = iw > ih * 1.05, tall = ih > iw * 1.05;
  function read(sx, sy, sw, sh, dw, dh, weight) {
    sample.width = dw; sample.height = dh;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, dw, dh);
    const pixels = ctx.getImageData(0, 0, dw, dh).data;
    for (let p = 0; p < pixels.length; p += 4) {
      totalWeight += weight;
      if (pixels[p + 3] < 245) { transparentWeight += weight; continue; }
      points.push({ rgb: [pixels[p], pixels[p + 1], pixels[p + 2]], w: weight });
    }
  }
  const rows = Array.from(new Set([0, Math.min(1, ih - 1), Math.min(3, ih - 1)]));
  const cols = Array.from(new Set([0, Math.min(1, iw - 1), Math.min(3, iw - 1)]));
  for (let n = 0; n < rows.length; n++) {
    const depth = rows[n], weight = (wide ? 3 : 1) * (n === 0 ? 2 : 1);
    read(0, depth, iw, 1, Math.min(768, iw), 1, weight);
    if (ih - 1 - depth !== depth) read(0, ih - 1 - depth, iw, 1, Math.min(768, iw), 1, weight);
  }
  for (let n = 0; n < cols.length; n++) {
    const depth = cols[n], weight = (tall ? 3 : 1) * (n === 0 ? 2 : 1);
    read(depth, 0, 1, ih, 1, Math.min(768, ih), weight);
    if (iw - 1 - depth !== depth) read(iw - 1 - depth, 0, 1, ih, 1, Math.min(768, ih), weight);
  }
  const cw = Math.max(1, Math.min(12, Math.round(iw * .012))), ch = Math.max(1, Math.min(12, Math.round(ih * .012)));
  for (const x of [0, iw - cw]) for (const y of [0, ih - ch]) read(x, y, cw, ch, cw, ch, 3);
  sample.width = sample.height = 0;
  if (!points.length || transparentWeight / Math.max(1, totalWeight) > .20) {
    return { rgb: [255, 255, 255], confidence: 0, reason: 'transparent' };
  }
  const bins = new Map(); let opaqueWeight = 0;
  for (const point of points) {
    const [r, g, b] = point.rgb, key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    if (!bins.has(key)) bins.set(key, { w: 0, sum: [0, 0, 0] });
    const bin = bins.get(key); bin.w += point.w; opaqueWeight += point.w;
    for (let c = 0; c < 3; c++) bin.sum[c] += point.rgb[c] * point.w;
  }
  const candidates = [...bins.values()].sort((a, b) => b.w - a.w).slice(0, 12);
  let best = null, bestWeight = -1;
  for (const bin of candidates) {
    const centre = bin.sum.map(v => v / bin.w), members = []; let weight = 0;
    for (const point of points) {
      // Allow minor JPEG noise, but never combine white and black.
      if (Math.max(...point.rgb.map((v, c) => Math.abs(v - centre[c]))) <= 18) { members.push(point); weight += point.w; }
    }
    if (weight > bestWeight) { best = members; bestWeight = weight; }
  }
  const rgb = [0, 1, 2].map(c => {
    const ordered = best.slice().sort((a, b) => a.rgb[c] - b.rgb[c]); let weight = 0;
    for (const point of ordered) { weight += point.w; if (weight >= bestWeight / 2) return point.rgb[c]; }
    return ordered[ordered.length - 1].rgb[c];
  });
  const confidence = bestWeight / Math.max(1, opaqueWeight);
  return { rgb, confidence, reason: confidence >= .70 ? 'solid' : 'mixed' };
}

/** The 40 px contained sample the matcher works with, plus a thumbnail blob URL. */
export async function containedSamples(image, matte, thumbPx) {
  const scratch = document.createElement('canvas'); scratch.width = scratch.height = TILE_SAMPLE_PX;
  const ctx = scratch.getContext('2d', { alpha: false, willReadFrequently: true });
  drawContained(ctx, image, 0, 0, TILE_SAMPLE_PX, TILE_SAMPLE_PX, matte);
  const rgba = new Uint8ClampedArray(ctx.getImageData(0, 0, TILE_SAMPLE_PX, TILE_SAMPLE_PX).data);
  const thumb = document.createElement('canvas'); thumb.width = thumb.height = thumbPx;
  drawContained(thumb.getContext('2d', { alpha: false }), image, 0, 0, thumbPx, thumbPx, matte);
  const thumbBlob = await canvasBlob(thumb, 'image/jpeg', .85);
  scratch.width = scratch.height = thumb.width = thumb.height = 0;
  return { rgba, thumbUrl: URL.createObjectURL(thumbBlob) };
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new ImportError('encode-failed')), type, quality));
}

/** FNV-1a over a coarsened 40 px sample + aspect ratio: catches the same photo picked twice. */
function contentHash(rgba, width, height) {
  let h = 2166136261;
  const mix = v => { h ^= v; h = Math.imul(h, 16777619); };
  for (let i = 0; i < rgba.length; i += 4) { mix(rgba[i] >> 2); mix(rgba[i + 1] >> 2); mix(rgba[i + 2] >> 2); }
  mix(Math.round(width / height * 1000) & 0xffff);
  return (h >>> 0).toString(36);
}

/** Downscaled, upright copy of the photo. PNG when it has transparency, JPEG otherwise. */
async function storedCopy(image, type, config) {
  const iw = image.naturalWidth, ih = image.naturalHeight;
  const scale = Math.min(1, config.storeMaxPx / Math.max(iw, ih));
  const width = Math.max(1, Math.round(iw * scale)), height = Math.max(1, Math.round(ih * scale));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: type !== 'image/jpeg' });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  let transparent = false;
  if (type !== 'image/jpeg') {
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { transparent = true; break; }
  }
  const blob = transparent ? await canvasBlob(canvas, 'image/png') : await canvasBlob(canvas, 'image/jpeg', config.storeJpegQuality);
  canvas.width = canvas.height = 0;
  return { blob, width, height };
}

let serial = 0;

/** Turn one file into a source asset, or throw an ImportError with a code. */
export async function prepareSource(file, config) {
  if (file.size > config.maxFileBytes) throw new ImportError('too-large');
  const type = await sniffType(file);
  if (type === 'image/heic') throw new ImportError('heic');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new ImportError('unsupported');
  const image = await decodeImage(file);
  try {
    const width = image.naturalWidth, height = image.naturalHeight;
    if (width * height > config.maxMegapixels * 1e6) throw new ImportError('too-many-megapixels');
    if (Math.min(width, height) < config.minSidePx) throw new ImportError('too-small');
    const background = detectSourceBackground(image);
    const matte = background.rgb.slice();
    const samples = await containedSamples(image, matte, config.thumbPx);
    const stored = await storedCopy(image, type, config);
    return {
      id: 'src-' + (++serial),
      name: file.name || 'Foto ' + serial,
      blob: stored.blob, width: stored.width, height: stored.height,
      originalWidth: width, originalHeight: height,
      matte, background: { ...background, mode: 'auto' },
      rgba: samples.rgba, thumbUrl: samples.thumbUrl,
      hash: contentHash(samples.rgba, width, height)
    };
  } finally { image.src = ''; }
}

/** Free the object URL held by an asset. */
export function releaseSource(asset) {
  if (asset?.thumbUrl) URL.revokeObjectURL(asset.thumbUrl);
}

/**
 * Import many files with limited parallelism.
 * `knownHashes` (Set) lets duplicates of already-imported photos be skipped.
 * Returns { assets, rejected: [{ name, code }], duplicates: [name] }.
 */
export async function importSources(files, { config, signal, onProgress, knownHashes = new Set(), lowMemory = false }) {
  const list = Array.from(files), assets = new Array(list.length), rejected = [], duplicates = [];
  const seenFiles = new Set(), hashes = new Set(knownHashes);
  let cursor = 0, done = 0;
  async function worker() {
    while (cursor < list.length) {
      if (signal?.aborted) return;
      const index = cursor++, file = list[index];
      const fileKey = file.name + ':' + file.size + ':' + file.lastModified;
      try {
        if (seenFiles.has(fileKey)) { duplicates.push(file.name); continue; }
        seenFiles.add(fileKey);
        const asset = await prepareSource(file, config);
        if (signal?.aborted) { releaseSource(asset); return; }
        if (hashes.has(asset.hash)) { duplicates.push(file.name); releaseSource(asset); continue; }
        hashes.add(asset.hash);
        assets[index] = asset;
      } catch (error) {
        rejected.push({ name: file.name, code: error instanceof ImportError ? error.code : 'decode-failed' });
      } finally {
        done++;
        onProgress?.(done, list.length);
      }
    }
  }
  const parallel = Math.max(1, Math.min(list.length, lowMemory ? config.concurrencyLowMemory : config.concurrency));
  await Promise.all(Array.from({ length: parallel }, worker));
  if (signal?.aborted) {
    for (const asset of assets) releaseSource(asset);
    return { assets: [], rejected: [], duplicates: [], aborted: true };
  }
  return { assets: assets.filter(Boolean), rejected, duplicates, aborted: false };
}

/**
 * Change the fill colour behind one photo (tile inspector). Rebuilds the 40 px
 * sample and thumbnail from the stored copy; the photo itself is unchanged.
 */
export async function setSourceFill(asset, mode, hex, config) {
  if (!['auto', 'white', 'black', 'custom'].includes(mode)) throw new ImportError('bad-fill');
  let matte;
  if (mode === 'auto') matte = asset.background.rgb.slice();
  else if (mode === 'white') matte = [255, 255, 255];
  else if (mode === 'black') matte = [0, 0, 0];
  else {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new ImportError('bad-fill');
    matte = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  }
  const image = await decodeImage(asset.blob);
  try {
    const samples = await containedSamples(image, matte, config.thumbPx);
    releaseSource(asset);
    asset.matte = matte; asset.background.mode = mode;
    asset.rgba = samples.rgba; asset.thumbUrl = samples.thumbUrl;
  } finally { image.src = ''; }
}

export function rgbToHex(rgb) {
  return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}
