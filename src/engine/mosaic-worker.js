/*
 * Illux Mosaik — mosaic worker (classic worker script).
 *
 * Port of photoMosaicWorker from the original admin tool (admin v26). The
 * matching maths are unchanged: Oklab descriptors (mean light, colour,
 * contrast and a 4x4 light/dark pattern), descriptor distance, a capacity-
 * constrained epsilon auction, the neighbour-spreading swap pass and the per-
 * photo tone curve. Removed: amount-based weights, overlay-blocked cells,
 * variants that were never used, and all server/payment concepts.
 *
 * Changes:
 * - "even" repetition: every source photo gets an equal share (Hamilton with
 *   equal weights) and repeats are spread apart (original behaviour).
 * - "free" repetition: no quotas; each tile takes its best-fitting photo, with
 *   the same neighbour penalty discouraging identical neighbours.
 * - The target arrives as ONE transferred pixel buffer (gridWidth*tileSize x
 *   gridHeight*tileSize) instead of thousands of cloned 40 px tiles.
 *
 * In:  { type: 'render', gridWidth, gridHeight, tileSize, target: {width, height, pixels},
 *        sources: [{ rgba }], params: { strength, detail, originalColour },
 *        repetition: 'even' | 'free', seed, outScale }
 * Out: { type: 'progress', stage, value }
 *      { type: 'complete', ... }  |  { type: 'error', code, message }
 */
'use strict';

const S = 40, BLOCKS = 4, SUB = BLOCKS * BLOCKS, STRIDE = 263, TOP_K = 8;
let W = 100, H = 140, CELLS = W * H, OUT = 16;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const progress = (stage, value) => self.postMessage({ type: 'progress', stage, value });
const fail = (code, message) => { const e = Error(message || code); e.code = code; return e; };

const linear = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  linear[i] = c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
}

function randomGenerator(seed) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Oklab descriptor of a size x size square read from an RGBA buffer with the
 * given row stride (in pixels). Identical to the original describe() when the
 * square is the whole buffer.
 */
function describe(rgba, size, stride = size, x0 = 0, y0 = 0) {
  const plane = new Float32Array(size * size * 3);
  const blocks = new Float32Array(SUB * 3);
  const mean = [0, 0, 0];
  const histogram = new Float32Array(256);
  let sumSq = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, p = ((y0 + y) * stride + x0 + x) * 4;
    const r = linear[rgba[p]], g = linear[rgba[p + 1]], b = linear[rgba[p + 2]];
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
    const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
    const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    const L = .2104542553 * l + .793617785 * m - .0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s;
    const bb = .0259040371 * l + .7827717662 * m - .808675766 * s;
    plane[i * 3] = L; plane[i * 3 + 1] = a; plane[i * 3 + 2] = bb;
    mean[0] += L; mean[1] += a; mean[2] += bb; sumSq += L * L;
    histogram[clamp(Math.round(L * 255), 0, 255)]++;
    const block = (Math.floor(y * BLOCKS / size) * BLOCKS + Math.floor(x * BLOCKS / size)) * 3;
    blocks[block] += L; blocks[block + 1] += a; blocks[block + 2] += bb;
  }
  const count = size * size;
  for (let i = 0; i < 3; i++) mean[i] /= count;
  for (let i = 0; i < blocks.length; i++) blocks[i] /= count / SUB;
  for (let i = 0; i < 256; i++) histogram[i] /= count;
  let spatialVariance = 0;
  for (let i = 0; i < SUB; i++) spatialVariance += Math.pow(blocks[i * 3] - mean[0], 2);
  return { plane, blocks, mean, histogram, std: Math.sqrt(Math.max(0, sumSq / count - mean[0] ** 2)), spatialStd: Math.sqrt(spatialVariance / SUB) };
}

/** Largest-remainder allocation of `total` cells by weight. */
function hamilton(weights, total) {
  if (!weights.length || weights.some(w => !Number.isFinite(w) || w < 0)) throw fail('invalid-weights');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || !Number.isFinite(sum)) throw fail('invalid-weights');
  const exact = weights.map(w => w / sum * total);
  const counts = exact.map(Math.floor);
  const order = exact.map((q, i) => ({ i, r: q - counts[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
  const left = total - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < left; i++) counts[order[i].i]++;
  return counts;
}

/** Descriptor distance: colour AND the internal light/dark arrangement. */
function score(source, target) {
  const dL = source.mean[0] - target.mean[0];
  const da = source.mean[1] - target.mean[1], db = source.mean[2] - target.mean[2];
  let structural = 0, chromaticStructure = 0;
  const gain = clamp(target.spatialStd / Math.max(.035, source.spatialStd), .55, 1.3);
  for (let k = 0; k < SUB; k++) {
    const p = k * 3;
    const delta = (source.blocks[p] - source.mean[0]) * gain - (target.blocks[p] - target.mean[0]);
    structural += delta * delta;
    const ac = (source.blocks[p + 1] - source.mean[1]) * .75 - (target.blocks[p + 1] - target.mean[1]);
    const bc = (source.blocks[p + 2] - source.mean[2]) * .75 - (target.blocks[p + 2] - target.mean[2]);
    chromaticStructure += ac * ac + bc * bc;
  }
  const edgeWeight = 1 + Math.min(2, target.spatialStd * 12);
  return 1.7 * dL * dL + 4 * (da * da + db * db)
    + 8 * edgeWeight * structural / SUB + 2 * chromaticStructure / SUB
    + .08 * Math.pow(Math.max(0, source.std - .23), 2);
}

/** Capacity-constrained epsilon auction: source d receives exactly quotas[d] cells. */
function auction(cost, D, quotas) {
  const owners = new Int32Array(CELLS).fill(-1);
  const prices = new Float64Array(CELLS);
  const slotSource = new Int32Array(CELLS);
  const heaps = [];
  let slot = 0;
  for (let d = 0; d < D; d++) {
    const heap = [];
    for (let j = 0; j < quotas[d]; j++) { heap.push(slot); slotSource[slot++] = d; }
    heaps.push(heap);
  }
  if (slot !== CELLS) throw fail('quota-conservation');
  let iterations = 0;
  function sink(heap) {
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= heap.length) return;
      const right = left + 1;
      const child = right < heap.length && prices[heap[right]] < prices[heap[left]] ? right : left;
      if (prices[heap[i]] <= prices[heap[child]]) return;
      [heap[i], heap[child]] = [heap[child], heap[i]];
      i = child;
    }
  }
  for (const epsilon of [.015, .003, .0006]) {
    owners.fill(-1);
    const queue = new Int32Array(CELLS + 1);
    let head = 0, tail = 0, length = 0, stageIterations = 0;
    for (let i = 0; i < CELLS; i++) { queue[tail] = i; tail = (tail + 1) % queue.length; length++; }
    while (length) {
      const cell = queue[head]; head = (head + 1) % queue.length; length--;
      let best = Infinity, second = Infinity, winner = -1;
      const offset = cell * D;
      for (let d = 0; d < D; d++) {
        const heap = heaps[d]; if (!heap.length) continue;
        const c = cost[offset + d], value = c + prices[heap[0]];
        if (value < best) { second = best; best = value; winner = d; }
        else if (value < second) second = value;
        if (heap.length > 1) {
          const nextSlot = heap.length > 2 && prices[heap[2]] < prices[heap[1]] ? heap[2] : heap[1];
          second = Math.min(second, c + prices[nextSlot]);
        }
      }
      if (winner < 0) throw fail('no-candidate');
      const heap = heaps[winner], winningSlot = heap[0], displaced = owners[winningSlot];
      owners[winningSlot] = cell;
      prices[winningSlot] += (Number.isFinite(second) ? Math.max(0, second - best) : 0) + epsilon;
      sink(heap);
      if (displaced >= 0) { queue[tail] = displaced; tail = (tail + 1) % queue.length; length++; }
      iterations++; stageIterations++;
      if (stageIterations > Math.max(600000, CELLS * 220)) throw fail('iteration-limit');
      if (stageIterations % 10000 === 0) progress('matcher', 50 + Math.min(15, iterations / 10000));
    }
  }
  const result = new Int32Array(CELLS);
  for (let i = 0; i < CELLS; i++) result[owners[i]] = slotSource[i];
  return { assignments: result, iterations };
}

/** Neighbour lists with the original penalties: +0.030 at distance 1, +0.010 at distance 2. */
function neighbourList() {
  return Array.from({ length: CELLS }, (_, i) => {
    const x = i % W, y = Math.floor(i / W), result = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const dist = Math.abs(dx) + Math.abs(dy);
      if (!dist || dist > 2 || x + dx < 0 || x + dx >= W || y + dy < 0 || y + dy >= H) continue;
      result.push([(y + dy) * W + x + dx, dist === 1 ? .030 : .010]);
    }
    return result;
  });
}

/** Count-preserving swap pass that pulls repeats of the same photo apart. */
function spread(assignments, cost, D, seed, neighbours) {
  const random = randomGenerator(seed);
  function penalty(cell, source, except) {
    let p = 0;
    for (const [other, weight] of neighbours[cell]) if (other !== except && assignments[other] === source) p += weight;
    return p;
  }
  let swaps = 0;
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < CELLS; i++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const j = Math.floor(random() * CELLS), a = assignments[i], b = assignments[j];
        if (a === b || i === j) continue;
        const change = cost[i * D + b] + cost[j * D + a] - cost[i * D + a] - cost[j * D + b]
          + penalty(i, b, j) + penalty(j, a, i) - penalty(i, a, j) - penalty(j, b, i);
        if (change < -1e-7) { assignments[i] = b; assignments[j] = a; swaps++; }
      }
    }
    progress('spreder', 68 + pass * 1.5);
  }
  return swaps;
}

/**
 * "Free" repetition: no quotas. Every cell takes the best of its TOP_K
 * candidates, accounting for the same neighbour penalty (a few relaxation
 * passes), so a photo may be used many times but rarely right next to itself.
 */
function freeAssign(cost, D, candidates, neighbours) {
  const assignments = new Int32Array(CELLS);
  for (let c = 0; c < CELLS; c++) assignments[c] = candidates[c * TOP_K];
  let changes = 0;
  for (let pass = 0; pass < 4; pass++) {
    let changed = 0;
    for (let c = 0; c < CELLS; c++) {
      let best = Infinity, bestSource = assignments[c];
      for (let k = 0; k < TOP_K; k++) {
        const d = candidates[c * TOP_K + k]; if (d < 0) break;
        let value = cost[c * D + d];
        for (const [other, weight] of neighbours[c]) if (assignments[other] === d) value += weight;
        if (value < best - 1e-9) { best = value; bestSource = d; }
      }
      if (bestSource !== assignments[c]) { assignments[c] = bestSource; changed++; }
    }
    changes += changed;
    progress('spreder', 68 + pass * 2);
    if (!changed) break;
  }
  return { assignments, changes };
}

function makeToneCurve(source, desiredMean, detail, targetSpatialStd) {
  // Keep the source photo's own dark/light range while following the target's
  // tone. The profile is reused unchanged by the detail and print workers.
  const goalStd = Math.min(.18, .030 + detail * .100 + Math.min(.035, targetSpatialStd * .25));
  const sourceMean = clamp(source.mean[0], .02, .98);
  let slope = clamp(goalStd / Math.max(.02, source.std)
    * sourceMean * (1 - sourceMean) / Math.max(.03, desiredMean * (1 - desiredMean)), .16, 1.8);
  const logit = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const x = clamp(i / 255, .001, .999); logit[i] = Math.log(x / (1 - x));
  }
  const lut = new Float32Array(256);
  for (let round = 0; round < 3; round++) {
    let lo = -18, hi = 18;
    for (let iteration = 0; iteration < 18; iteration++) {
      const b = (lo + hi) / 2; let average = 0;
      for (let i = 0; i < 256; i++) if (source.histogram[i]) average += source.histogram[i] / (1 + Math.exp(-(slope * logit[i] + b)));
      if (average < desiredMean) lo = b; else hi = b;
    }
    const bias = (lo + hi) / 2; let variance = 0;
    for (let i = 0; i < 256; i++) {
      lut[i] = 1 / (1 + Math.exp(-(slope * logit[i] + bias)));
      variance += source.histogram[i] * (lut[i] - desiredMean) ** 2;
    }
    if (round < 2) slope = clamp(slope * goalStd / Math.max(.007, Math.sqrt(variance)), .12, 2.0);
  }
  let first = 0, last = 255;
  while (first < 255 && !source.histogram[first]) first++;
  while (last > 0 && !source.histogram[last]) last--;
  if (last > first) {
    const dark = lut[first], light = lut[last];
    for (let i = 0; i < 256; i++) lut[i] = dark + (light - dark) * (i - first) / (last - first);
  }
  return lut;
}

function rgbFromLab(L, a, b) {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
}

function gammaByte(value) {
  const v = clamp(value, 0, 1);
  return Math.round(255 * (v <= .0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - .055));
}

function render(targets, sources, assignments, params) {
  const width = W * OUT, height = H * OUT, raw = new Uint8ClampedArray(width * height * 4);
  const output = new Uint8ClampedArray(raw.length);
  for (let p = 3; p < raw.length; p += 4) { raw[p] = 255; output[p] = 255; }
  let compressedPixels = 0;
  const toneProfiles = new Float32Array(CELLS * STRIDE);
  for (let cell = 0; cell < CELLS; cell++) {
    const source = sources[assignments[cell]], desc = source.desc, target = targets[cell];
    // Mild shadow lift rather than black fill; the tonal order of the photo stays intact.
    const targetL = clamp(target.mean[0] + .035 * (1 - target.mean[0]) ** 2, .17, .93);
    const desired = mix(desc.mean[0], targetL, params.strength);
    const curve = makeToneCurve(desc, desired, params.detail, target.spatialStd);
    const colourAmount = params.strength * (1 - params.originalColour);
    const desiredA = mix(desc.mean[1], target.mean[1], colourAmount);
    const desiredB = mix(desc.mean[2], target.mean[2], colourAmount);
    const chromaGain = mix(1, .72 + params.originalColour * .28, params.strength);
    const profileOffset = cell * STRIDE;
    toneProfiles.set(curve, profileOffset);
    toneProfiles.set([desc.mean[1], desc.mean[2], desiredA, desiredB, chromaGain,
      Math.min(1, params.strength * 4), params.strength], profileOffset + 256);
    const baseX = cell % W * OUT, baseY = Math.floor(cell / W) * OUT;
    for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
      const sourceY = Math.min(S - 1, Math.floor((y + .5) * S / OUT));
      const sourceX = Math.min(S - 1, Math.floor((x + .5) * S / OUT));
      const local = sourceY * S + sourceX, src = local * 4, dst = ((baseY + y) * width + baseX + x) * 4;
      raw[dst] = source.rgba[src]; raw[dst + 1] = source.rgba[src + 1]; raw[dst + 2] = source.rgba[src + 2]; raw[dst + 3] = 255;
      // At zero strength the exact original pixels are used.
      if (params.strength <= 0) { output.set(raw.subarray(dst, dst + 4), dst); continue; }
      const t = desc.plane[local * 3] * 255, ti = clamp(Math.floor(t), 0, 255), tj = Math.min(255, ti + 1);
      const L = mix(desc.plane[local * 3], mix(curve[ti], curve[tj], t - ti), Math.min(1, params.strength * 4));
      const a = desiredA + chromaGain * (desc.plane[local * 3 + 1] - desc.mean[1]);
      const b = desiredB + chromaGain * (desc.plane[local * 3 + 2] - desc.mean[2]);
      let rgb = rgbFromLab(L, a, b);
      if (rgb.some(c => c < 0 || c > 1)) {
        compressedPixels++; let lower = 0, upper = 1;
        for (let k = 0; k < 7; k++) {
          const mid = (lower + upper) / 2, candidate = rgbFromLab(L, a * mid, b * mid);
          if (candidate.some(c => c < 0 || c > 1)) upper = mid; else lower = mid;
        }
        rgb = rgbFromLab(L, a * lower, b * lower);
      }
      output[dst] = gammaByte(rgb[0]); output[dst + 1] = gammaByte(rgb[1]); output[dst + 2] = gammaByte(rgb[2]); output[dst + 3] = 255;
    }
    if (cell % 160 === 0) progress('toner', 76 + 22 * cell / CELLS);
  }
  return { output, raw, compressedPixels, toneProfiles };
}

self.onmessage = event => {
  const data = event.data;
  if (!data || data.type !== 'render') return;
  try {
    const started = performance.now();
    W = Math.max(1, Math.round(Number(data.gridWidth)));
    H = Math.max(1, Math.round(Number(data.gridHeight)));
    CELLS = W * H;
    OUT = Math.max(4, Math.round(Number(data.outScale) || 16));
    const tileSize = Math.max(4, Math.round(Number(data.tileSize) || 16));
    const target = data.target;
    if (!target || target.width !== W * tileSize || target.height !== H * tileSize || target.pixels.length !== target.width * target.height * 4) {
      throw fail('target-grid-mismatch');
    }
    const input = Array.isArray(data.sources) ? data.sources : [];
    if (!input.length) throw fail('no-sources');
    const repetition = data.repetition === 'free' ? 'free' : 'even';
    const params = {
      strength: clamp(Number(data.params?.strength) || 0, 0, 1),
      detail: clamp(Number(data.params?.detail) || 0, 0, 1),
      originalColour: clamp(Number(data.params?.originalColour) || 0, 0, 1)
    };

    // Equal shares for every photo. When there are more photos than cells some
    // get 0 after rounding; the UI warns about that before rendering.
    let fullCounts = repetition === 'even' ? hamilton(input.map(() => 1), CELLS) : input.map(() => 1);
    const activeIndices = fullCounts.map((n, i) => n ? i : -1).filter(i => i >= 0);
    const sources = activeIndices.map(i => input[i]);
    const D = sources.length;

    progress('analyserer', 2);
    const targets = new Array(CELLS);
    for (let c = 0; c < CELLS; c++) {
      targets[c] = describe(target.pixels, tileSize, target.width, (c % W) * tileSize, Math.floor(c / W) * tileSize);
    }
    for (let d = 0; d < D; d++) {
      sources[d].desc = describe(sources[d].rgba, S);
      if (d % 30 === 0) progress('analyserer', 4 + d / D * 14);
    }

    const costs = new Float32Array(CELLS * D);
    const candidates = repetition === 'free' ? new Int32Array(CELLS * TOP_K).fill(-1) : null;
    const candidateScore = repetition === 'free' ? new Float32Array(TOP_K) : null;
    for (let c = 0; c < CELLS; c++) {
      if (candidates) candidateScore.fill(Infinity);
      for (let d = 0; d < D; d++) {
        const value = score(sources[d].desc, targets[c]);
        costs[c * D + d] = value;
        if (candidates && value < candidateScore[TOP_K - 1]) {
          // Insertion into a tiny sorted list of the best candidates.
          let k = TOP_K - 1;
          while (k > 0 && candidateScore[k - 1] > value) {
            candidateScore[k] = candidateScore[k - 1]; candidates[c * TOP_K + k] = candidates[c * TOP_K + k - 1]; k--;
          }
          candidateScore[k] = value; candidates[c * TOP_K + k] = d;
        }
      }
      if (c % 160 === 0) progress('sammenligner', 20 + c / CELLS * 28);
    }

    const neighbours = neighbourList();
    let assignments, iterations = 0, swaps = 0;
    if (repetition === 'even') {
      progress('matcher', 50);
      const quotas = activeIndices.map(i => fullCounts[i]);
      const allocation = auction(costs, D, quotas);
      assignments = allocation.assignments; iterations = allocation.iterations;
      progress('spreder', 68);
      swaps = spread(assignments, costs, D, data.seed || 20260907, neighbours);
      const check = new Array(D).fill(0);
      for (const d of assignments) check[d]++;
      if (check.some((n, i) => n !== quotas[i])) throw fail('quota-changed');
    } else {
      progress('spreder', 68);
      const placement = freeAssign(costs, D, candidates, neighbours);
      assignments = placement.assignments; swaps = placement.changes;
      fullCounts = new Array(input.length).fill(0);
      for (const d of assignments) fullCounts[activeIndices[d]]++;
    }

    const result = render(targets, sources, assignments, params);
    const sourceIndexByCell = new Int32Array(CELLS);
    for (let i = 0; i < CELLS; i++) sourceIndexByCell[i] = activeIndices[assignments[i]];
    self.postMessage({
      type: 'complete', renderWidth: W * OUT, renderHeight: H * OUT, gridWidth: W, gridHeight: H,
      pixels: result.output, raw: result.raw, assignments: sourceIndexByCell, toneProfiles: result.toneProfiles,
      counts: fullCounts,
      diagnostics: {
        iterations, swaps, seconds: (performance.now() - started) / 1000, totalCells: CELLS,
        repetition, sourceCount: input.length, usedSources: fullCounts.filter(n => n > 0).length,
        zeroTileSources: fullCounts.filter(n => !n).length,
        gamutCompressedFraction: result.compressedPixels / ((W * OUT) * (H * OUT))
      }
    }, [result.output.buffer, result.raw.buffer, result.toneProfiles.buffer, sourceIndexByCell.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', code: error.code || 'engine', message: error.message });
  }
};
