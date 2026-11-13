/*
 * Illux Mosaik — detail worker (classic worker script).
 * Port of photoDetailWorker: renders high-resolution tiles for the cells that
 * are visible while zoomed in, and for the tile inspector. It only ever uses
 * the customer's source photos and the per-cell tone profiles, never target pixels.
 *
 * In:  { type: 'init', revision, assignments, profiles, sources: [{ blob, width, height, matte }] }
 *      { type: 'view', revision, token, tasks: [{ cell, size, raw, key }] }
 *      { type: 'inspect', revision, inspectToken, tasks }
 * Out: { type: 'tile', revision, key, cell, size, raw, purpose, inspectToken, bitmap }
 *      { type: 'detailError', revision, key?, purpose?, inspectToken?, code }
 */
'use strict';
importScripts('./worker-shared.js');
const { clamp, correctPixels, createSourceCache } = self.IlxShared;

const cache = createSourceCache(32 * 1024 * 1024);
let sources = [], profiles = null, assignments = null, revision = 0, viewToken = 0;
let viewTasks = [], inspectTasks = [], running = false;

function stale(task) {
  return task.revision !== revision || (task.purpose === 'view' && task.token !== viewToken);
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (inspectTasks.length || viewTasks.length) {
      const task = inspectTasks.length ? inspectTasks.shift() : viewTasks.shift();
      if (stale(task)) continue;
      try {
        const size = clamp(Math.round(task.size), 40, 1024);
        const raw = await cache.get(sources, assignments[task.cell], size);
        if (stale(task)) continue;
        const output = correctPixels(raw, task.cell, profiles, task.raw);
        const canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext('2d', { alpha: false });
        ctx.putImageData(new ImageData(output, size, size), 0, 0);
        const bitmap = canvas.transferToImageBitmap();
        self.postMessage({ type: 'tile', revision, key: task.key, cell: task.cell, size, raw: task.raw,
          purpose: task.purpose, inspectToken: task.inspectToken, bitmap }, [bitmap]);
      } catch (error) {
        self.postMessage({ type: 'detailError', revision, key: task.key, purpose: task.purpose,
          inspectToken: task.inspectToken, code: error.message === 'source-missing' ? 'source-missing' : 'detail-failed' });
      }
      // Let newer viewport requests supersede old work.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally { running = false; }
}

self.onmessage = event => {
  const data = event.data;
  if (data.type === 'init') {
    revision = data.revision; sources = data.sources; profiles = data.profiles; assignments = data.assignments;
    cache.clear(); viewTasks = []; inspectTasks = [];
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
      self.postMessage({ type: 'detailError', revision, code: 'detail-unsupported' });
    }
  } else if (data.revision === revision && data.type === 'view') {
    viewToken = data.token;
    viewTasks = data.tasks.map(t => ({ ...t, purpose: 'view', token: viewToken, revision }));
    pump();
  } else if (data.revision === revision && data.type === 'inspect') {
    inspectTasks = data.tasks.map(t => ({ ...t, purpose: 'inspect', inspectToken: data.inspectToken, revision }));
    pump();
  }
};
