/**
 * Illux Mosaik — entry point. Mounts the app into every [data-ilx-mosaic-root]
 * element (normally exactly one). To render inside a Shopware template later,
 * include the two stylesheets, this module, and that root element.
 */
import { mountMosaicApp } from './ui/app.js';

const roots = document.querySelectorAll('[data-ilx-mosaic-root]');
const apps = Array.from(roots, root => mountMosaicApp(root));
// Read-only handle for QA / browser tests.
window.illuxMosaic = apps[0];
