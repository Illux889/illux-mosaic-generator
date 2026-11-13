/**
 * Illux Mosaik — tile inspector dialog (port of openTile / fillControlsFor /
 * setSourceFill UI). Shows the clicked photo untouched and as used in the
 * mosaic. Changing the fill colour behind that photo is an opt-in extra
 * behind a disclosure button, so the dialog stays simple by default.
 * Native <dialog>: focus is trapped while open and returns to the opener on close.
 */
import { t } from '../i18n/index.js';
import { rgbToHex } from '../engine/sources.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Inspector {
  constructor(refs, bridge, viewer, { onApplyFill } = {}) {
    this.refs = refs; this.bridge = bridge; this.viewer = viewer; this.onApplyFill = onApplyFill;
    this.cell = null; this.size = 512; this.busy = false;
    this.isOpen = false;
    const dialog = refs.inspector;
    // Cleanup runs directly from close(); the 'close' event (Esc key) is a backup,
    // because some embedded/background contexts never deliver it.
    dialog.addEventListener('close', () => this.#closed());
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); }); // Esc key
    refs.inspectorClose.addEventListener('click', () => this.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) this.close(); }); // backdrop click
    for (const radio of this.#fillRadios()) radio.addEventListener('change', () => this.#syncFillInputs(true));
    refs.fillToggle.addEventListener('click', () => {
      const open = refs.fillToggle.getAttribute('aria-expanded') !== 'true';
      refs.fillToggle.setAttribute('aria-expanded', String(open));
      refs.fillBody.hidden = !open;
    });
    refs.fillApply.addEventListener('click', () => this.#apply());
    refs.zoomHere.addEventListener('click', () => {
      const cell = this.cell; this.close();
      if (cell != null) this.viewer.zoomToCell(cell);
    });
  }

  #fillRadios() { return Array.from(this.refs.inspector.querySelectorAll('input[data-fill-mode]')); }
  #fillMode() { return this.#fillRadios().find(r => r.checked)?.value || 'auto'; }

  #closed() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.viewer.stopInspect(); this.cell = null;
    this.bridge.modal(false);
  }

  get source() {
    const result = this.viewer.result;
    return result && this.cell != null ? result.sources[result.assignments[this.cell]] : null;
  }

  open(cell) {
    const result = this.viewer.result, refs = this.refs;
    if (!result || !Number.isInteger(cell) || cell < 0 || cell >= result.assignments.length) return;
    const sourceIndex = result.assignments[cell];
    if (sourceIndex < 0) return;
    const source = result.sources[sourceIndex];
    this.cell = cell;
    refs.inspectorTitle.textContent = source.name;
    refs.inspectInfo.textContent = t('inspector.info', { count: result.counts[sourceIndex] });
    refs.inspectAdjustedCaption.textContent = result.params.strength === 0 ? t('inspector.adjustedRaw') : t('inspector.adjusted');
    refs.fillError.hidden = true;
    for (const radio of this.#fillRadios()) radio.checked = radio.value === source.background.mode;
    refs.fillToggle.setAttribute('aria-expanded', 'false'); refs.fillBody.hidden = true;
    this.#syncFillInputs(false);

    const dialog = refs.inspector;
    if (!dialog.open) {
      dialog.classList.toggle('is-anchored', this.bridge.active);
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    }
    if (!this.isOpen) { this.isOpen = true; this.bridge.modal(true); }
    const cssSize = refs.inspectOriginal.getBoundingClientRect().width || 320;
    const size = this.size = clamp(Math.ceil(Math.max(320, cssSize * (window.devicePixelRatio || 1)) / 32) * 32, 512, 1024);
    refs.inspectSmall.hidden = Math.max(source.width, source.height) >= size;
    for (const [canvas, raw] of [[refs.inspectOriginal, true], [refs.inspectAdjusted, false]]) {
      canvas.width = canvas.height = size;
      this.viewer.drawCellPreview(canvas.getContext('2d', { alpha: false }), cell, raw, size);
    }
    const cached = this.viewer.inspect(cell, size, (raw, bitmap, tileSize) => {
      if (this.cell === cell && tileSize === this.size) this.#draw(raw ? refs.inspectOriginal : refs.inspectAdjusted, bitmap, tileSize);
    });
    if (cached.raw) this.#draw(refs.inspectOriginal, cached.raw, size);
    if (cached.adjusted) this.#draw(refs.inspectAdjusted, cached.adjusted, size);
  }

  close() {
    if (this.refs.inspector.open) this.refs.inspector.close();
    this.#closed();
  }

  #draw(canvas, bitmap, size) {
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, size, size);
  }

  #syncFillInputs(fromUser) {
    const refs = this.refs, source = this.source;
    if (!source) return;
    const mode = this.#fillMode();
    refs.fillColorWrap.hidden = mode !== 'custom';
    if (!fromUser || mode !== 'custom') {
      const rgb = mode === 'white' ? [255, 255, 255] : mode === 'black' ? [0, 0, 0]
        : mode === 'auto' ? source.background.rgb : source.matte;
      refs.fillColor.value = rgbToHex(rgb);
    }
    refs.fillDetected.textContent = '';
  }

  async #apply() {
    const source = this.source, refs = this.refs;
    if (!source || this.busy) return;
    this.busy = true; refs.fillApply.setAttribute('aria-disabled', 'true'); refs.fillError.hidden = true;
    refs.fillApply.textContent = t('inspector.fillWorking');
    try {
      await this.onApplyFill(source, this.#fillMode(), refs.fillColor.value);
    } catch (error) {
      refs.fillError.textContent = t('errors.' + (error.code || 'generic'));
      refs.fillError.hidden = false;
    } finally { this.busy = false; refs.fillApply.removeAttribute('aria-disabled'); refs.fillApply.textContent = t('inspector.fillApply'); }
  }
}

