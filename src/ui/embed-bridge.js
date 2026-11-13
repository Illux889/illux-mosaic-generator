/**
 * Illux Mosaik — iframe side of the parent-page protocol.
 *
 * To the parent (only to an allowed origin, never '*'):
 *   { type: 'illux-mosaic-ready' }
 *   { type: 'illux-mosaic-height', height }   whenever the content height changes
 *   { type: 'illux-mosaic-modal', open }      dialog / pseudo-fullscreen opened or closed
 *   { type: 'illux-mosaic-scroll', top }      please scroll so this point of the app is at the top (step changes)
 * From the parent (accepted only from window.parent AND the verified origin):
 *   { type: 'illux-mosaic-viewport', top, height }  the part of the iframe the visitor can see
 */
export function createEmbedBridge(root, config) {
  const names = config.messages;
  const embedded = window.parent && window.parent !== window;
  const allowed = new Set([...config.allowedParentOrigins, location.origin]);
  const listeners = new Set();
  let viewport = null, lastHeight = 0, frame = 0, modalCount = 0;

  function detectParentOrigin() {
    if (!embedded) return null;
    // ancestorOrigins is the reliable source (Chromium, Safari); referrer is the fallback (Firefox).
    let origin = null;
    try { if (location.ancestorOrigins && location.ancestorOrigins.length) origin = location.ancestorOrigins[0]; } catch (_) {}
    if (!origin && document.referrer) { try { origin = new URL(document.referrer).origin; } catch (_) {} }
    return origin;
  }
  function isAllowed(origin) {
    if (allowed.has(origin)) return true;
    // Local development only: when the app itself runs on localhost, a local test parent may embed it.
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
    return local.test(location.origin) && local.test(origin);
  }
  const detectedOrigin = detectParentOrigin();
  const parentOrigin = detectedOrigin && isAllowed(detectedOrigin) ? detectedOrigin : null;
  const active = !!parentOrigin;
  /**
   * Some hosts (GitHub Pages) cannot send a frame-ancestors header, so the app
   * enforces it itself: embedded on a site that is known and NOT allowed -> refuse to run.
   * (If the parent cannot be determined at all, the app runs but sends no messages.)
   */
  const blocked = !!(embedded && detectedOrigin && !parentOrigin);

  function post(type, data = {}) {
    if (!active) return;
    window.parent.postMessage({ type, ...data }, parentOrigin);
  }

  function measure() {
    frame = 0;
    // The body's own box (not the document's scrollHeight, which never shrinks below the
    // iframe's current height) = everything the page needs, including padding and margins.
    const body = document.body.getBoundingClientRect();
    const height = Math.ceil(Math.max(body.bottom, root.getBoundingClientRect().bottom) + window.scrollY
      + (parseFloat(getComputedStyle(document.body).marginBottom) || 0));
    if (Math.abs(height - lastHeight) >= 1) { lastHeight = height; post(names.height, { height }); }
  }
  // A timer, not requestAnimationFrame: browsers pause animation frames in off-screen
  // cross-origin iframes, which would leave the parent with a stale height.
  function scheduleMeasure() { if (active && !frame) frame = setTimeout(measure, 60); }

  if (active) {
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scheduleMeasure).observe(root);
    // Fallback: ResizeObserver is silent while the frame is not being painted (off-screen,
    // background tab). A cheap periodic check keeps the parent's height right regardless.
    setInterval(scheduleMeasure, 1000);
    window.addEventListener('load', scheduleMeasure);
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      const data = event.data;
      if (!data || data.type !== names.viewport) return;
      const top = Number(data.top), height = Number(data.height);
      if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return;
      viewport = { top: Math.max(0, top), height: Math.max(120, height) };
      root.style.setProperty('--ilx-visible-top', viewport.top + 'px');
      root.style.setProperty('--ilx-visible-height', viewport.height + 'px');
      for (const listener of listeners) listener(viewport);
    });
    post(names.ready);
    scheduleMeasure();
  }

  return {
    embedded, active, blocked,
    /** Visible part of the app: from the parent when embedded, else the window. */
    visibleViewport() {
      if (active && viewport) return viewport;
      return { top: 0, height: window.innerHeight };
    },
    onViewport(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** Ask the parent page to bring a point of the app (px from the app's top) into view. */
    scrollTo(top) { post(names.scroll, { top: Math.max(0, Math.round(top)) }); },
    /** Reference-counted, so nested dialogs keep the parent locked until the last one closes. */
    modal(open) {
      modalCount = Math.max(0, modalCount + (open ? 1 : -1));
      post(names.modal, { open: modalCount > 0 });
    },
    refresh: scheduleMeasure
  };
}
