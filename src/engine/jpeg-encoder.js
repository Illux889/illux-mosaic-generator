/*
 * Illux Mosaik — streaming baseline JPEG encoder (classic script).
 *
 * Why this exists: a print file is large (e.g. 7382 x 10335 px at 150 DPI).
 * Browsers cap canvas size (iOS Safari at about 16.7 megapixels), so the
 * print worker cannot always paint the whole image into one canvas and call
 * convertToBlob(). This encoder takes the image a strip of rows at a time, so
 * memory stays at "one row of mosaic tiles" no matter how big the print is.
 *
 * Format: baseline sequential JPEG, YCbCr 4:4:4, standard Annex K tables,
 * JFIF APP0 header carrying the print resolution (DPI). No dependencies.
 *
 * API: const enc = IlxJpeg.createEncoder({ width, height, quality, dpi });
 *      enc.writeRows(rgba, rowCount);   // RGBA rows, top to bottom, any count
 *      const parts = enc.finish();      // array of Uint8Array -> new Blob(parts)
 */
(function (root) {
  'use strict';

  // Natural (row-major) index of each zigzag position.
  const ZIGZAG = new Uint8Array([
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]);

  // ITU-T T.81 Annex K quantisation tables, natural order.
  const LUMA_Q = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  const CHROMA_Q = [
    17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99,
    24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];

  // Annex K.3 Huffman tables: code counts per length 1..16, then symbols.
  const DC_LUMA_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  const DC_CHROMA_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
  const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const AC_LUMA_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
  const AC_LUMA_VALUES = [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa];
  const AC_CHROMA_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
  const AC_CHROMA_VALUES = [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
    0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
    0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
    0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
    0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
    0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa];

  // AAN scale factors for the float forward DCT.
  const AASF = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.541196100, 0.275899379];

  /** Canonical Huffman codes: symbol -> [code, length]. */
  function buildHuffman(bits, values) {
    const table = new Array(256);
    let code = 0, k = 0;
    for (let length = 1; length <= 16; length++) {
      for (let i = 0; i < bits[length - 1]; i++) table[values[k++]] = [code++, length];
      code <<= 1;
    }
    return table;
  }

  function scaledQuant(base, quality) {
    const q = Math.min(100, Math.max(1, Math.round(quality)));
    const scale = q < 50 ? 5000 / q : 200 - q * 2;
    return base.map(v => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
  }

  function divisors(quant) {
    const table = new Float64Array(64);
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const k = row * 8 + col;
      table[k] = 1 / (quant[k] * AASF[row] * AASF[col] * 8);
    }
    return table;
  }

  /** In-place float AAN forward DCT (libjpeg jfdctflt) + quantisation into `out` (natural order). */
  function fdctQuantize(data, div, out) {
    for (let i = 0; i < 64; i += 8) {
      const d0 = data[i], d1 = data[i + 1], d2 = data[i + 2], d3 = data[i + 3];
      const d4 = data[i + 4], d5 = data[i + 5], d6 = data[i + 6], d7 = data[i + 7];
      const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6;
      const t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
      let t10 = t0 + t3; const t13 = t0 - t3; let t11 = t1 + t2; let t12 = t1 - t2;
      data[i] = t10 + t11; data[i + 4] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781;
      data[i + 2] = t13 + z1; data[i + 6] = t13 - z1;
      t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433, z2 = 0.541196100 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781;
      const z11 = t7 + z3, z13 = t7 - z3;
      data[i + 5] = z13 + z2; data[i + 3] = z13 - z2; data[i + 1] = z11 + z4; data[i + 7] = z11 - z4;
    }
    for (let i = 0; i < 8; i++) {
      const d0 = data[i], d1 = data[i + 8], d2 = data[i + 16], d3 = data[i + 24];
      const d4 = data[i + 32], d5 = data[i + 40], d6 = data[i + 48], d7 = data[i + 56];
      const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6;
      const t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
      let t10 = t0 + t3; const t13 = t0 - t3; let t11 = t1 + t2; let t12 = t1 - t2;
      data[i] = t10 + t11; data[i + 32] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781;
      data[i + 16] = t13 + z1; data[i + 48] = t13 - z1;
      t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433, z2 = 0.541196100 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781;
      const z11 = t7 + z3, z13 = t7 - z3;
      data[i + 40] = z13 + z2; data[i + 24] = z13 - z2; data[i + 8] = z11 + z4; data[i + 56] = z11 - z4;
    }
    for (let k = 0; k < 64; k++) {
      const v = data[k] * div[k];
      const q = v > 0 ? (v + 0.5) | 0 : (v - 0.5) | 0;
      // Baseline JPEG allows AC magnitude categories up to 10 (|v| <= 1023).
      out[k] = q > 1023 ? 1023 : q < -1023 ? -1023 : q;
    }
  }

  function createEncoder(options) {
    const width = options.width | 0, height = options.height | 0;
    if (!(width > 0 && height > 0 && width <= 65535 && height <= 65535)) throw Error('jpeg-size');
    const quality = options.quality || 92, dpi = Math.max(1, Math.min(65535, options.dpi | 0 || 72));
    const lumaQ = scaledQuant(LUMA_Q, quality), chromaQ = scaledQuant(CHROMA_Q, quality);
    const lumaDiv = divisors(lumaQ), chromaDiv = divisors(chromaQ);
    const dcLuma = buildHuffman(DC_LUMA_BITS, DC_VALUES), dcChroma = buildHuffman(DC_CHROMA_BITS, DC_VALUES);
    const acLuma = buildHuffman(AC_LUMA_BITS, AC_LUMA_VALUES), acChroma = buildHuffman(AC_CHROMA_BITS, AC_CHROMA_VALUES);

    // ---- byte output in 1 MiB chunks ----
    const CHUNK = 1 << 20, parts = [];
    let chunk = new Uint8Array(CHUNK), pos = 0;
    function byte(b) {
      chunk[pos++] = b;
      if (pos === CHUNK) { parts.push(chunk); chunk = new Uint8Array(CHUNK); pos = 0; }
    }
    function word(w) { byte((w >> 8) & 255); byte(w & 255); }
    let bitBuffer = 0, bitCount = 0;
    function bits(code, length) {
      // Accumulate MSB-first; flush whole bytes with 0xFF byte stuffing.
      bitBuffer = (bitBuffer << length) | (code & ((1 << length) - 1));
      bitCount += length;
      while (bitCount >= 8) {
        const b = (bitBuffer >> (bitCount - 8)) & 255;
        byte(b); if (b === 0xff) byte(0);
        bitCount -= 8;
      }
      bitBuffer &= (1 << bitCount) - 1;
    }

    // ---- headers ----
    word(0xffd8); // SOI
    word(0xffe0); word(16); // APP0 JFIF
    for (const c of [0x4a, 0x46, 0x49, 0x46, 0]) byte(c);
    byte(1); byte(1); byte(1); word(dpi); word(dpi); byte(0); byte(0);
    word(0xffdb); word(132); // DQT
    byte(0); for (let i = 0; i < 64; i++) byte(lumaQ[ZIGZAG[i]]);
    byte(1); for (let i = 0; i < 64; i++) byte(chromaQ[ZIGZAG[i]]);
    word(0xffc0); word(17); byte(8); word(height); word(width); byte(3); // SOF0
    byte(1); byte(0x11); byte(0); byte(2); byte(0x11); byte(1); byte(3); byte(0x11); byte(1);
    word(0xffc4); word(418); // DHT
    for (const [id, b, v] of [[0x00, DC_LUMA_BITS, DC_VALUES], [0x10, AC_LUMA_BITS, AC_LUMA_VALUES],
      [0x01, DC_CHROMA_BITS, DC_VALUES], [0x11, AC_CHROMA_BITS, AC_CHROMA_VALUES]]) {
      byte(id); for (const n of b) byte(n); for (const s of v) byte(s);
    }
    word(0xffda); word(12); byte(3); // SOS
    byte(1); byte(0x00); byte(2); byte(0x11); byte(3); byte(0x11); byte(0); byte(63); byte(0);

    // ---- entropy coding ----
    const block = new Float64Array(64), quantised = new Int32Array(64);
    let dcY = 0, dcCb = 0, dcCr = 0;
    function category(v) { let a = v < 0 ? -v : v, n = 0; while (a) { n++; a >>= 1; } return n; }
    function encodeBlock(div, previousDc, dcTable, acTable) {
      fdctQuantize(block, div, quantised);
      const dc = quantised[0], diff = dc - previousDc, dcCat = category(diff);
      bits(dcTable[dcCat][0], dcTable[dcCat][1]);
      if (dcCat) bits(diff < 0 ? diff + (1 << dcCat) - 1 : diff, dcCat);
      let run = 0;
      let last = 63;
      while (last > 0 && quantised[ZIGZAG[last]] === 0) last--;
      for (let i = 1; i <= last; i++) {
        const v = quantised[ZIGZAG[i]];
        if (v === 0) { run++; continue; }
        while (run > 15) { bits(acTable[0xf0][0], acTable[0xf0][1]); run -= 16; }
        const cat = category(v), symbol = (run << 4) | cat;
        bits(acTable[symbol][0], acTable[symbol][1]);
        bits(v < 0 ? v + (1 << cat) - 1 : v, cat);
        run = 0;
      }
      if (last < 63) bits(acTable[0x00][0], acTable[0x00][1]);
      return dc;
    }

    // Strip of 8 rows, stored as three float planes.
    const stripY = new Float32Array(width * 8), stripCb = new Float32Array(width * 8), stripCr = new Float32Array(width * 8);
    let stripRows = 0, rowsWritten = 0;
    function flushStrip() {
      // Replicate the last row into an incomplete strip (bottom edge).
      for (let r = stripRows; r < 8; r++) {
        stripY.copyWithin(r * width, (stripRows - 1) * width, stripRows * width);
        stripCb.copyWithin(r * width, (stripRows - 1) * width, stripRows * width);
        stripCr.copyWithin(r * width, (stripRows - 1) * width, stripRows * width);
      }
      for (let bx = 0; bx < width; bx += 8) {
        for (const [plane, which] of [[stripY, 0], [stripCb, 1], [stripCr, 2]]) {
          for (let y = 0; y < 8; y++) {
            const rowOffset = y * width;
            for (let x = 0; x < 8; x++) block[y * 8 + x] = plane[rowOffset + Math.min(width - 1, bx + x)];
          }
          if (which === 0) dcY = encodeBlock(lumaDiv, dcY, dcLuma, acLuma);
          else if (which === 1) dcCb = encodeBlock(chromaDiv, dcCb, dcChroma, acChroma);
          else dcCr = encodeBlock(chromaDiv, dcCr, dcChroma, acChroma);
        }
      }
      stripRows = 0;
    }

    return {
      /** Feed `rowCount` rows of RGBA pixels (width * rowCount * 4 bytes). */
      writeRows(rgba, rowCount) {
        for (let r = 0; r < rowCount; r++) {
          if (rowsWritten >= height) throw Error('jpeg-too-many-rows');
          const src = r * width * 4, dst = stripRows * width;
          for (let x = 0; x < width; x++) {
            const p = src + x * 4, R = rgba[p], G = rgba[p + 1], B = rgba[p + 2];
            stripY[dst + x] = 0.299 * R + 0.587 * G + 0.114 * B - 128;
            stripCb[dst + x] = -0.168736 * R - 0.331264 * G + 0.5 * B;
            stripCr[dst + x] = 0.5 * R - 0.418688 * G - 0.081312 * B;
          }
          stripRows++; rowsWritten++;
          if (stripRows === 8) flushStrip();
        }
      },
      get rowsWritten() { return rowsWritten; },
      /** Close the stream. Returns the file as an array of byte chunks. */
      finish() {
        if (rowsWritten !== height) throw Error('jpeg-missing-rows');
        if (stripRows) flushStrip();
        if (bitCount) bits(0x7f, 8 - bitCount); // pad the last byte with 1-bits
        word(0xffd9); // EOI
        parts.push(chunk.subarray(0, pos));
        return parts;
      }
    };
  }

  /** Overwrite the density of an existing JFIF header (used after canvas convertToBlob). */
  function patchJpegDpi(bytes, dpi) {
    const limit = Math.min(bytes.length - 16, 4096);
    for (let i = 0; i < limit; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xe0 && bytes[i + 4] === 0x4a && bytes[i + 5] === 0x46 && bytes[i + 6] === 0x49 && bytes[i + 7] === 0x46 && bytes[i + 8] === 0x00) {
        bytes[i + 11] = 1; bytes[i + 12] = (dpi >> 8) & 255; bytes[i + 13] = dpi & 255; bytes[i + 14] = (dpi >> 8) & 255; bytes[i + 15] = dpi & 255;
        return true;
      }
    }
    return false;
  }

  root.IlxJpeg = { createEncoder, patchJpegDpi, _tables: { AC_LUMA_BITS, AC_LUMA_VALUES, AC_CHROMA_BITS, AC_CHROMA_VALUES, ZIGZAG } };
})(typeof self !== 'undefined' ? self : globalThis);
