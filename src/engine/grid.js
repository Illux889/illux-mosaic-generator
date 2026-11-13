/**
 * Illux Mosaik — print size, DPI and grid geometry. Pure functions (unit tested).
 */

const CM_PER_INCH = 2.54;

/** Clamp a centimetre value into the allowed range; NaN means "invalid". */
export function normaliseCm(value, min, max) {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}

/**
 * The DPI rule: 250 DPI when BOTH sides are at most 70 cm, otherwise 150 DPI.
 * (Thresholds come from CONFIG.print.dpiRule.)
 */
export function dpiFor(widthCm, heightCm, rule) {
  return widthCm <= rule.thresholdCm && heightCm <= rule.thresholdCm ? rule.smallDpi : rule.largeDpi;
}

/** Print file specification for a chosen size. */
export function printSpec(widthCm, heightCm, rule) {
  const dpi = dpiFor(widthCm, heightCm, rule);
  const width = Math.max(1, Math.round(widthCm / CM_PER_INCH * dpi));
  const height = Math.max(1, Math.round(heightCm / CM_PER_INCH * dpi));
  return { widthCm, heightCm, dpi, width, height, megapixels: width * height / 1e6 };
}

/**
 * Grid that follows the print format: `longSide` tiles along the longer side,
 * the shorter side rounded so the tiles stay (almost) square.
 */
export function gridFor(widthCm, heightCm, longSide) {
  const n = Math.max(1, Math.round(longSide));
  if (widthCm >= heightCm) {
    return { width: n, height: Math.max(1, Math.round(n * heightCm / widthCm)) };
  }
  return { width: Math.max(1, Math.round(n * widthCm / heightCm)), height: n };
}

/** Physical size of one tile in centimetres (horizontal, vertical). */
export function tileSizeCm(widthCm, heightCm, grid) {
  return { x: widthCm / grid.width, y: heightCm / grid.height };
}

/** How many tiles each photo gets with equal shares: { base, extra } (extra photos get base + 1). */
export function equalShares(cells, photos) {
  if (!photos) return { base: 0, extra: 0 };
  return { base: Math.floor(cells / photos), extra: cells % photos };
}
