/*
 * Illux Mosaik — code shared by the detail and print workers.
 * Loaded with importScripts() (classic worker script, no modules), so it
 * attaches one namespace to the worker global: self.IlxShared.
 *
 * Ported unchanged in maths from the original admin tool's photoDetailWorker /
 * photoPrintWorker (rgbFromLab, gammaByte, correctPixels, sourcePixels).
 */
(function (root) {
  'use strict';

  /** Tone profile layout: 256-entry lightness curve + 7 colour parameters. */
  const STRIDE = 263;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const linear = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    linear[i] = c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  }

  function rgbFromLab(L, a, b) {
    const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
    const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
    const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
      -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
  }

  function gammaByte(value) {
    const v = clamp(value, 0, 1);
    return Math.round(255 * (v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055));
  }

  /**
   * Apply one cell's tone profile to a full-resolution source tile.
   * raw === true (or a zero-strength profile) returns the untouched pixels.
   */
  function correctPixels(source, cell, profiles, raw) {
    const p = cell * STRIDE;
    if (raw || profiles[p + 262] <= 0) return new Uint8ClampedArray(source);
    const result = new Uint8ClampedArray(source.length);
    const sourceA = profiles[p + 256], sourceB = profiles[p + 257];
    const desiredA = profiles[p + 258], desiredB = profiles[p + 259];
    const chroma = profiles[p + 260], blend = profiles[p + 261];
    for (let i = 0; i < source.length; i += 4) {
      const r = linear[source[i]], g = linear[source[i + 1]], b = linear[source[i + 2]];
      const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
      const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
      const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
      const originalL = .2104542553 * l + .793617785 * m - .0040720468 * s;
      const originalA = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s;
      const originalB = .0259040371 * l + .7827717662 * m - .808675766 * s;
      const pos = clamp(originalL * 255, 0, 255), lo = Math.floor(pos), hi = Math.min(255, lo + 1);
      const mapped = profiles[p + lo] + (profiles[p + hi] - profiles[p + lo]) * (pos - lo);
      const L = originalL + (mapped - originalL) * blend;
      const a = desiredA + chroma * (originalA - sourceA), bb = desiredB + chroma * (originalB - sourceB);
      let rgb = rgbFromLab(L, a, bb);
      if (rgb.some(c => c < 0 || c > 1)) {
        // Compress chroma toward the same lightness instead of clipping.
        let lower = 0, upper = 1;
        for (let k = 0; k < 7; k++) {
          const mid = (lower + upper) / 2, candidate = rgbFromLab(L, a * mid, bb * mid);
          if (candidate.some(c => c < 0 || c > 1)) upper = mid; else lower = mid;
        }
        rgb = rgbFromLab(L, a * lower, bb * lower);
      }
      result[i] = gammaByte(rgb[0]); result[i + 1] = gammaByte(rgb[1]); result[i + 2] = gammaByte(rgb[2]); result[i + 3] = 255;
    }
    return result;
  }

  /**
   * Decode a blob at (about) the requested size. Uses the resize options of
   * createImageBitmap where the browser supports them, otherwise decodes at
   * full size and lets the canvas scale (older Safari ignores resize options).
   */
  async function decodeScaled(blob, width, height) {
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    try {
      return await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    } catch (_) {
      return await createImageBitmap(blob);
    }
  }

  /**
   * LRU cache of square, contained source tiles. A photo is never cropped,
   * stretched or rotated: it is fitted proportionally inside the square and
   * the rest is filled with that photo's matte (its own background colour).
   */
  function createSourceCache(budgetBytes) {
    const cache = new Map();
    let bytes = 0;
    return {
      clear() { cache.clear(); bytes = 0; },
      async get(sources, index, size) {
        const key = index + ':' + size;
        if (cache.has(key)) {
          const value = cache.get(key); cache.delete(key); cache.set(key, value); return value;
        }
        const src = sources[index];
        if (!src || !src.blob) throw Error('source-missing');
        const scale = Math.min(size / src.width, size / src.height);
        const dw = src.width * scale, dh = src.height * scale;
        const bitmap = await decodeScaled(src.blob, dw, dh);
        const canvas = new OffscreenCanvas(size, size);
        const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
        ctx.fillStyle = 'rgb(' + src.matte.join(',') + ')'; ctx.fillRect(0, 0, size, size);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, (size - dw) / 2, (size - dh) / 2, dw, dh);
        bitmap.close();
        const rgba = ctx.getImageData(0, 0, size, size).data;
        cache.set(key, rgba); bytes += rgba.byteLength;
        while (bytes > budgetBytes && cache.size > 1) {
          const first = cache.keys().next().value;
          bytes -= cache.get(first).byteLength; cache.delete(first);
        }
        return rgba;
      }
    };
  }

  root.IlxShared = { STRIDE, clamp, linear, rgbFromLab, gammaByte, correctPixels, decodeScaled, createSourceCache };
})(self);
