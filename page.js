/**
 * Illux Mosaik — landing page behaviour.
 * - Mounts the generator in the "Lav din mosaik" section.
 * - "Prøv med eksempelbilleder": loads the demo set (demo/) into the generator and makes a mosaic.
 * - Theme filter for the ideas (toggle buttons with aria-pressed and a polite status message).
 * Works without this script too: the ideas are all visible, and the filter and demo stay hidden.
 */
import { mountMosaicApp } from './src/ui/app.js';

const DEMO_PHOTOS = 48;

// ------------------------------------------------------------------ generator
const root = document.querySelector('[data-ilx-mosaic-root]');
const app = root ? mountMosaicApp(root) : null;
// Read-only handle for local QA (tests/browser/fixtures.js); not on the live site.
if (['localhost', '127.0.0.1'].includes(location.hostname)) window.illuxMosaic = app;

// ------------------------------------------------------------------ demo images
const demo = document.querySelector('[data-demo]');
if (app && demo) {
  const button = demo.querySelector('[data-demo-button]');
  const status = demo.querySelector('[data-demo-status]');
  let busy = false;

  async function file(url, name) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(url + ': ' + response.status);
    const blob = await response.blob();
    return new File([blob], name, { type: blob.type || 'image/jpeg', lastModified: Date.now() });
  }

  button.addEventListener('click', async () => {
    if (busy) return;
    if (app.state.sources > 0 || app.state.target) {
      // Never mix the demo with the customer's own photos.
      status.textContent = 'Du har allerede valgt billeder. Brug "Start forfra" nederst i værktøjet, hvis du vil prøve med eksempelbillederne.';
      return;
    }
    busy = true;
    button.setAttribute('aria-disabled', 'true');
    status.textContent = 'Henter eksempelbillederne …';
    try {
      const names = Array.from({ length: DEMO_PHOTOS }, (_, i) => 'foto-' + String(i + 1).padStart(2, '0') + '.jpg');
      const [target, ...photos] = await Promise.all([
        file('demo/hovedbillede.jpg', 'mops.jpg'),
        ...names.map(name => file('demo/fotos/' + name, name))
      ]);
      await app.setTarget(target);
      await app.addSources(photos);
      status.textContent = 'Eksempelbillederne er klar. Mosaikken bliver lavet nu.';
      app.goTo(4);
    } catch (error) {
      status.textContent = 'Eksempelbillederne kunne ikke hentes. Tjek din internetforbindelse, og prøv igen.';
      console.error(error);
    } finally {
      busy = false;
      button.removeAttribute('aria-disabled');
    }
  });
  demo.hidden = false;
}

// ------------------------------------------------------------------ ideas filter
const filters = document.querySelector('[data-filters]');
const ideas = Array.from(document.querySelectorAll('[data-ideas] > [data-category]'));
const filterStatus = document.querySelector('[data-filter-status]');
if (filters && ideas.length) {
  const buttons = Array.from(filters.querySelectorAll('[data-filter]'));
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const theme = button.dataset.filter;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
      let shown = 0;
      for (const idea of ideas) {
        idea.hidden = theme !== 'alle' && idea.dataset.category !== theme;
        if (!idea.hidden) shown++;
      }
      filterStatus.textContent = shown === 1 ? 'Viser 1 idé.' : 'Viser ' + shown + ' idéer.';
    });
  }
  filters.hidden = false;
}

// ------------------------------------------------------------------ image lock
// The example mosaics on the page cannot be saved with right-click, long-press or dragging.
for (const image of document.querySelectorAll('.ilx-v2-hero img, #foer-og-efter img, .ilx-v2-example img')) {
  image.draggable = false;
  image.addEventListener('contextmenu', event => event.preventDefault());
}
