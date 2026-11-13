/**
 * Illux Mosaik — every default and limit in one place.
 * Change values here; nothing else in the app hard-codes them.
 */
function deepFreeze(object) {
  for (const value of Object.values(object)) if (value && typeof value === 'object') deepFreeze(value);
  return Object.freeze(object);
}

export const CONFIG = deepFreeze({
  /** Default UI language. Others can be chosen with ?lang=no / ?lang=sv once their files exist. */
  defaultLanguage: 'da',

  /**
   * Pages allowed to embed this app and receive its postMessage events.
   * The app's own origin is always allowed too (for the local test page).
   * Add the NO/SE shop domains here when the generator goes live there.
   */
  allowedParentOrigins: ['https://www.illux.dk', 'https://illux.dk'],
  /** Where a visitor is sent if the app is embedded on a site that is not allowed. */
  homeUrl: 'https://www.illux.dk/',

  /**
   * Watermark over the on-screen mosaic (never on the print file): the white ILLUX logo.
   * The text is only drawn until the logo has loaded, or if it cannot load.
   */
  watermark: { image: new URL('./assets/illux-logo-hvid.png', import.meta.url).href, text: 'ILLUX A/S', opacity: 0.3 },

  /** Print size: chosen freely by the customer, in centimetres. */
  print: {
    defaultWidthCm: 50,
    defaultHeightCm: 70,
    minCm: 10,
    maxCm: 300,
    /** DPI rule: 250 DPI when both sides are <= thresholdCm, otherwise 150 DPI. */
    dpiRule: { thresholdCm: 70, smallDpi: 250, largeDpi: 150 },
    /** JPEG quality of the print file (0-1). */
    jpegQuality: 0.95
  },

  /** Mosaic grid: number of tiles along the LONGEST side; the other side follows the print format. */
  grid: { defaultLongSide: 140, min: 25, max: 160 },

  /**
   * "Størrelse på de små billeder" next to the mosaic: the customer sets the tile size in cm and the
   * mosaic updates by itself. The range follows the mosaic size (grid.min-grid.max tiles on the long
   * side) and is at most maxCm, so the main image always stays visible.
   */
  tileSize: { maxCm: 5, step: 0.1, renderDelay: 450 },

  /** Tone settings (0-100), same defaults as the original engine's live settings. */
  tone: { logoStrength: 100, photoDetail: 100, toneVariation: 0 },

  /**
   * The plain-language choices under "Flere indstillinger" set these values.
   * The expert sliders can still set any value; then no choice is shown as selected.
   * Keys match the texts in i18n (options.<setting>.choices.<key>).
   */
  presets: {
    logoStrength: { low: 40, medium: 70, high: 100 },
    photoDetail: { calm: 30, medium: 65, clear: 100 },
    toneVariation: { target: 0, some: 40, own: 80 }
  },

  /** "Lås proportioner" is on by default: the mosaic gets the main image's shape. */
  lockProportions: true,

  /** 'contain' = whole image + extended background, 'cover' = cropped close-up. */
  targetFit: 'contain',

  /** 'even' = all photos used equally and spread apart, 'free' = best fit per tile. */
  repetition: 'even',

  /** Seed for the deterministic spreading pass (same input -> same mosaic). */
  seed: 20260907,

  sources: {
    /** Below this a warning is shown (the mosaic will repeat each photo a lot). */
    recommendedMin: 50,
    /** At or above this the count is shown as "good". */
    good: 200,
    /** Hard minimum to be able to generate. */
    hardMin: 2,
    maxCount: 1000,
    maxFileBytes: 40 * 1024 * 1024,
    maxMegapixels: 80,
    /** Images whose shorter side is below this are rejected as too small. */
    minSidePx: 80,
    /** Stored copy of each photo: longest side in px (enough for zoom and print tiles). */
    storeMaxPx: 1024,
    storeJpegQuality: 0.9,
    thumbPx: 160,
    /** Parallel decodes while importing (lower on phones to save memory). */
    concurrency: 4,
    concurrencyLowMemory: 2
  },

  target: {
    maxFileBytes: 40 * 1024 * 1024,
    maxMegapixels: 80,
    minSidePx: 200,
    /** The target is kept as a canvas whose longest side is at most this. */
    workingMaxPx: 2600
  },

  engine: {
    /** Pixels per tile in the on-screen overview (and in the target analysis). */
    overviewTilePx: 16,
    /**
     * The matcher keeps a cost table of (tiles x photos) numbers. Above these
     * sizes the browser is likely to run out of memory, so we stop early with
     * a clear message instead of crashing the tab.
     */
    maxCostEntries: 30_000_000,
    maxCostEntriesLowMemory: 12_000_000
  },

  viewer: {
    maxZoom: 40,
    detailBudgetBytes: 64 * 1024 * 1024,
    /** Detail tiles are requested once a tile is bigger than this on screen (device px). */
    detailMinCellPx: 42,
    /** Settings changes re-render automatically after this pause (ms). */
    autoRerenderDelay: 400
  },

  memory: {
    /** Ask for confirmation before print exports larger than this (megapixels). */
    printWarnMegapixels: 50,
    /** Paint the print in one canvas up to this size; above it, stream it row by row. */
    printCanvasMaxMegapixels: 60,
    /** iOS/iPadOS Safari canvas area limit (about 16.7 MP): always stream there. */
    iosCanvasMaxMegapixels: 16
  },

  /** postMessage event names exchanged with the parent page. */
  messages: {
    height: 'illux-mosaic-height',
    modal: 'illux-mosaic-modal',
    ready: 'illux-mosaic-ready',
    scroll: 'illux-mosaic-scroll',
    viewport: 'illux-mosaic-viewport'
  }
});
