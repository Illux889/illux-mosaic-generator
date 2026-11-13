/**
 * Illux Mosaik — makes the before/after example images for version 2 with the real engine.
 * Local tool, never part of the published pages. Run it in a browser on the local server
 * (npm start), from the console of any page on http://localhost:8080:
 *
 *   const m = await import('/tools/make-examples.js');
 *   const out = await m.makeExample({ motif: '/eksempler/kilder/hund.jpg', tiles: [...urls] });
 *   // out.foer / out.efter / out.detalje are base64 JPEGs (square), ready to save as files.
 *
 * region: [x, y, w, h] uses only part of the motif image (e.g. the "before" half of a draft image).
 * Everything is square: the motif is cropped to a square (focusX/focusY move the crop, zoom < 1 crops tighter),
 * and the mosaic is printed as a square (default 100 × 100 cm at 150 DPI), then scaled down.
 * The detail is a crop of that print, so it shows the real tiles exactly as in a print file.
 */
import { CONFIG } from '../src/config.js';
import { MosaicEngine } from '../src/engine/mosaic-engine.js';
import { importSources } from '../src/engine/sources.js';
import { loadTarget } from '../src/engine/target.js';
import { gridFor, printSpec } from '../src/engine/grid.js';

const loadImage = url => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img); img.onerror = () => reject(new Error('could not load ' + url));
  img.src = url;
});
const toBlob = (canvas, quality) => new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
const toBase64 = blob => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
function canvas(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }

/** Square crop of an image (any aspect) into a size × size canvas. */
function squareCrop(img, size, focusX = .5, focusY = .5, zoom = 1) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, side = Math.min(w, h) * zoom;
  const sx = Math.max(0, Math.min(w - side, w * focusX - side / 2));
  const sy = Math.max(0, Math.min(h - side, h * focusY - side / 2));
  const c = canvas(size), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return c;
}

export async function makeExample({
  motif, region, tiles, focusX = .5, focusY = .5, zoom = 1, cm = 100, longSide = 100,
  outPx = 800, detail = { x: .5, y: .5, tiles: 7 }, detailPx = 400, params, repetition = 'even'
}) {
  // 1. The square main image ("før").
  let motifImg = await loadImage(motif);
  if (region) { // [x, y, width, height]: use only this part of the image (e.g. the "before" half of a draft)
    const [rx, ry, rw, rh] = region, part = document.createElement('canvas');
    part.width = rw; part.height = rh;
    part.getContext('2d').drawImage(motifImg, rx, ry, rw, rh, 0, 0, rw, rh);
    motifImg = part;
  }
  const before = squareCrop(motifImg, 1400, focusX, focusY, zoom);
  const motifFile = new File([await toBlob(before, .92)], 'motiv.jpg', { type: 'image/jpeg' });
  const target = await loadTarget(motifFile, CONFIG.target);

  // 2. The small photos.
  const files = await Promise.all(tiles.map(async (url, i) => {
    const blob = await (await fetch(url)).blob();
    return new File([blob], 'foto-' + i + '.jpg', { type: blob.type || 'image/jpeg' });
  }));
  const imported = await importSources(files, { config: CONFIG.sources });
  const sources = imported.assets;

  // 3. The mosaic, rendered and printed square with the real engine.
  const engine = new MosaicEngine(CONFIG);
  const grid = gridFor(cm, cm, longSide);
  const tone = params || { strength: CONFIG.tone.logoStrength / 100, detail: CONFIG.tone.photoDetail / 100, originalColour: CONFIG.tone.toneVariation / 100 };
  const result = await engine.render({ target, sources, grid, fit: 'contain', params: tone, repetition });
  const spec = printSpec(cm, cm, CONFIG.print.dpiRule);
  const printed = await engine.print(result, spec);
  const bitmap = await createImageBitmap(printed.blob);

  // 4. Outputs: before, after (scaled down) and a detail crop of the print.
  const after = canvas(outPx), ga = after.getContext('2d');
  ga.imageSmoothingQuality = 'high';
  ga.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, outPx, outPx);
  // The detail starts on a tile edge, so it shows whole photos.
  const tilePx = bitmap.width / grid.width, side = Math.round(tilePx * detail.tiles);
  const startTile = (pos, cells) => Math.max(0, Math.min(cells - detail.tiles, Math.round(pos * cells - detail.tiles / 2)));
  const dx = Math.round(startTile(detail.x, grid.width) * tilePx);
  const dy = Math.round(startTile(detail.y, grid.height) * tilePx);
  const det = canvas(detailPx), gd = det.getContext('2d');
  gd.imageSmoothingQuality = 'high';
  gd.drawImage(bitmap, dx, dy, side, side, 0, 0, detailPx, detailPx);
  bitmap.close();

  return {
    foer: await toBase64(await toBlob(squareCrop(motifImg, outPx, focusX, focusY, zoom), .82)),
    efter: await toBase64(await toBlob(after, .82)),
    detalje: await toBase64(await toBlob(det, .85)),
    info: { grid: [grid.width, grid.height], photos: sources.length, print: [printed.width, printed.height], tilePx: Math.round(tilePx), detailTiles: detail.tiles }
  };
}
