/**
 * Illux Mosaik — tiny translation helper.
 * t('upload.count', { count: 3 }) -> "3 billeder"
 * Language: ?lang=xx in the URL, otherwise CONFIG.defaultLanguage.
 */
import da from './da.js';

const LANGUAGES = { da };
let strings = da;

export function setLanguage(code) {
  strings = LANGUAGES[code] || da;
  return strings;
}

export function languageFromUrl(fallback) {
  try {
    const code = new URLSearchParams(location.search).get('lang');
    return code && LANGUAGES[code] ? code : fallback;
  } catch (_) { return fallback; }
}

export function locale() { return strings.locale; }

/** Look up a dotted key and return the raw value (string, array or object). */
export function raw(key) {
  const find = source => key.split('.').reduce((node, part) => node == null ? node : node[part], source);
  const value = find(strings);
  return value == null ? find(da) : value;
}

/** Look up a dotted key and fill {placeholders}. Numbers are formatted for the locale. */
export function t(key, vars = {}) {
  let value = key.split('.').reduce((node, part) => node == null ? node : node[part], strings);
  if (value == null) value = key.split('.').reduce((node, part) => node == null ? node : node[part], da);
  if (typeof value !== 'string') return key;
  return value.replace(/\{(\w+)\}/g, (match, name) => {
    if (!(name in vars)) return match;
    const v = vars[name];
    return typeof v === 'number' ? formatNumber(v) : String(v);
  });
}

export function formatNumber(value, digits = 0) {
  return Number(value).toLocaleString(strings.locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
