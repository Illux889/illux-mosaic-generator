/**
 * Illux Mosaik — application controller: a guided flow in four steps.
 *   1. Hovedbillede  2. Dine billeder  3. Størrelse  4. Din mosaik (+ opt-in "Flere indstillinger")
 *
 * Accessibility behaviour (WCAG 2.2 AA):
 * - One step at a time; on every step change focus moves to the step heading.
 * - Buttons are never disabled to signal "missing input". Pressing "Næste"
 *   shows an error summary with links to what is missing, and moves focus there.
 * - Important events are announced in one polite live region.
 * - Destructive actions (remove all photos, start over) ask first.
 * - Settings never re-run the mosaic by themselves; the customer presses
 *   "Opdater mosaikken" (predictable, no surprise changes).
 * All image processing stays in the browser; nothing is sent anywhere.
 *
 * Layout 'workspace' (version 3 "Værkstedet", opt-in via the `layout` option or
 * data-layout="workspace" on the root): all parts on one screen, no steps, and
 * the mosaic re-renders by itself shortly after the customer changes something.
 * Changing a setting only updates the picture; focus never moves (WCAG 3.2.2).
 * Without the option, behaviour is exactly the step flow above.
 */
import { CONFIG } from '../config.js';
import { t, raw, formatNumber, setLanguage, languageFromUrl } from '../i18n/index.js';
import { MosaicEngine, engineSupported, fitsInMemory, device } from '../engine/mosaic-engine.js';
import { importSources, releaseSource, setSourceFill } from '../engine/sources.js';
import { loadTarget } from '../engine/target.js';
import { normaliseCm, printSpec, gridFor, tileSizeCm } from '../engine/grid.js';
import { collectRefs, el, ICONS } from './dom.js';
import { renderTemplate } from './template.js';
import { createEmbedBridge } from './embed-bridge.js';
import { Viewer } from './viewer.js';
import { Inspector } from './inspector.js';
import { lockImages } from './watermark.js';

const IMAGE_NAME = /\.(jpe?g|png|webp|heic|heif|avif|gif)$/i;
const STEPS = 4;

export function mountMosaicApp(root, config = CONFIG, options = {}) {
  const layout = options.layout || root.dataset.layout || 'steps';
  const workspace = layout === 'workspace';
  setLanguage(languageFromUrl(config.defaultLanguage));
  root.classList.add('ilx-mosaic');
  if (workspace) root.classList.add('ilx-mosaic--workspace');
  const bridge = createEmbedBridge(root, config);
  if (bridge.blocked) {
    // Embedded on a site that is not illux.dk: refuse to run (see embed-bridge.js).
    root.replaceChildren(el('p', { class: 'ilx-mosaic-note ilx-mosaic-note--warning', text: t('app.blockedEmbed') + ' ' },
      el('a', { href: config.homeUrl, target: '_top', rel: 'noopener', text: t('app.blockedLink') })));
    return null;
  }
  root.innerHTML = renderTemplate({ ...config, layout, headingLevel: Number(root.dataset.headingLevel) || config.headingLevel || 1 });
  const refs = collectRefs(root);
  lockImages(root); // no "Save image as" or dragging on the mosaic
  const engine = new MosaicEngine(config);
  const state = {
    step: 1, maxStep: 1,
    target: null, targetUrl: null,
    sources: [], importing: null,
    result: null,
    needsRender: true,      // inputs (motif, photos, size) changed since the last mosaic
    stale: false,           // "Flere indstillinger" changed since the last mosaic
    rendering: false,
    tileCm: null            // tile size chosen with the slider (null = the recommended grid)
  };
  const viewer = new Viewer(refs, config, bridge, { onOpenTile: cell => inspector.open(cell) });
  const inspector = new Inspector(refs, bridge, viewer, { onApplyFill: applyFill, confirmBusy: () => state.rendering });

  // ================================================================ helpers
  const panels = Array.from(root.querySelectorAll('[data-panel]'));
  const stepButtons = Array.from(root.querySelectorAll('[data-goto]'));
  const names = raw('steps.names');

  function announce(text) {
    // Clear first so the same sentence twice is announced twice.
    refs.live.textContent = '';
    setTimeout(() => { refs.live.textContent = text; }, 60);
  }
  function show(node, text, variant) {
    node.textContent = text || '';
    node.hidden = !text;
    if (variant) node.className = 'ilx-mosaic-note ilx-mosaic-note--' + variant;
  }
  function errorText(error, vars = {}) {
    const code = error && error.code ? error.code : 'generic';
    const text = t('errors.' + code, {
      mb: Math.round(config.sources.maxFileBytes / 1048576), mp: config.sources.maxMegapixels,
      px: code === 'target-too-small' ? config.target.minSidePx : config.sources.minSidePx,
      min: config.sources.hardMin, ...vars
    });
    return text === 'errors.' + code ? t('errors.generic') : text;
  }
  function setProgress(fill, bar, value) {
    const v = Math.max(0, Math.min(100, Math.round(value)));
    fill.style.width = v + '%';
    bar.setAttribute('aria-valuenow', String(v));
  }
  function scrollToTopOf(node) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (bridge.active) bridge.scrollTo(node.getBoundingClientRect().top + window.scrollY);
    else node.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }

  /** Generic confirmation dialog. Resolves true/false. */
  function confirmDialog({ title, body, ok, cancel }) {
    const dialog = refs.confirm;
    refs.confirmTitle.textContent = title;
    refs.confirmText.replaceChildren(...(Array.isArray(body) ? body : [body]).filter(Boolean).map(text => el('p', { text })));
    refs.confirmOk.textContent = ok; refs.confirmCancel.textContent = cancel;
    const opener = document.activeElement;
    return new Promise(resolve => {
      const done = value => {
        refs.confirmOk.removeEventListener('click', yes); refs.confirmCancel.removeEventListener('click', no);
        dialog.removeEventListener('cancel', escape); dialog.removeEventListener('close', no);
        if (dialog.open) dialog.close();
        bridge.modal(false);
        if (opener && opener.isConnected) opener.focus();
        resolve(value);
      };
      const yes = () => done(true), no = () => done(false);
      const escape = event => { event.preventDefault(); done(false); };
      refs.confirmOk.addEventListener('click', yes); refs.confirmCancel.addEventListener('click', no);
      dialog.addEventListener('cancel', escape); dialog.addEventListener('close', no);
      dialog.classList.toggle('is-anchored', bridge.active);
      dialog.showModal(); bridge.modal(true);
      refs.confirmCancel.focus(); // safe default for destructive questions
    });
  }

  /** A disclosure button (aria-expanded) that shows/hides a region. */
  function disclosure(button, body, onToggle) {
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
      onToggle?.(open);
    });
  }

  /**
   * Tell the page around the tool that something changed (main image, photos or the mosaic).
   * Pages can listen with root.addEventListener('ilx-mosaic:change', …) and read the handle's state.
   */
  function emitChange() { root.dispatchEvent(new CustomEvent('ilx-mosaic:change', { bubbles: true })); }

  // ================================================================ workspace (auto-update)
  let renderTimer = 0;
  const readyToRender = () => !!state.target && state.sources.length >= config.sources.hardMin && !state.importing && size().valid;
  /** Workspace only: list what is still missing before the first mosaic. */
  function updateWaiting() {
    if (!workspace) return;
    const min = config.sources.hardMin, count = state.sources.length;
    refs.wsTargetState.textContent = t(state.target ? 'workspace.targetDone' : 'workspace.targetMissing');
    refs.wsSourcesState.textContent = t('workspace.sources', { min, count });
    refs.wsEmpty.hidden = !!state.result || (!!state.target && count >= min);
  }
  /** Workspace only: re-render shortly after the last change (debounced). */
  function scheduleRender(delay = config.viewer.autoRerenderDelay) {
    if (!workspace) return;
    clearTimeout(renderTimer);
    updateWaiting();
    renderTimer = setTimeout(() => { renderTimer = 0; if (readyToRender() && engineSupported()) generate(); }, delay);
  }

  // ================================================================ steps
  function errorBox(step) { return refs['errors' + step]; }
  function clearErrors(step) { const box = errorBox(step); if (box) box.hidden = true; }

  /** Show an error summary with links to the problems. `items`: [{ text, target }]. */
  function showErrors(step, items) {
    const box = errorBox(step);
    const list = box.querySelector('ul');
    list.replaceChildren(...items.map(item => {
      const link = el('a', { href: '#' + (item.target?.id || ''), text: item.text });
      link.addEventListener('click', event => { event.preventDefault(); item.target?.focus(); });
      return el('li', {}, link);
    }));
    box.hidden = false;
    box.focus();
  }

  function validate(step) {
    if (step === 1 && !state.target) return [{ text: t('errorSummary.target'), target: refs.targetChoose }];
    if (step === 2) {
      if (state.importing) return [{ text: t('errorSummary.importing'), target: refs.importStop }];
      if (state.sources.length < config.sources.hardMin) return [{ text: t('errorSummary.sources', { min: config.sources.hardMin }), target: refs.sourcesChoose }];
    }
    if (step === 3) {
      const problems = sizeProblems();
      if (problems.length) {
        showFieldErrors(problems);
        return problems.map(p => ({ text: p.text, target: p.input }));
      }
    }
    return [];
  }

  function goTo(step, { focus = true } = {}) {
    step = Math.max(1, Math.min(STEPS, step));
    if (workspace) {
      // No steps on one screen: only move focus to that part's heading.
      if (focus) root.querySelector('#ilx-mosaic-step-' + step + '-title')?.focus();
      return true;
    }
    // Moving forward must pass every step in between.
    for (let s = state.step; s < step; s++) {
      const problems = validate(s);
      if (problems.length) { if (s !== state.step) goTo(s, { focus: false }); showErrors(s, problems); return false; }
    }
    clearErrors(state.step);
    if (state.step === 4 && step !== 4) { inspector.close(); viewer.exitFullscreen(); }
    state.step = step;
    state.maxStep = Math.max(state.maxStep, step);
    panels.forEach(panel => { panel.hidden = Number(panel.dataset.panel) !== step; });
    updateStepNav();
    bridge.refresh();
    if (focus) {
      const heading = root.querySelector('#ilx-mosaic-step-' + step + '-title');
      scrollToTopOf(root);
      heading.focus({ preventScroll: true });
    }
    if (step === 3) updateSize();
    if (step === 4) enterResultStep();
    return true;
  }

  function updateStepNav() {
    stepButtons.forEach((button, i) => {
      const n = i + 1, item = button.parentElement;
      const current = n === state.step, done = n < state.step || (n <= state.maxStep && !current && n !== STEPS);
      button.toggleAttribute('aria-current', current);
      if (current) button.setAttribute('aria-current', 'step');
      item.classList.toggle('is-done', done && !current);
      button.disabled = n > state.maxStep;
      root.querySelector('[data-step-state="' + n + '"]').textContent = current ? ', ' + t('steps.current') : done ? ', ' + t('steps.done') : '';
    });
  }

  stepButtons.forEach(button => button.addEventListener('click', () => {
    const n = Number(button.dataset.goto);
    if (n !== state.step) goTo(n);
  }));
  root.querySelectorAll('[data-next]').forEach(button => button.addEventListener('click', () => goTo(Number(button.dataset.next))));
  root.querySelectorAll('[data-prev]').forEach(button => button.addEventListener('click', () => goTo(Number(button.dataset.prev))));

  // ================================================================ drop zones
  function makeDropZone(zone, onFiles) {
    let depth = 0;
    zone.addEventListener('dragenter', event => { event.preventDefault(); depth++; zone.classList.add('is-dragover'); });
    zone.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
    zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove('is-dragover'); });
    zone.addEventListener('drop', event => {
      event.preventDefault(); depth = 0; zone.classList.remove('is-dragover');
      const files = Array.from(event.dataTransfer?.files || []).filter(f => f.type.startsWith('image/') || IMAGE_NAME.test(f.name));
      if (files.length) onFiles(files);
    });
  }
  function bindFileInput(input, onFiles) {
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []); input.value = '';
      if (files.length) onFiles(files);
    });
  }
  // Dropping a file next to a drop zone must not navigate the page away.
  for (const type of ['dragover', 'drop']) root.addEventListener(type, event => { if (!event.defaultPrevented) event.preventDefault(); });

  // ================================================================ step 1: main image
  async function setTarget(file) {
    refs.targetMsg.hidden = true; clearErrors(1);
    refs.targetLoading.hidden = false;
    try {
      const target = await loadTarget(file, config.target);
      if (state.targetUrl) URL.revokeObjectURL(state.targetUrl);
      state.target = target;
      state.targetUrl = URL.createObjectURL(file);
      refs.targetImg.src = state.targetUrl;
      refs.targetImg.alt = t('target.previewAlt', { name: target.name });
      refs.targetInfo.textContent = target.name;
      refs.targetEmpty.hidden = true; refs.targetPreview.hidden = false; refs.targetActions.hidden = false;
      state.needsRender = true;
      if (refs.lock.checked) applyLock('width');
      clearErrors(1);
      announce(t('target.chosen') + ': ' + target.name);
      scheduleRender();
      emitChange();
    } catch (error) {
      show(refs.targetMsg, errorText(error));
    } finally {
      refs.targetLoading.hidden = true;
    }
  }
  function clearTarget() {
    if (state.targetUrl) URL.revokeObjectURL(state.targetUrl);
    state.target = null; state.targetUrl = null; state.needsRender = true;
    refs.targetImg.removeAttribute('src');
    refs.targetEmpty.hidden = false; refs.targetPreview.hidden = true; refs.targetActions.hidden = true; refs.targetMsg.hidden = true;
    refs.targetChoose.focus();
    updateWaiting();
    emitChange();
  }
  makeDropZone(refs.targetDrop, files => setTarget(files[0]));
  bindFileInput(refs.targetInput, files => setTarget(files[0]));
  refs.targetChoose.addEventListener('click', () => refs.targetInput.click());
  refs.targetReplace.addEventListener('click', () => refs.targetInput.click());
  refs.targetRemove.addEventListener('click', clearTarget);

  // ================================================================ step 2: photos
  function thumbFor(asset) {
    const remove = el('button', {
      type: 'button', class: 'ilx-mosaic-thumb__remove', 'aria-label': t('sources.removeOne', { name: asset.name }),
      title: t('sources.removeOne', { name: asset.name }), html: ICONS.close
    });
    remove.addEventListener('click', () => removeSource(asset, remove));
    const img = el('img', { src: asset.thumbUrl, alt: '', loading: 'lazy', decoding: 'async' });
    return el('li', { class: 'ilx-mosaic-thumb', dataset: { id: asset.id } }, img, remove);
  }
  function renderSourceState() {
    const count = state.sources.length, s = config.sources;
    refs.thumbs.hidden = !count; refs.sourcesActions.hidden = !count;
    refs.sourcesChooseText.textContent = count ? t('sources.chooseMore') : t('sources.choose');
    refs.sourceCount.textContent = count === 0 ? t('sources.countNone') : count === 1 ? t('sources.countOne') : t('sources.count', { count });
    const level = count === 0 ? null : count < s.recommendedMin ? 'few' : count < s.good ? 'ok' : 'good';
    refs.sourceLevel.hidden = !level;
    if (level) {
      refs.sourceLevel.className = 'ilx-mosaic-count__level is-' + level;
      refs.sourceLevel.innerHTML = (level === 'few' ? ICONS.alert : level === 'good' ? ICONS.checkCircle : ICONS.info);
      refs.sourceLevel.append(el('span', { text: t('sources.level.' + level) }));
    }
    updateWaiting();
    updateTileControl(); // more photos can need more (smaller) tiles
    emitChange();
  }
  function removeSource(asset, button) {
    const index = state.sources.indexOf(asset);
    if (index < 0) return;
    // Keep keyboard focus on the list: move to the next (or previous) remove button.
    const item = button.closest('li');
    const neighbour = item.nextElementSibling || item.previousElementSibling;
    state.sources.splice(index, 1);
    item.remove();
    if (!state.result || !state.result.sources.includes(asset)) releaseSource(asset);
    state.needsRender = true;
    renderSourceState();
    (neighbour ? neighbour.querySelector('button') : refs.sourcesChoose).focus();
    announce(t('sources.removed', { name: asset.name }) + ' ' + refs.sourceCount.textContent);
    scheduleRender();
  }
  async function removeAllSources() {
    const count = state.sources.length;
    const ok = await confirmDialog({ title: t('sources.removeAll'), body: t('sources.removeAllConfirm', { count }), ok: t('sources.removeAllYes'), cancel: t('sources.removeAllNo') });
    if (!ok) return;
    for (const asset of state.sources) if (!state.result || !state.result.sources.includes(asset)) releaseSource(asset);
    state.sources = []; refs.thumbs.replaceChildren(); refs.importReport.hidden = true;
    state.needsRender = true;
    renderSourceState();
    refs.sourcesChoose.focus();
    announce(t('sources.removedAll'));
    scheduleRender();
  }
  function reportImport(rejected, duplicates, overflow) {
    const box = refs.importReport;
    box.replaceChildren();
    if (overflow) box.append(el('p', { text: t('sources.maxReached', { max: config.sources.maxCount, count: overflow }) }));
    if (duplicates.length) box.append(el('p', { text: duplicates.length === 1 ? t('sources.duplicatesOne') : t('sources.duplicates', { count: duplicates.length }) }));
    if (rejected.length) {
      box.append(el('p', { class: 'ilx-mosaic-note__lead', text: rejected.length === 1 ? t('sources.rejectedOne') : t('sources.rejectedTitle', { count: rejected.length }) }));
      const items = rejected.map(r => el('li', { text: r.name + ': ' + errorText({ code: r.code }) }));
      const list = el('ul'), limit = 5;
      list.append(...items.slice(0, limit));
      box.append(list);
      if (items.length > limit) {
        const more = el('button', { type: 'button', class: 'ilx-mosaic-link', text: t('sources.showMore'), 'aria-expanded': 'false' });
        more.addEventListener('click', () => {
          const expanded = more.getAttribute('aria-expanded') !== 'true';
          more.setAttribute('aria-expanded', String(expanded));
          list.replaceChildren(...(expanded ? items : items.slice(0, limit)));
          more.textContent = expanded ? t('sources.showLess') : t('sources.showMore');
        });
        box.append(more);
      }
    }
    box.hidden = !box.childNodes.length;
  }
  async function addSources(files) {
    if (state.importing) return;
    clearErrors(2);
    const room = Math.max(0, config.sources.maxCount - state.sources.length);
    const accepted = files.slice(0, room), overflow = files.length - accepted.length;
    if (!accepted.length) { reportImport([], [], overflow); return; }
    const controller = new AbortController();
    state.importing = controller;
    refs.importProgress.hidden = false;
    const progress = (done, total) => {
      refs.importText.textContent = t('sources.importing', { done, total });
      setProgress(refs.importFill, refs.importBar, done / total * 100);
    };
    progress(0, accepted.length);
    let added = 0;
    try {
      const outcome = await importSources(accepted, {
        config: config.sources, signal: controller.signal, lowMemory: device.lowMemory,
        knownHashes: new Set(state.sources.map(s => s.hash)), onProgress: progress
      });
      if (outcome.aborted) { show(refs.importReport, t('sources.importStopped'), 'warning'); announce(t('sources.importStopped')); return; }
      state.sources.push(...outcome.assets);
      refs.thumbs.append(...outcome.assets.map(thumbFor));
      added = outcome.assets.length;
      if (added) state.needsRender = true;
      reportImport(outcome.rejected, outcome.duplicates, overflow);
      if (state.sources.length >= config.sources.hardMin) clearErrors(2);
    } finally {
      const hadFocus = root.contains(document.activeElement) && document.activeElement === refs.importStop;
      state.importing = null;
      refs.importProgress.hidden = true;
      renderSourceState();
      if (hadFocus) refs.sourcesChoose.focus();
      if (added) announce((added === 1 ? t('sources.importDoneOne') : t('sources.importDone', { count: added })) + ' ' + refs.sourceCount.textContent);
      if (added) scheduleRender();
    }
  }
  makeDropZone(refs.sourcesDrop, addSources);
  bindFileInput(refs.sourcesInput, addSources);
  refs.sourcesChoose.addEventListener('click', () => refs.sourcesInput.click());
  refs.sourcesRemoveAll.addEventListener('click', removeAllSources);
  refs.importStop.addEventListener('click', () => state.importing?.abort());

  // ================================================================ step 3: size
  const p = config.print;
  const parse = value => Number(String(value).trim().replace(',', '.'));
  const aspect = () => state.target ? state.target.width / state.target.height : null;
  const roundCm = v => Math.round(v * 10) / 10;
  refs.widthCm.value = formatNumber(p.defaultWidthCm, 1);
  refs.heightCm.value = formatNumber(p.defaultHeightCm, 1);
  refs.lock.checked = config.lockProportions;

  function size() {
    const w = parse(refs.widthCm.value), h = parse(refs.heightCm.value);
    const valid = [w, h].every(v => Number.isFinite(v) && v >= p.minCm && v <= p.maxCm);
    return { width: valid ? normaliseCm(w, p.minCm, p.maxCm) : NaN, height: valid ? normaliseCm(h, p.minCm, p.maxCm) : NaN, valid, w, h };
  }
  let lastEdited = 'width';
  const okCm = value => Number.isFinite(value) && value >= p.minCm && value <= p.maxCm;
  /**
   * One message per mistake. With "Lås proportioner" on, the customer only types one side;
   * if that side is fine but the other (calculated) side is out of range, explain that instead.
   */
  function sizeProblems() {
    const fields = { width: [refs.widthCm, parse(refs.widthCm.value)], height: [refs.heightCm, parse(refs.heightCm.value)] };
    const invalidText = side => t(side === 'width' ? 'size.width' : 'size.height') + ': ' + t('size.invalid', { min: p.minCm, max: p.maxCm });
    if (refs.lock.checked && aspect()) {
      const typed = lastEdited, other = typed === 'width' ? 'height' : 'width';
      const [input, value] = fields[typed];
      if (!okCm(value)) return [{ input, side: typed, text: invalidText(typed) }];
      const otherValue = fields[other][1];
      if (!okCm(otherValue)) {
        return [{ input, side: typed, text: t('size.lockedTooBig', {
          side: t(other === 'width' ? 'size.sideWidth' : 'size.sideHeight'), value: formatNumber(otherValue, 1),
          min: p.minCm, max: p.maxCm }) }];
      }
      return [];
    }
    return Object.entries(fields).filter(([, [, value]]) => !okCm(value)).map(([side, [input]]) => ({ input, side, text: invalidText(side) }));
  }
  function showFieldErrors(problems) {
    for (const [input, box] of [[refs.widthCm, refs.widthError], [refs.heightCm, refs.heightError]]) {
      const problem = problems.find(pr => pr.input === input);
      input.setAttribute('aria-invalid', String(!!problem));
      box.hidden = !problem;
      box.textContent = problem ? problem.text : '';
    }
  }
  /** With "Lås proportioner" on, the other side follows the main image's shape. */
  function applyLock(changed) {
    const a = aspect();
    if (!refs.lock.checked || !a) return;
    if (changed === 'width') {
      const w = parse(refs.widthCm.value);
      if (Number.isFinite(w) && w > 0) refs.heightCm.value = formatNumber(roundCm(w / a), 1);
    } else {
      const h = parse(refs.heightCm.value);
      if (Number.isFinite(h) && h > 0) refs.widthCm.value = formatNumber(roundCm(h * a), 1);
    }
  }
  function updateSize() {
    const s = size(), locked = refs.lock.checked;
    refs.swapSize.hidden = locked;
    refs.fitWrap.hidden = locked; // shape follows the motif, so placement does not matter
    if (!s.valid) { refs.qualityInfo.textContent = ''; refs.tileInfo.textContent = ''; refs.sizeSummary.textContent = ''; return; }
    const spec = printSpec(s.width, s.height, p.dpiRule), grid = gridFor(s.width, s.height, currentLongSide());
    const tile = tileSizeCm(s.width, s.height, grid);
    refs.qualityInfo.textContent = spec.dpi >= p.dpiRule.smallDpi ? t('size.qualityHigh') : t('size.qualityNormal');
    refs.tileInfo.textContent = t('size.tile', { cm: formatNumber(Math.min(tile.x, tile.y), 1) });
    refs.sizeSummary.textContent = t('size.summary', { width: formatNumber(s.width, 1), height: formatNumber(s.height, 1) });
    updateTileControl();
  }
  for (const [input, side] of [[refs.widthCm, 'width'], [refs.heightCm, 'height']]) {
    input.addEventListener('input', () => {
      lastEdited = side;
      applyLock(side);
      state.needsRender = true;
      // Only clear errors while typing; new errors are shown on leaving the field or on "Næste".
      const problems = sizeProblems();
      if ([refs.widthCm, refs.heightCm].some(i => i.getAttribute('aria-invalid') === 'true')) showFieldErrors(problems);
      if (!problems.length) clearErrors(3);
      updateSize();
      if (!problems.length) scheduleRender(900); // a little longer: the customer may still be typing
    });
    input.addEventListener('blur', () => {
      const problems = sizeProblems();
      showFieldErrors(problems);
      if (!problems.length) { const s = size(); refs.widthCm.value = formatNumber(s.width, 1); refs.heightCm.value = formatNumber(s.height, 1); }
    });
  }
  refs.lock.addEventListener('change', () => { applyLock('width'); state.needsRender = true; showFieldErrors(sizeProblems().filter(pr => pr.input.getAttribute('aria-invalid') === 'true')); updateSize(); if (!sizeProblems().length) scheduleRender(); });
  refs.swapSize.addEventListener('click', () => {
    [refs.widthCm.value, refs.heightCm.value] = [refs.heightCm.value, refs.widthCm.value];
    state.needsRender = true; updateSize();
    announce(t('size.summary', { width: refs.widthCm.value, height: refs.heightCm.value }));
    scheduleRender();
  });

  // ================================================================ options ("Flere indstillinger")
  const presets = config.presets;
  const sliderNames = ['logoStrength', 'photoDetail', 'toneVariation'];
  const radios = name => Array.from(root.querySelectorAll('input[name="ilx-mosaic-' + name + '"]'));
  const radioValue = name => radios(name).find(r => r.checked)?.value;
  // ---------------------------------------------------------------- tile size ("Størrelse på de små billeder")
  const gridCfg = config.grid, tileCfg = config.tileSize;
  const tenth = { up: v => Math.ceil(v * 10 - 1e-9) / 10, down: v => Math.floor(v * 10 + 1e-9) / 10 };
  /** Smallest and largest tile size (cm) for the current mosaic size and number of photos. */
  function tileRange(s) {
    const long = Math.max(s.width, s.height);
    let fewest = gridCfg.min; // "even" needs at least one tile per photo
    if (radioValue('repetition') !== 'free') {
      while (fewest < gridCfg.max) { const g = gridFor(s.width, s.height, fewest); if (g.width * g.height >= state.sources.length) break; fewest++; }
    }
    const min = Math.max(tileCfg.step, tenth.up(long / gridCfg.max));
    const max = Math.max(min, Math.min(tileCfg.maxCm, tenth.down(long / fewest)));
    return { min, max, long };
  }
  /** The tile size in use: the customer's choice (kept within range) or the recommended one. */
  function currentTileCm(s) {
    const range = tileRange(s), wanted = state.tileCm ?? range.long / gridCfg.defaultLongSide;
    return { cm: Math.min(range.max, Math.max(range.min, wanted)), range };
  }
  function currentLongSide() {
    const s = size();
    if (!s.valid) return gridCfg.defaultLongSide;
    if (state.tileCm == null) return gridCfg.defaultLongSide; // untouched: the recommended grid
    const { cm, range } = currentTileCm(s);
    return Math.min(gridCfg.max, Math.max(gridCfg.min, Math.round(range.long / cm)));
  }
  function updateTileControl() {
    const s = size(), slider = refs.tileSizeSlider;
    if (!s.valid) return;
    const { cm, range } = currentTileCm(s), grid = gridFor(s.width, s.height, currentLongSide());
    slider.min = String(range.min); slider.max = String(range.max); slider.step = String(tileCfg.step);
    slider.value = String(Math.round(cm * 10) / 10);
    const text = t('tileSize.value', { cm: formatNumber(Number(slider.value), 1) });
    refs.tileSizeValue.textContent = text;
    slider.setAttribute('aria-valuetext', text);
    refs.tileSizeCount.textContent = t('tileSize.count', { cols: grid.width, rows: grid.height });
  }
  let tileTimer = 0;
  refs.tileSizeSlider.addEventListener('input', () => {
    state.tileCm = Number(refs.tileSizeSlider.value);
    state.needsRender = true;
    updateSize(); // also updates the slider text and the tile info in step 3
    // Real time: make the mosaic again shortly after the customer stops moving the slider.
    clearTimeout(tileTimer);
    tileTimer = setTimeout(() => { tileTimer = 0; if (state.result || state.step === 4) generate(); }, tileCfg.renderDelay);
  });
  function settings() {
    return {
      fit: refs.lock.checked ? 'contain' : (radioValue('fit') === 'cover' ? 'cover' : 'contain'),
      repetition: radioValue('repetition') === 'free' ? 'free' : 'even',
      longSide: currentLongSide(),
      params: {
        strength: Number(refs.logoStrengthSlider.value) / 100,
        detail: Number(refs.photoDetailSlider.value) / 100,
        originalColour: Number(refs.toneVariationSlider.value) / 100
      }
    };
  }
  function syncRadiosFromSlider(name) {
    const value = Number(refs[name + 'Slider'].value);
    refs[name + 'Value'].textContent = String(value);
    for (const radio of radios(name)) radio.checked = presets[name][radio.value] === value;
  }
  function markStale() {
    if (workspace) { scheduleRender(); return; } // one screen: just update the picture
    if (!state.result) return;
    state.stale = true;
    refs.staleNote.hidden = false; refs.updateButtonBottom.hidden = false;
    updateContinue();
  }
  if (refs.optionsToggle) disclosure(refs.optionsToggle, refs.optionsBody, open => { bridge.refresh(); if (open) refs.optionsBody.querySelector('input')?.focus(); });
  disclosure(refs.expertToggle, refs.expertBody, () => bridge.refresh());
  for (const name of sliderNames) {
    for (const radio of radios(name)) radio.addEventListener('change', () => {
      refs[name + 'Slider'].value = String(presets[name][radio.value]);
      syncRadiosFromSlider(name);
      markStale();
    });
    refs[name + 'Slider'].addEventListener('input', () => { syncRadiosFromSlider(name); markStale(); });
  }
  for (const name of ['repetition', 'fit']) for (const radio of radios(name)) radio.addEventListener('change', () => { updateTileControl(); markStale(); });
  refs.rawToggle.addEventListener('change', () => viewer.setRaw(refs.rawToggle.checked));
  refs.resetSettings.addEventListener('click', () => {
    refs.logoStrengthSlider.value = String(config.tone.logoStrength);
    refs.photoDetailSlider.value = String(config.tone.photoDetail);
    refs.toneVariationSlider.value = String(config.tone.toneVariation);
    state.tileCm = null;
    sliderNames.forEach(syncRadiosFromSlider);
    for (const r of radios('repetition')) r.checked = r.value === config.repetition;
    for (const r of radios('fit')) r.checked = r.value === config.targetFit;
    updateSize(); markStale();
  });
  sliderNames.forEach(syncRadiosFromSlider);

  // ================================================================ step 4: generate
  function enterResultStep() {
    if (!engineSupported()) { refs.unsupported.hidden = false; return; }
    if (state.needsRender || !state.result) generate();
    else updateContinue();
  }

  async function generate() {
    const s = size(), chosen = settings();
    if (!state.target || state.sources.length < config.sources.hardMin || !s.valid) return null;
    const grid = gridFor(s.width, s.height, chosen.longSide), cells = grid.width * grid.height;
    refs.renderError.hidden = true; refs.retry.hidden = true;
    if (chosen.repetition === 'even' && state.sources.length > cells) {
      show(refs.renderError, errorText({ code: 'too-many-for-grid' }, { cells, photos: state.sources.length })); refs.retry.hidden = false; return null;
    }
    if (!fitsInMemory(cells, state.sources.length, config)) {
      show(refs.renderError, errorText({ code: 'too-much-memory' })); refs.retry.hidden = false; return null;
    }
    engine.cancelPrint();
    inspector.close();
    state.rendering = true;
    // A new mosaic: the progress box above. An update of a mosaic on screen: a small box over the
    // mosaic, so nothing on the page moves while the customer changes a setting.
    const updating = !!state.result;
    refs.working.hidden = updating;
    refs.updating.hidden = !updating;
    refs.updatingText.textContent = t('generate.updating', { percent: 0 });
    refs.result.hidden = !state.result;
    setProgress(refs.renderFill, refs.renderBar, 0);
    refs.renderText.textContent = '';
    bridge.refresh();
    try {
      const result = await engine.render({
        target: state.target, sources: state.sources, grid, fit: chosen.fit, params: chosen.params, repetition: chosen.repetition
      }, (stage, value) => {
        setProgress(refs.renderFill, refs.renderBar, value);
        refs.updatingText.textContent = t('generate.updating', { percent: Math.round(value) });
        const label = t('generate.stages.' + stage);
        if (!label.startsWith('generate.')) refs.renderText.textContent = label + ' …';
      });
      if (!result) return null; // cancelled or superseded
      result.size = { widthCm: s.width, heightCm: s.height };
      const previous = state.result;
      state.result = result; state.needsRender = false; state.stale = false;
      if (previous) for (const asset of previous.sources) if (!state.sources.includes(asset)) releaseSource(asset);
      refs.staleNote.hidden = true; refs.updateButtonBottom.hidden = true;
      refs.result.hidden = false; refs.continueStatus.hidden = true;
      viewer.setResult(result);
      emitChange();
      const d = result.diagnostics;
      refs.readyText.textContent = t('generate.ready') + ' ' + t('generate.readyDetail', { used: d.usedSources, cells: d.totalCells })
        + (d.zeroTileSources && d.repetition === 'free' ? ' ' + t('generate.unused', { count: d.zeroTileSources }) : '');
      announce(refs.readyText.textContent);
      return result;
    } catch (error) {
      show(refs.renderError, errorText(error, { cells, photos: state.sources.length }));
      refs.retry.hidden = false;
      announce(refs.renderError.textContent);
      return null;
    } finally {
      if (!engine.busy) { state.rendering = false; refs.working.hidden = true; refs.updating.hidden = true; }
      updateWaiting();
      updateContinue();
      bridge.refresh();
    }
  }
  refs.cancel.addEventListener('click', () => {
    engine.cancel();
    state.rendering = false; refs.working.hidden = true; refs.updating.hidden = true;
    show(refs.renderError, t('generate.cancelled'), 'warning');
    refs.retry.hidden = false;
    refs.retryButton.focus();
  });
  refs.retryButton.addEventListener('click', () => { generate(); });
  for (const button of [refs.updateButton, refs.updateButtonBottom]) {
    button.addEventListener('click', async () => {
      const result = await generate();
      // Show the updated mosaic; focus its status so screen readers hear the result.
      if (result) { refs.readyNote.setAttribute('tabindex', '-1'); scrollToTopOf(refs.readyNote); refs.readyNote.focus({ preventScroll: true }); }
    });
  }

  async function applyFill(asset, mode, hex) {
    await setSourceFill(asset, mode, hex, config.sources);
    const thumb = root.querySelector('.ilx-mosaic-thumb[data-id="' + asset.id + '"] img');
    if (thumb) thumb.src = asset.thumbUrl;
    inspector.close();
    const result = await generate();
    if (!result) return;
    const index = result.sources.indexOf(asset), cell = index >= 0 ? result.assignments.indexOf(index) : -1;
    if (cell >= 0) inspector.open(cell);
  }

  // ================================================================ continue to the product
  // The customer cannot download the mosaic here. "Fortsæt til produkt" will later hand the
  // preview to the product page in the shop; until then it shows a short "coming soon" message.
  function updateContinue() {
    const result = state.result;
    if (!result) return;
    refs.continueHelp.textContent = t('next.help', { width: formatNumber(result.size.widthCm, 1), height: formatNumber(result.size.heightCm, 1) });
  }
  function blockedContinue() {
    if (workspace && (state.rendering || renderTimer)) { show(refs.continueStatus, t('workspace.wait'), 'warning'); return true; }
    if (state.rendering || !state.result) return true;
    if (state.stale) { show(refs.continueStatus, t('next.stale'), 'warning'); refs.updateButton.focus(); return true; }
    return false;
  }
  refs.continueButton.addEventListener('click', () => {
    if (blockedContinue()) return;
    show(refs.continueStatus, t('next.soon'), 'info');
    announce(t('next.soon'));
  });

  // ================================================================ start over
  refs.startOver.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: t('steps.startOver'), body: t('steps.startOverConfirm'), ok: t('steps.startOverYes'), cancel: t('steps.startOverNo') });
    if (!ok) return;
    engine.cancel(); engine.cancelPrint(); inspector.close(); viewer.exitFullscreen();
    clearTimeout(renderTimer); renderTimer = 0;
    for (const asset of state.sources) releaseSource(asset);
    if (state.result) for (const asset of state.result.sources) releaseSource(asset);
    state.sources = []; refs.thumbs.replaceChildren(); refs.importReport.hidden = true;
    viewer.clear(); state.result = null; state.stale = false; emitChange(); refs.result.hidden = true; refs.staleNote.hidden = true;
    clearTarget();
    renderSourceState();
    state.maxStep = 1; state.step = 1;
    goTo(1);
  });

  // ================================================================ start
  if (!engineSupported()) refs.unsupported.hidden = false;
  renderSourceState();
  updateStepNav();
  updateSize();
  updateWaiting();
  bridge.refresh();

  return {
    /** Small read-only handle for QA and browser tests. */
    get state() {
      return {
        step: state.step, target: !!state.target, sources: state.sources.length, rendering: state.rendering,
        result: state.result && { grid: [state.result.gridWidth, state.result.gridHeight], counts: state.result.counts.slice(), diagnostics: state.result.diagnostics }
      };
    },
    goTo, generate, addSources, setTarget, layout
  };
}
