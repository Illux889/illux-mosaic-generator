/**
 * Illux Mosaik — zoomable mosaic viewer.
 * Port of the admin tool's viewer: metrics, visibleCells, paintViewport,
 * queueDetailTiles, setZoom, fitView, hitCell, pointer/pinch/wheel/keyboard
 * handling, far-distance preview, fullscreen, and the detail-tile cache
 * (DETAIL_BUDGET). Generalised to any grid and overview size.
 *
 * The canvas backing store is bounded by the screen size; zooming never
 * creates a giant bitmap. When tiles get large enough on screen, the detail
 * worker renders those tiles from the customer's photos at screen resolution.
 */
import { t } from '../i18n/index.js';
import { ICONS } from './dom.js';
import { drawWatermark, loadWatermark } from './watermark.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const detailWorkerUrl = new URL('../engine/detail-worker.js', import.meta.url);

export class Viewer {
  constructor(refs, config, bridge, { onOpenTile } = {}) {
    this.refs = refs; this.config = config; this.bridge = bridge; this.onOpenTile = onOpenTile;
    this.canvas = refs.canvas;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.farCtx = refs.far.getContext('2d', { alpha: false });
    this.result = null; this.raw = false;
    this.maxZoom = config.viewer.maxZoom;
    this.view = { zoom: 1, x: 0, y: 0, width: 1, height: 1, dpr: 1, scale: 1, left: 0, top: 0, spanW: 1, spanH: 1 };
    this.detailCache = new Map(); this.failedKeys = new Set();
    this.detailWorker = null; this.detailRevision = 0; this.detailBytes = 0; this.viewToken = 0;
    this.detailError = ''; this.detailUnavailable = false;
    this.inspectToken = 0; this.inspectHandler = null;
    this.frame = 0; this.detailTimer = 0;
    this.pointers = new Map(); this.dragMoved = false; this.dragOrigin = null;
    this.pseudoFullscreen = false;
    this.lastLayoutWidth = 0;
    this.#bind();
    // Repaint once the logo watermark has loaded (the text watermark is used until then).
    loadWatermark(config.watermark).then(ok => { if (ok && this.result) this.requestViewport(false); });
  }

  // ---------- geometry ----------
  get OW() { return this.result ? this.result.overviewWidth : 1; }
  get OH() { return this.result ? this.result.overviewHeight : 1; }
  get cellW() { return this.OW / this.result.gridWidth; }
  get cellH() { return this.OH / this.result.gridHeight; }

  isFullscreen() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    return fs === this.refs.viewer || this.pseudoFullscreen;
  }

  /** Size the canvas element so its aspect ratio equals the mosaic's. */
  layout() {
    if (!this.result) return;
    const stage = this.refs.stage, pad = 16;
    const stageWidth = Math.max(100, stage.clientWidth - pad);
    let maxHeight;
    if (this.isFullscreen()) {
      const viewerRect = this.refs.viewer.getBoundingClientRect(), stageRect = stage.getBoundingClientRect();
      maxHeight = Math.max(160, viewerRect.bottom - stageRect.top - pad - 16);
    } else {
      const visible = this.bridge.visibleViewport().height;
      maxHeight = Math.max(240, Math.min(820, visible * .82));
    }
    const aspect = this.OW / this.OH;
    let width = stageWidth, height = width / aspect;
    if (height > maxHeight) { height = maxHeight; width = height * aspect; }
    this.canvas.style.width = Math.floor(width) + 'px';
    this.canvas.style.height = Math.floor(height) + 'px';
    // Far preview keeps the same aspect ratio.
    const far = this.refs.far, maxW = 220, maxH = 308;
    if (maxW / aspect <= maxH) { far.width = maxW; far.height = Math.round(maxW / aspect); }
    else { far.height = maxH; far.width = Math.round(maxH * aspect); }
  }

  metrics() {
    const rect = this.canvas.getBoundingClientRect(), view = this.view;
    if (!(rect.width > 0 && rect.height > 0) || !this.result) return false;
    view.width = rect.width; view.height = rect.height;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2, 2560 / Math.max(rect.width, rect.height));
    const width = Math.max(1, Math.round(view.width * view.dpr)), height = Math.max(1, Math.round(view.height * view.dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    view.zoom = clamp(view.zoom, 1, this.maxZoom); view.spanW = this.OW / view.zoom; view.spanH = this.OH / view.zoom;
    const halfW = view.spanW / 2, halfH = view.spanH / 2;
    view.x = clamp(view.x, halfW, this.OW - halfW); view.y = clamp(view.y, halfH, this.OH - halfH);
    view.left = view.x - halfW; view.top = view.y - halfH;
    view.scale = Math.min(view.width / view.spanW, view.height / view.spanH);
    return true;
  }

  // ---------- result lifecycle ----------
  setResult(result) {
    this.result = result;
    this.canvas.setAttribute('aria-label', t('viewer.canvasLabel', { count: result.diagnostics.usedSources }));
    this.view.zoom = 1; this.view.x = this.OW / 2; this.view.y = this.OH / 2;
    this.#resetDetails();
    this.layout();
    this.requestViewport();
  }

  clear() {
    this.#disposeDetails();
    this.result = null;
  }

  setRaw(raw) {
    this.raw = !!raw;
    this.refs.rawLabel.hidden = !this.raw;
    this.requestViewport();
  }

  // ---------- detail tiles ----------
  detailKey(cell, size, raw) { return this.detailRevision + ':' + cell + ':' + size + ':' + (raw ? 1 : 0); }

  visibleCells() {
    const view = this.view, result = this.result;
    if (!result || view.zoom <= 1.15) return [];
    const gridW = result.gridWidth, gridH = result.gridHeight, cellW = this.cellW, cellH = this.cellH;
    const wanted = Math.min(cellW, cellH) * view.scale * view.dpr;
    if (wanted <= this.config.viewer.detailMinCellPx) return [];
    const size = clamp(Math.ceil(wanted / 32) * 32, 64, 1024), cells = [];
    const minX = clamp(Math.floor(view.left / cellW), 0, gridW - 1), minY = clamp(Math.floor(view.top / cellH), 0, gridH - 1);
    const maxX = clamp(Math.floor((view.left + view.spanW - 1e-7) / cellW), 0, gridW - 1);
    const maxY = clamp(Math.floor((view.top + view.spanH - 1e-7) / cellH), 0, gridH - 1);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const i = y * gridW + x;
      if (result.assignments[i] < 0) continue;
      cells.push({ i, col: x, row: y, size, distance: (x * cellW + cellW / 2 - view.x) ** 2 + (y * cellH + cellH / 2 - view.y) ** 2 });
    }
    return cells.sort((a, b) => a.distance - b.distance);
  }

  #releaseCache() {
    for (const item of this.detailCache.values()) item.bitmap.close();
    this.detailCache.clear(); this.detailBytes = 0;
  }

  #disposeDetails() {
    this.detailRevision++;
    this.detailWorker?.terminate(); this.detailWorker = null;
    clearTimeout(this.detailTimer); this.detailTimer = 0;
    this.#releaseCache(); this.failedKeys.clear();
    this.detailError = ''; this.detailUnavailable = false;
    this.inspectToken++; this.inspectHandler = null;
  }

  #resetDetails() {
    this.#disposeDetails();
    if (!this.result) return;
    try {
      const worker = this.detailWorker = new Worker(detailWorkerUrl);
      const revision = this.detailRevision;
      worker.onmessage = event => {
        const message = event.data;
        if (worker !== this.detailWorker || message.revision !== this.detailRevision || revision !== this.detailRevision) { message.bitmap?.close(); return; }
        if (message.type === 'detailError') {
          this.detailError = t('errors.' + message.code);
          if (message.key) this.failedKeys.add(message.key); else this.detailUnavailable = true;
          this.#updateQuality();
          return;
        }
        if (message.type !== 'tile') return;
        if (this.detailCache.has(message.key)) {
          const previous = this.detailCache.get(message.key); previous.bitmap.close();
          this.detailBytes -= previous.bytes; this.detailCache.delete(message.key);
        }
        const bytes = message.size * message.size * 4;
        this.detailCache.set(message.key, { bitmap: message.bitmap, bytes, size: message.size });
        this.detailBytes += bytes;
        while (this.detailBytes > this.config.viewer.detailBudgetBytes && this.detailCache.size > 1) {
          const key = this.detailCache.keys().next().value, item = this.detailCache.get(key);
          this.detailBytes -= item.bytes; item.bitmap.close(); this.detailCache.delete(key);
        }
        if (message.purpose === 'inspect' && message.inspectToken === this.inspectToken && this.inspectHandler) {
          this.inspectHandler(message.raw, message.bitmap, message.size);
        }
        this.requestViewport(false);
      };
      worker.onerror = () => {
        if (worker !== this.detailWorker) return;
        this.detailError = t('errors.detail-unsupported'); this.detailUnavailable = true; this.#updateQuality();
      };
      worker.postMessage({
        type: 'init', revision, assignments: this.result.assignments, profiles: this.result.toneProfiles,
        sources: this.result.sources.map(s => ({ blob: s.blob, width: s.width, height: s.height, matte: s.matte.slice() }))
      });
    } catch (_) { this.detailError = t('errors.detail-unsupported'); this.detailUnavailable = true; }
  }

  #queueDetailTiles() {
    this.detailTimer = 0;
    if (!this.detailWorker || !this.result || this.detailUnavailable) return;
    const tasks = this.visibleCells().filter(c => {
      const key = this.detailKey(c.i, c.size, this.raw); return !this.detailCache.has(key) && !this.failedKeys.has(key);
    }).map(c => ({ cell: c.i, size: c.size, raw: this.raw, key: this.detailKey(c.i, c.size, this.raw) }));
    this.detailWorker.postMessage({ type: 'view', revision: this.detailRevision, token: ++this.viewToken, tasks });
  }

  /**
   * Inspector support: get a cached tile now, or request it. `handler(raw, bitmap, size)`
   * is called for tiles that arrive later. Returns the cached bitmap or null.
   */
  inspect(cell, size, handler) {
    this.inspectToken++;
    this.inspectHandler = handler;
    const tasks = [], cached = {};
    for (const raw of [true, false]) {
      const key = this.detailKey(cell, size, raw), item = this.detailCache.get(key);
      if (item) cached[raw ? 'raw' : 'adjusted'] = item.bitmap;
      else tasks.push({ cell, size, raw, key });
    }
    if (this.detailWorker && !this.detailUnavailable && tasks.length) {
      this.detailWorker.postMessage({ type: 'inspect', revision: this.detailRevision, inspectToken: this.inspectToken, tasks });
    }
    return cached;
  }

  stopInspect() {
    this.inspectToken++; this.inspectHandler = null;
    this.detailWorker?.postMessage({ type: 'inspect', revision: this.detailRevision, inspectToken: this.inspectToken, tasks: [] });
  }

  /** Draw the low-resolution overview of one cell (used until a sharp tile arrives). */
  drawCellPreview(ctx, cell, raw, size) {
    const result = this.result, col = cell % result.gridWidth, row = Math.floor(cell / result.gridWidth);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(raw ? result.raw : result.corrected, col * this.cellW, row * this.cellH, this.cellW, this.cellH, 0, 0, size, size);
  }

  // ---------- painting ----------
  requestViewport(refreshDetails = true) {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.#paint());
    if (refreshDetails) { clearTimeout(this.detailTimer); this.detailTimer = setTimeout(() => this.#queueDetailTiles(), 85); }
  }

  #paint() {
    this.frame = 0;
    if (!this.metrics()) return;
    const ctx = this.ctx, view = this.view, width = this.canvas.width, height = this.canvas.height, result = this.result;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const base = this.raw ? result.raw : result.corrected;
    ctx.drawImage(base, view.left, view.top, view.spanW, view.spanH, 0, 0, width, height);
    for (const cell of this.visibleCells()) {
      const key = this.detailKey(cell.i, cell.size, this.raw), item = this.detailCache.get(key);
      if (!item) continue;
      const x0 = Math.round((cell.col * this.cellW - view.left) / view.spanW * width);
      const y0 = Math.round((cell.row * this.cellH - view.top) / view.spanH * height);
      const x1 = Math.round(((cell.col + 1) * this.cellW - view.left) / view.spanW * width);
      const y1 = Math.round(((cell.row + 1) * this.cellH - view.top) / view.spanH * height);
      ctx.drawImage(item.bitmap, x0, y0, x1 - x0, y1 - y0);
      this.detailCache.delete(key); this.detailCache.set(key, item); // keep visible tiles warm in the LRU
    }
    drawWatermark(ctx, width, height, this.config.watermark);
    // Far-distance preview with the current viewport outlined.
    const far = this.refs.far, fctx = this.farCtx;
    fctx.imageSmoothingEnabled = true; fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(base, 0, 0, far.width, far.height);
    drawWatermark(fctx, far.width, far.height, this.config.watermark);
    if (view.zoom > 1.01) {
      fctx.strokeStyle = getComputedStyle(this.refs.viewer).getPropertyValue('--ilx-primary').trim() || '#5B5544';
      fctx.lineWidth = 2;
      fctx.strokeRect(view.left / this.OW * far.width, view.top / this.OH * far.height, view.spanW / this.OW * far.width, view.spanH / this.OH * far.height);
      fctx.strokeStyle = '#fff'; fctx.lineWidth = 1;
      fctx.strokeRect(view.left / this.OW * far.width - 1.5, view.top / this.OH * far.height - 1.5, view.spanW / this.OW * far.width + 3, view.spanH / this.OH * far.height + 3);
    }
    this.#updateQuality();
  }

  #updateQuality() {
    const refs = this.refs, view = this.view;
    refs.zoomValue.textContent = t('viewer.zoomValue', { value: Math.round(view.zoom * 100) });
    refs.zoomOut.disabled = !this.result || view.zoom <= 1;
    refs.zoomIn.disabled = !this.result || view.zoom >= this.maxZoom;
    if (!this.result) { refs.quality.textContent = ''; return; }
    if (this.detailUnavailable) { refs.quality.textContent = this.detailError + ' ' + t('viewer.qualityUnavailable'); return; }
    const cells = this.visibleCells();
    if (!cells.length) { refs.quality.textContent = t('viewer.qualityOverview'); return; }
    const done = cells.filter(c => this.detailCache.has(this.detailKey(c.i, c.size, this.raw))).length;
    refs.quality.textContent = done < cells.length ? t('viewer.qualityLoading', { done, total: cells.length }) : t('viewer.qualityReady');
  }

  // ---------- navigation ----------
  setZoom(zoom, anchorX = null, anchorY = null) {
    if (!Number.isFinite(zoom) || !this.metrics()) return;
    const view = this.view;
    const x = anchorX ?? view.width / 2, y = anchorY ?? view.height / 2;
    const wx = view.left + x / view.width * view.spanW, wy = view.top + y / view.height * view.spanH;
    view.zoom = clamp(zoom, 1, this.maxZoom);
    const spanW = this.OW / view.zoom, spanH = this.OH / view.zoom;
    view.x = wx + (.5 - x / view.width) * spanW; view.y = wy + (.5 - y / view.height) * spanH;
    this.metrics(); this.requestViewport();
  }

  fitView() {
    if (!this.result) return;
    this.view.zoom = 1; this.view.x = this.OW / 2; this.view.y = this.OH / 2; this.requestViewport();
  }

  zoomToCell(i, zoom = 24) {
    if (!this.result) return;
    const gridW = this.result.gridWidth;
    this.view.zoom = Math.min(zoom, this.maxZoom);
    this.view.x = (i % gridW + .5) * this.cellW; this.view.y = (Math.floor(i / gridW) + .5) * this.cellH;
    this.requestViewport();
    this.canvas.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  hitCell(event) {
    if (!this.result || !this.metrics()) return null;
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x < 0 || x >= rect.width || y < 0 || y >= rect.height) return null;
    const view = this.view, gridW = this.result.gridWidth, gridH = this.result.gridHeight;
    const col = Math.floor((view.left + x / rect.width * view.spanW) / this.cellW);
    const row = Math.floor((view.top + y / rect.height * view.spanH) / this.cellH);
    if (col < 0 || col >= gridW || row < 0 || row >= gridH) return null;
    const i = row * gridW + col, sourceIndex = this.result.assignments[i];
    if (sourceIndex < 0) return null;
    return { i, col, row, sourceIndex, source: this.result.sources[sourceIndex], x, y, rect };
  }

  #showTip(event) {
    const cell = this.hitCell(event), tip = this.refs.tooltip;
    if (!cell) { tip.hidden = true; return; }
    tip.textContent = t('viewer.tooltip', { name: cell.source.name, count: this.result.counts[cell.sourceIndex] });
    const stageRect = this.refs.stage.getBoundingClientRect();
    tip.style.left = Math.max(0, Math.min(event.clientX - stageRect.left, stageRect.width - 270)) + 'px';
    tip.style.top = Math.max(0, Math.min(event.clientY - stageRect.top, stageRect.height - 60)) + 'px';
    tip.hidden = false;
  }

  // ---------- fullscreen ----------
  async toggleFullscreen() {
    const viewer = this.refs.viewer;
    const current = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (current) { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      if (this.pseudoFullscreen) { this.#setPseudo(false); return; }
      const request = viewer.requestFullscreen || viewer.webkitRequestFullscreen;
      const enabled = document.fullscreenEnabled ?? document.webkitFullscreenEnabled;
      if (request && enabled !== false) { await request.call(viewer); return; }
    } catch (_) { /* fall through to the fallback below */ }
    this.#setPseudo(true);
  }

  /** Leave fullscreen (real or fallback) if it is on. */
  async exitFullscreen() {
    try {
      const current = document.fullscreenElement || document.webkitFullscreenElement;
      if (current === this.refs.viewer) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } catch (_) { /* ignore */ }
    this.#setPseudo(false);
  }

  #setPseudo(on) {
    if (this.pseudoFullscreen === on) return;
    this.pseudoFullscreen = on;
    this.refs.viewer.classList.toggle('is-pseudo-fullscreen', on);
    this.bridge.modal(on);
    if (on) this.#pseudoKeyHandler = e => { if (e.key === 'Escape') this.#setPseudo(false); };
    if (on) document.addEventListener('keydown', this.#pseudoKeyHandler);
    else document.removeEventListener('keydown', this.#pseudoKeyHandler);
    this.#fullscreenChanged();
  }
  #pseudoKeyHandler = null;

  #fullscreenChanged() {
    const on = this.isFullscreen();
    this.refs.fullscreen.firstElementChild.outerHTML = on ? ICONS.exitFullscreen : ICONS.fullscreen;
    this.refs.fullscreenText.textContent = on ? t('viewer.exitFullscreen') : t('viewer.fullscreen');
    requestAnimationFrame(() => { this.layout(); this.requestViewport(); });
  }

  // ---------- events ----------
  #bind() {
    const canvas = this.canvas, refs = this.refs;
    const pinch = points => {
      const [a, b] = [...points.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    };
    canvas.addEventListener('pointerdown', event => {
      if (!this.result || (event.pointerType === 'mouse' && event.button !== 0)) return;
      canvas.focus({ preventScroll: true });
      if (!this.pointers.size) { this.dragMoved = false; this.dragOrigin = { x: event.clientX, y: event.clientY }; }
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size > 1) this.dragMoved = true;
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      refs.tooltip.hidden = true;
    });
    canvas.addEventListener('pointermove', event => {
      if (!this.pointers.has(event.pointerId)) { if (!this.pointers.size && event.pointerType === 'mouse') this.#showTip(event); return; }
      if (!this.metrics()) return;
      const view = this.view, previous = this.pointers.get(event.pointerId);
      const before = this.pointers.size >= 2 ? pinch(this.pointers) : null;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (before) {
        const after = pinch(this.pointers), rect = canvas.getBoundingClientRect();
        const wx = view.left + (before.x - rect.left) / rect.width * view.spanW;
        const wy = view.top + (before.y - rect.top) / rect.height * view.spanH;
        view.zoom = clamp(view.zoom * after.distance / before.distance, 1, this.maxZoom);
        const spanW = this.OW / view.zoom, spanH = this.OH / view.zoom;
        view.x = wx + (.5 - (after.x - rect.left) / rect.width) * spanW;
        view.y = wy + (.5 - (after.y - rect.top) / rect.height) * spanH;
        this.dragMoved = true;
      } else {
        if (Math.hypot(event.clientX - this.dragOrigin.x, event.clientY - this.dragOrigin.y) > 5) this.dragMoved = true;
        if (this.dragMoved) { view.x -= (event.clientX - previous.x) / view.scale; view.y -= (event.clientY - previous.y) / view.scale; }
      }
      if (this.dragMoved) { canvas.classList.add('is-dragging'); refs.tooltip.hidden = true; this.requestViewport(); }
    });
    const finish = (event, cancelled) => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.delete(event.pointerId);
      try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch (_) {}
      if (!this.pointers.size) {
        canvas.classList.remove('is-dragging');
        if (!cancelled && !this.dragMoved) { const cell = this.hitCell(event); if (cell) this.onOpenTile?.(cell.i); }
        this.requestViewport();
      } else { this.dragMoved = true; }
    };
    canvas.addEventListener('pointerup', event => finish(event, false));
    canvas.addEventListener('pointercancel', event => finish(event, true));
    canvas.addEventListener('lostpointercapture', event => { if (this.pointers.has(event.pointerId)) finish(event, true); });
    canvas.addEventListener('pointerleave', () => { refs.tooltip.hidden = true; });
    canvas.addEventListener('wheel', event => {
      if (!this.result) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      this.setZoom(this.view.zoom * Math.exp(-clamp(delta, -500, 500) * .002), event.clientX - rect.left, event.clientY - rect.top);
      refs.tooltip.hidden = true;
    }, { passive: false });
    canvas.addEventListener('keydown', event => {
      if (!this.result) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!this.metrics()) return;
        const gridW = this.result.gridWidth;
        const col = Math.min(gridW - 1, Math.floor(this.view.x / this.cellW)), row = Math.min(this.result.gridHeight - 1, Math.floor(this.view.y / this.cellH));
        this.onOpenTile?.(row * gridW + col);
        return;
      }
      const keys = ['+', '=', '-', '_', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      if (event.key === '+' || event.key === '=') this.setZoom(this.view.zoom * 1.4);
      else if (event.key === '-' || event.key === '_') this.setZoom(this.view.zoom / 1.4);
      else if (event.key === 'Home') this.fitView();
      else {
        this.metrics(); const distance = 80 / this.view.scale;
        if (event.key === 'ArrowLeft') this.view.x -= distance;
        if (event.key === 'ArrowRight') this.view.x += distance;
        if (event.key === 'ArrowUp') this.view.y -= distance;
        if (event.key === 'ArrowDown') this.view.y += distance;
        this.requestViewport();
      }
    });
    refs.zoomIn.addEventListener('click', () => this.setZoom(this.view.zoom * 1.5));
    refs.zoomOut.addEventListener('click', () => this.setZoom(this.view.zoom / 1.5));
    refs.zoomFit.addEventListener('click', () => this.fitView());
    refs.fullscreen.addEventListener('click', () => this.toggleFullscreen());
    for (const name of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(name, () => this.#fullscreenChanged());
    refs.far.addEventListener('click', event => {
      if (!this.result) return;
      const rect = event.currentTarget.getBoundingClientRect();
      this.view.zoom = Math.max(4, this.view.zoom);
      this.view.x = (event.clientX - rect.left) / rect.width * this.OW;
      this.view.y = (event.clientY - rect.top) / rect.height * this.OH;
      this.requestViewport();
    });
    const relayout = () => {
      const width = this.refs.stage.clientWidth;
      if (width === this.lastLayoutWidth && !this.isFullscreen()) { this.requestViewport(); return; }
      this.lastLayoutWidth = width; this.layout(); this.requestViewport();
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(relayout).observe(refs.viewer);
    window.addEventListener('resize', () => { this.lastLayoutWidth = 0; relayout(); });
    this.bridge.onViewport(() => { if (this.isFullscreen()) { this.layout(); this.requestViewport(); } });
  }
}
