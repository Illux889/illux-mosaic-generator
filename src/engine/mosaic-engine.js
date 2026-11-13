/**
 * Illux Mosaik — engine facade (main thread). The UI talks only to this module.
 * Owns the mosaic and print workers, cancellation, and the result object.
 * Ported from the admin tool's updateMosaic / downloadPrintFile flow.
 */
import { buildTargetCanvas, targetPixels } from './target.js';

const workerUrl = name => new URL('./' + name, import.meta.url);

export class EngineError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}

/** Device hints used to pick safer limits. */
export const device = (() => {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = nav.userAgent || '';
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
  const memory = Number(nav.deviceMemory) || 0; // GB, Chromium only
  return { ios, lowMemory: ios || (memory > 0 && memory <= 4) };
})();

export function engineSupported() {
  return typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined';
}

/** Will the matcher's cost table fit in memory? */
export function fitsInMemory(cells, photos, config) {
  const limit = device.lowMemory ? config.engine.maxCostEntriesLowMemory : config.engine.maxCostEntries;
  return cells * photos <= limit;
}

export class MosaicEngine {
  constructor(config) {
    this.config = config;
    this.renderWorker = null;
    this.printWorker = null;
    this.job = 0;
    this.settle = null;
  }

  /** Stop a running render. The promise of that render resolves with null. */
  cancel() {
    this.job++;
    if (this.renderWorker) { this.renderWorker.terminate(); this.renderWorker = null; }
    if (this.settle) { const settle = this.settle; this.settle = null; settle(null); }
  }

  get busy() { return !!this.renderWorker; }

  /**
   * Build a mosaic.
   * @param {object} input { target, sources, grid, fit, params, repetition }
   * @param {(stage: string, value: number) => void} onProgress
   * @returns {Promise<object|null>} result, or null when cancelled
   */
  render(input, onProgress) {
    this.cancel();
    const job = this.job, config = this.config, tilePx = config.engine.overviewTilePx;
    const { target, sources, grid } = input;
    if (!target) return Promise.reject(new EngineError('no-target'));
    if (sources.length < config.sources.hardMin) return Promise.reject(new EngineError('too-few-sources'));
    if (!engineSupported()) return Promise.reject(new EngineError('unsupported-browser'));
    if (!fitsInMemory(grid.width * grid.height, sources.length, config)) return Promise.reject(new EngineError('too-much-memory'));

    const targetCanvas = buildTargetCanvas(target, grid, tilePx, input.fit);
    const targetData = targetPixels(targetCanvas);
    targetCanvas.width = targetCanvas.height = 0;
    const snapshot = sources.slice();
    const payload = snapshot.map(s => ({ rgba: s.rgba }));

    return new Promise((resolve, reject) => {
      let worker;
      try { worker = this.renderWorker = new Worker(workerUrl('mosaic-worker.js')); }
      catch (error) { reject(new EngineError('worker-blocked', error.message)); return; }
      this.settle = resolve;
      const finish = () => { worker.terminate(); if (this.renderWorker === worker) this.renderWorker = null; this.settle = null; };
      worker.onmessage = event => {
        if (job !== this.job || worker !== this.renderWorker) return;
        const message = event.data;
        if (message.type === 'progress') { onProgress?.(message.stage, message.value); return; }
        if (message.type === 'error') { finish(); reject(new EngineError(message.code, message.message)); return; }
        if (message.type !== 'complete') return;
        finish();
        try { resolve(this.#buildResult(message, snapshot, input)); }
        catch (error) { reject(error instanceof EngineError ? error : new EngineError('engine', error.message)); }
      };
      worker.onerror = event => { finish(); reject(new EngineError('worker-failed', event.message)); };
      worker.postMessage({
        type: 'render', gridWidth: grid.width, gridHeight: grid.height, tileSize: tilePx, outScale: tilePx,
        target: targetData, sources: payload, params: input.params, repetition: input.repetition, seed: config.seed
      }, [targetData.pixels.buffer]);
    });
  }

  #buildResult(message, sources, input) {
    const width = message.renderWidth, height = message.renderHeight;
    if (!(width > 0 && height > 0) || message.pixels.length !== width * height * 4) throw new EngineError('bad-result');
    const toCanvas = pixels => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.getContext('2d', { alpha: false }).putImageData(new ImageData(pixels, width, height), 0, 0);
      return canvas;
    };
    return {
      gridWidth: message.gridWidth, gridHeight: message.gridHeight,
      overviewWidth: width, overviewHeight: height,
      corrected: toCanvas(message.pixels), raw: toCanvas(message.raw),
      assignments: message.assignments, toneProfiles: message.toneProfiles,
      counts: message.counts, diagnostics: message.diagnostics,
      sources, params: input.params, fit: input.fit, repetition: input.repetition,
      created: Date.now()
    };
  }

  cancelPrint() {
    if (this.printWorker) { this.printWorker.terminate(); this.printWorker = null; }
    if (this.printSettle) { const settle = this.printSettle; this.printSettle = null; settle(null); }
  }

  /** Choose canvas (fast) or streaming (low memory) for a print of this size. */
  printMode(spec) {
    const limit = device.ios ? this.config.memory.iosCanvasMaxMegapixels : this.config.memory.printCanvasMaxMegapixels;
    return spec.megapixels <= limit && !device.lowMemory ? 'canvas' : 'stream';
  }

  /**
   * Build the full-resolution print JPEG.
   * @returns {Promise<{blob, width, height, mode}|null>} null when cancelled
   */
  print(result, spec, onProgress) {
    this.cancelPrint();
    if (typeof OffscreenCanvas === 'undefined' || !engineSupported()) return Promise.reject(new EngineError('print-unsupported'));
    return new Promise((resolve, reject) => {
      let worker;
      try { worker = this.printWorker = new Worker(workerUrl('print-worker.js')); }
      catch (error) { reject(new EngineError('worker-blocked', error.message)); return; }
      this.printSettle = resolve;
      const finish = () => { worker.terminate(); if (this.printWorker === worker) this.printWorker = null; this.printSettle = null; };
      worker.onmessage = event => {
        if (worker !== this.printWorker) return;
        const message = event.data;
        if (message.type === 'progress') { onProgress?.(message); return; }
        finish();
        if (message.type === 'error') reject(new EngineError(message.code, message.detail));
        else resolve({ blob: message.blob, width: message.width, height: message.height, mode: message.mode });
      };
      worker.onerror = event => { finish(); reject(new EngineError('print-failed', event.message)); };
      worker.postMessage({
        type: 'render', gridWidth: result.gridWidth, gridHeight: result.gridHeight,
        printWidth: spec.width, printHeight: spec.height, dpi: spec.dpi, quality: this.config.print.jpegQuality,
        mode: this.printMode(spec), assignments: Array.from(result.assignments), profiles: result.toneProfiles,
        sources: result.sources.map(s => ({ blob: s.blob, width: s.width, height: s.height, matte: s.matte.slice() }))
      });
    });
  }
}
